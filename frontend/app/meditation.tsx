import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import { narrate as narrateNeural, stopAll as stopNarrator, prefetch as prefetchNeural } from "../src/narrator";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { COLORS } from "../src/theme";
import { currentLocale, useI18n } from "../src/i18n";
import { api } from "../src/api";

type Eligibility = {
  tier: "free" | "pro" | "zen";
  used: SessionKey[];
  remaining: SessionKey[];
  unlimited: boolean;
  themes: SessionKey[];
};

/**
 * Guided Meditation — themed sessions narrated by a soft female voice.
 *
 * Two stages, mirrored from /breath:
 *   1) "pick"  → 4 themed cards (Sleep · Anxiety · Gratitude · Focus)
 *                each with concrete benefits.
 *   2) "play"  → InnFeel logo orb breathing in slow continuous rhythm
 *                while the localised narration plays cue-by-cue.
 *
 * Animation strategy
 * ─────────────────
 * Unlike breathing exercises, meditations don't have discrete "phase
 * boundaries". The orb just breathes slowly and continuously (4s in / 6s
 * out, looping) for the entire session — the narration sits on top.
 * This decouples audio from animation: the user can still see the calm
 * pulse if TTS stalls or finishes early. The continuous loop is built
 * with Animated.loop so the bridge stays free of repeated JS callbacks.
 *
 * Voice strategy
 * ──────────────
 * Reuses the `pickFemaleVoiceId` logic established in /breath: ranks
 * known female voices per locale, prefers Premium → Enhanced → Default,
 * blocklists obvious male names. Speech rate is slightly slower than
 * breath (0.42 iOS / 0.85 Android) for a meditative pace.
 *
 * Scheduling
 * ──────────
 * Each cue is `{ say, pauseAfter }`. We chain them via Speech.speak's
 * onDone callback so the narration starts the *next* cue right after
 * the previous one finishes — no fixed-duration estimation needed
 * (which would break across locales / voices). The pause between cues
 * gives the user time to breathe and integrate.
 */

type CueId =
  | "settle.1" | "settle.2" | "settle.3"
  | "breath.in" | "breath.out" | "breath.deep"
  | "sleep.1" | "sleep.2" | "sleep.3" | "sleep.4" | "sleep.close"
  | "anxiety.1" | "anxiety.2" | "anxiety.3" | "anxiety.4" | "anxiety.close"
  | "grat.1" | "grat.2" | "grat.3" | "grat.4" | "grat.close"
  | "focus.1" | "focus.2" | "focus.3" | "focus.4" | "focus.close";

type SessionKey = "sleep" | "anxiety" | "gratitude" | "focus";

type Cue = { id: CueId; pauseAfter: number };  // pauseAfter in seconds

type Session = {
  key: SessionKey;
  cues: Cue[];
  approxMinutes: number;
};

/**
 * Session scripts. Each cue is short (≤ 1 sentence) so translation is
 * tractable across 7 locales. Pause durations are tuned so a full
 * session feels unhurried but not draggy.
 */
const SESSIONS: Record<SessionKey, Session> = {
  sleep: {
    key: "sleep",
    approxMinutes: 5,
    cues: [
      { id: "settle.1", pauseAfter: 4 },
      { id: "settle.2", pauseAfter: 5 },
      { id: "breath.deep", pauseAfter: 4 },
      { id: "breath.out", pauseAfter: 5 },
      { id: "sleep.1", pauseAfter: 8 },
      { id: "sleep.2", pauseAfter: 10 },
      { id: "sleep.3", pauseAfter: 12 },
      { id: "sleep.4", pauseAfter: 15 },
      { id: "breath.deep", pauseAfter: 8 },
      { id: "sleep.close", pauseAfter: 4 },
    ],
  },
  anxiety: {
    key: "anxiety",
    approxMinutes: 4,
    cues: [
      { id: "settle.1", pauseAfter: 4 },
      { id: "settle.3", pauseAfter: 4 },
      { id: "breath.deep", pauseAfter: 4 },
      { id: "anxiety.1", pauseAfter: 8 },
      { id: "anxiety.2", pauseAfter: 10 },
      { id: "anxiety.3", pauseAfter: 12 },
      { id: "anxiety.4", pauseAfter: 8 },
      { id: "breath.in", pauseAfter: 4 },
      { id: "breath.out", pauseAfter: 4 },
      { id: "anxiety.close", pauseAfter: 4 },
    ],
  },
  gratitude: {
    key: "gratitude",
    approxMinutes: 3,
    cues: [
      { id: "settle.2", pauseAfter: 4 },
      { id: "breath.deep", pauseAfter: 4 },
      { id: "grat.1", pauseAfter: 12 },
      { id: "grat.2", pauseAfter: 12 },
      { id: "grat.3", pauseAfter: 12 },
      { id: "grat.4", pauseAfter: 8 },
      { id: "grat.close", pauseAfter: 4 },
    ],
  },
  focus: {
    key: "focus",
    approxMinutes: 4,
    cues: [
      { id: "settle.1", pauseAfter: 3 },
      { id: "settle.3", pauseAfter: 4 },
      { id: "breath.deep", pauseAfter: 4 },
      { id: "focus.1", pauseAfter: 8 },
      { id: "focus.2", pauseAfter: 10 },
      { id: "focus.3", pauseAfter: 10 },
      { id: "focus.4", pauseAfter: 8 },
      { id: "breath.in", pauseAfter: 3 },
      { id: "focus.close", pauseAfter: 3 },
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// i18n — inline strings (UI labels + narration cues) in 7 locales.
// Cue strings are SHORT (≤ 1 sentence) so TTS can land them cleanly within
// the scheduled pause. Translation prioritises emotional warmth over
// word-for-word fidelity.
// ──────────────────────────────────────────────────────────────────────────
const STR: Record<string, Record<string, string>> = {
  en: {
    title: "Meditation",
    kicker: "GUIDED MEDITATION",
    pickTitle: "Choose your meditation",
    pickSub: "Short, gentle sessions to land somewhere softer. Pick what you need today.",
    start: "Start",
    stop: "Stop",
    change: "Change",
    minutes: "min",
    headphones: "✦ Headphones make this 10× softer.",
    "sleep.name": "Sleep",
    "sleep.tag": "Drift off · Body scan",
    "sleep.b1": "Quiet a racing mind before bed",
    "sleep.b2": "Releases tension from head to toe",
    "sleep.b3": "Falls asleep in under 5 minutes",
    "anxiety.name": "Anxiety",
    "anxiety.tag": "Ground · Calm",
    "anxiety.b1": "Breaks the spiral of overthinking",
    "anxiety.b2": "Anchors you in the present",
    "anxiety.b3": "Slows a racing heartbeat",
    "gratitude.name": "Gratitude",
    "gratitude.tag": "Reset · Lightness",
    "gratitude.b1": "Shifts your day toward what's good",
    "gratitude.b2": "Boosts mood within minutes",
    "gratitude.b3": "Trains a kinder inner voice",
    "focus.name": "Focus",
    "focus.tag": "Clarity · Presence",
    "focus.b1": "Sharpens attention before deep work",
    "focus.b2": "Cuts through mental fog",
    "focus.b3": "Reconnects you to your intention",
    closing: "Take this calm with you.",
    trialBadge: "Free trial",
    trialUsedTitle: "Trial used",
    trialUsedDesc: "Upgrade to Pro to unlock unlimited meditations.",
    upgrade: "Upgrade",
    notNow: "Not now",
    // Cue narration
    "settle.1": "Find a position where your body can soften.",
    "settle.2": "Close your eyes if you'd like, or let your gaze rest.",
    "settle.3": "Notice the surface beneath you holding your weight.",
    "breath.deep": "Take a long, slow breath in. And gently let it out.",
    "breath.in": "Breathe in slowly through your nose.",
    "breath.out": "And exhale, releasing what you don't need.",
    "sleep.1": "Let your jaw, your shoulders, your hands soften.",
    "sleep.2": "Each exhale carries a little more of the day away.",
    "sleep.3": "There's nothing left to do, nowhere to go. You're already arrived.",
    "sleep.4": "Let your body grow heavy. Let yourself sink.",
    "sleep.close": "Sleep gently. You've earned this rest.",
    "anxiety.1": "Notice five things you can see around you.",
    "anxiety.2": "Notice three sounds. Near, or far away.",
    "anxiety.3": "Place a hand on your chest. Feel the warmth of your own breath.",
    "anxiety.4": "Whatever you feel — it can be here. It will pass.",
    "anxiety.close": "You're safe in this moment. That's enough.",
    "grat.1": "Bring to mind one small thing that went well today.",
    "grat.2": "Picture a person who makes your life softer.",
    "grat.3": "Notice one thing your body did for you today.",
    "grat.4": "Hold these gently, like cupped hands holding warm light.",
    "grat.close": "Carry this lightness with you.",
    "focus.1": "Bring to mind what you want to do next.",
    "focus.2": "See yourself doing it with calm, steady attention.",
    "focus.3": "Let the rest of the world fall to the edges.",
    "focus.4": "One breath. One thing. One step at a time.",
    "focus.close": "You're ready. Move with intention.",
  },
  fr: {
    title: "Méditation",
    kicker: "MÉDITATION GUIDÉE",
    pickTitle: "Choisis ta méditation",
    pickSub: "Des séances courtes et douces. Choisis ce dont tu as besoin aujourd'hui.",
    start: "Commencer",
    stop: "Arrêter",
    change: "Changer",
    minutes: "min",
    headphones: "✦ Avec des écouteurs, c'est 10× plus doux.",
    "sleep.name": "Sommeil",
    "sleep.tag": "S'endormir · Détente",
    "sleep.b1": "Apaise un mental agité avant le coucher",
    "sleep.b2": "Relâche les tensions de la tête aux pieds",
    "sleep.b3": "Endormissement en moins de 5 minutes",
    "anxiety.name": "Anxiété",
    "anxiety.tag": "Ancrage · Calme",
    "anxiety.b1": "Brise la spirale des pensées",
    "anxiety.b2": "T'ancre dans le présent",
    "anxiety.b3": "Ralentit le rythme cardiaque",
    "gratitude.name": "Gratitude",
    "gratitude.tag": "Reset · Légèreté",
    "gratitude.b1": "Oriente ta journée vers le positif",
    "gratitude.b2": "Améliore l'humeur en quelques minutes",
    "gratitude.b3": "Entraîne une voix intérieure plus douce",
    "focus.name": "Focus",
    "focus.tag": "Clarté · Présence",
    "focus.b1": "Aiguise l'attention avant un travail profond",
    "focus.b2": "Dissipe le brouillard mental",
    "focus.b3": "Te reconnecte à ton intention",
    closing: "Emporte ce calme avec toi.",
    trialBadge: "Essai gratuit",
    trialUsedTitle: "Essai utilisé",
    trialUsedDesc: "Passe à Pro pour débloquer les méditations en illimité.",
    upgrade: "Passer à Pro",
    notNow: "Plus tard",
    "settle.1": "Trouve une position où ton corps peut se relâcher.",
    "settle.2": "Ferme les yeux si tu veux, ou laisse ton regard se poser.",
    "settle.3": "Sens la surface sous toi qui soutient ton poids.",
    "breath.deep": "Inspire lentement et profondément. Puis relâche tout doucement.",
    "breath.in": "Inspire lentement par le nez.",
    "breath.out": "Et expire, en relâchant ce qui n'est plus utile.",
    "sleep.1": "Laisse ta mâchoire, tes épaules, tes mains se détendre.",
    "sleep.2": "Chaque expiration emporte un peu plus de la journée.",
    "sleep.3": "Il n'y a plus rien à faire, nulle part où aller. Tu es déjà arrivé.",
    "sleep.4": "Laisse ton corps devenir lourd. Laisse-toi t'enfoncer.",
    "sleep.close": "Dors paisiblement. Tu as mérité ce repos.",
    "anxiety.1": "Remarque cinq choses que tu peux voir autour de toi.",
    "anxiety.2": "Remarque trois sons. Proches, ou lointains.",
    "anxiety.3": "Pose une main sur ta poitrine. Sens la chaleur de ton souffle.",
    "anxiety.4": "Ce que tu ressens peut être là. Cela va passer.",
    "anxiety.close": "Tu es en sécurité dans cet instant. C'est suffisant.",
    "grat.1": "Fais venir une petite chose qui s'est bien passée aujourd'hui.",
    "grat.2": "Imagine une personne qui rend ta vie plus douce.",
    "grat.3": "Remarque une chose que ton corps a faite pour toi aujourd'hui.",
    "grat.4": "Tiens-les délicatement, comme des mains en coupe avec une lumière chaude.",
    "grat.close": "Emporte cette légèreté avec toi.",
    "focus.1": "Fais venir à l'esprit ce que tu veux faire ensuite.",
    "focus.2": "Vois-toi le faire avec une attention calme et stable.",
    "focus.3": "Laisse le reste du monde s'effacer sur les bords.",
    "focus.4": "Une respiration. Une chose. Un pas à la fois.",
    "focus.close": "Tu es prêt. Avance avec intention.",
  },
  es: {
    title: "Meditación",
    kicker: "MEDITACIÓN GUIADA",
    pickTitle: "Elige tu meditación",
    pickSub: "Sesiones cortas y suaves. Elige lo que necesitas hoy.",
    start: "Empezar", stop: "Parar", change: "Cambiar", minutes: "min",
    headphones: "✦ Con auriculares es 10× más suave.",
    "sleep.name": "Sueño", "sleep.tag": "Dormir · Descanso",
    "sleep.b1": "Calma una mente agitada antes de dormir",
    "sleep.b2": "Libera la tensión de pies a cabeza",
    "sleep.b3": "Te duermes en menos de 5 minutos",
    "anxiety.name": "Ansiedad", "anxiety.tag": "Anclaje · Calma",
    "anxiety.b1": "Rompe la espiral del pensamiento",
    "anxiety.b2": "Te ancla en el presente",
    "anxiety.b3": "Reduce el pulso acelerado",
    "gratitude.name": "Gratitud", "gratitude.tag": "Reset · Ligereza",
    "gratitude.b1": "Orienta el día hacia lo bueno",
    "gratitude.b2": "Mejora el ánimo en minutos",
    "gratitude.b3": "Entrena una voz interior más amable",
    "focus.name": "Foco", "focus.tag": "Claridad · Presencia",
    "focus.b1": "Afina la atención antes de trabajar",
    "focus.b2": "Disipa la niebla mental",
    "focus.b3": "Te reconecta con tu intención",
    closing: "Lleva esta calma contigo.",
    trialBadge: "Prueba gratis",
    trialUsedTitle: "Prueba usada",
    trialUsedDesc: "Hazte Pro para desbloquear meditaciones ilimitadas.",
    upgrade: "Pasar a Pro",
    notNow: "Ahora no",
    "settle.1": "Encuentra una posición donde tu cuerpo pueda relajarse.",
    "settle.2": "Cierra los ojos si quieres, o deja que la mirada repose.",
    "settle.3": "Siente la superficie que te sostiene.",
    "breath.deep": "Respira hondo y despacio. Y suelta suavemente.",
    "breath.in": "Inhala lentamente por la nariz.",
    "breath.out": "Y exhala, soltando lo que ya no necesitas.",
    "sleep.1": "Deja que la mandíbula, los hombros, las manos se ablanden.",
    "sleep.2": "Cada exhalación se lleva un poco más del día.",
    "sleep.3": "No queda nada por hacer. Ya has llegado.",
    "sleep.4": "Deja que el cuerpo se vuelva pesado. Hundete suavemente.",
    "sleep.close": "Duerme tranquilo. Has merecido este descanso.",
    "anxiety.1": "Nota cinco cosas que puedes ver a tu alrededor.",
    "anxiety.2": "Nota tres sonidos. Cercanos o lejanos.",
    "anxiety.3": "Pon una mano en el pecho. Siente el calor de tu aliento.",
    "anxiety.4": "Lo que sientes puede estar aquí. Pasará.",
    "anxiety.close": "Estás a salvo en este momento. Es suficiente.",
    "grat.1": "Trae a la mente algo pequeño que salió bien hoy.",
    "grat.2": "Imagina a alguien que hace tu vida más amable.",
    "grat.3": "Nota algo que tu cuerpo hizo por ti hoy.",
    "grat.4": "Sostenlos con suavidad, como manos en cuenco con luz cálida.",
    "grat.close": "Lleva esta ligereza contigo.",
    "focus.1": "Trae a la mente lo que quieres hacer después.",
    "focus.2": "Imagínate haciéndolo con atención calmada y firme.",
    "focus.3": "Deja que el resto del mundo se difumine en los bordes.",
    "focus.4": "Una respiración. Una cosa. Un paso a la vez.",
    "focus.close": "Estás listo. Avanza con intención.",
  },
  it: {
    title: "Meditazione", kicker: "MEDITAZIONE GUIDATA",
    pickTitle: "Scegli la tua meditazione",
    pickSub: "Sessioni brevi e dolci. Scegli ciò di cui hai bisogno oggi.",
    start: "Inizia", stop: "Stop", change: "Cambia", minutes: "min",
    headphones: "✦ Con le cuffie è 10× più dolce.",
    "sleep.name": "Sonno", "sleep.tag": "Dormire · Relax",
    "sleep.b1": "Calma la mente agitata prima di dormire",
    "sleep.b2": "Rilascia la tensione da capo a piedi",
    "sleep.b3": "Addormentamento in meno di 5 minuti",
    "anxiety.name": "Ansia", "anxiety.tag": "Radicamento · Calma",
    "anxiety.b1": "Spezza la spirale del rimuginio",
    "anxiety.b2": "Ti ancora al presente",
    "anxiety.b3": "Rallenta il battito accelerato",
    "gratitude.name": "Gratitudine", "gratitude.tag": "Reset · Leggerezza",
    "gratitude.b1": "Orienta la giornata verso il positivo",
    "gratitude.b2": "Migliora l'umore in pochi minuti",
    "gratitude.b3": "Allena una voce interiore più gentile",
    "focus.name": "Focus", "focus.tag": "Chiarezza · Presenza",
    "focus.b1": "Affina l'attenzione prima del lavoro profondo",
    "focus.b2": "Dissipa la nebbia mentale",
    "focus.b3": "Ti riconnette alla tua intenzione",
    closing: "Porta questa calma con te.",
    trialBadge: "Prova gratuita",
    trialUsedTitle: "Prova usata",
    trialUsedDesc: "Passa a Pro per sbloccare meditazioni illimitate.",
    upgrade: "Passa a Pro",
    notNow: "Più tardi",
    "settle.1": "Trova una posizione in cui il corpo possa rilassarsi.",
    "settle.2": "Chiudi gli occhi se vuoi, o lascia che lo sguardo si posi.",
    "settle.3": "Senti la superficie che ti sostiene.",
    "breath.deep": "Inspira lentamente e profondamente. E rilascia dolcemente.",
    "breath.in": "Inspira lentamente dal naso.",
    "breath.out": "Espira, rilasciando ciò che non serve.",
    "sleep.1": "Lascia che mascella, spalle, mani si ammorbidiscano.",
    "sleep.2": "Ogni espirazione porta via un po' della giornata.",
    "sleep.3": "Non c'è nulla da fare. Sei già arrivato.",
    "sleep.4": "Lascia che il corpo diventi pesante. Lasciati affondare.",
    "sleep.close": "Dormi sereno. Hai meritato questo riposo.",
    "anxiety.1": "Nota cinque cose che puoi vedere intorno a te.",
    "anxiety.2": "Nota tre suoni. Vicini, o lontani.",
    "anxiety.3": "Posa una mano sul petto. Senti il calore del tuo respiro.",
    "anxiety.4": "Ciò che senti può essere qui. Passerà.",
    "anxiety.close": "Sei al sicuro in questo momento. È abbastanza.",
    "grat.1": "Porta in mente una piccola cosa andata bene oggi.",
    "grat.2": "Immagina una persona che rende la tua vita più dolce.",
    "grat.3": "Nota una cosa che il tuo corpo ha fatto per te oggi.",
    "grat.4": "Tienile con delicatezza, come mani a coppa con luce calda.",
    "grat.close": "Porta questa leggerezza con te.",
    "focus.1": "Porta in mente ciò che vuoi fare dopo.",
    "focus.2": "Immaginati farlo con attenzione calma e ferma.",
    "focus.3": "Lascia che il resto del mondo svanisca ai bordi.",
    "focus.4": "Un respiro. Una cosa. Un passo alla volta.",
    "focus.close": "Sei pronto. Vai con intenzione.",
  },
  de: {
    title: "Meditation", kicker: "GEFÜHRTE MEDITATION",
    pickTitle: "Wähle deine Meditation",
    pickSub: "Kurze, sanfte Sitzungen. Wähle, was du heute brauchst.",
    start: "Start", stop: "Stopp", change: "Ändern", minutes: "min",
    headphones: "✦ Mit Kopfhörern wird es 10× sanfter.",
    "sleep.name": "Schlaf", "sleep.tag": "Einschlafen · Ruhe",
    "sleep.b1": "Beruhigt einen rasenden Geist vor dem Schlaf",
    "sleep.b2": "Löst Spannung von Kopf bis Fuß",
    "sleep.b3": "Schläfst in unter 5 Minuten ein",
    "anxiety.name": "Angst", "anxiety.tag": "Erden · Ruhe",
    "anxiety.b1": "Bricht die Gedankenspirale",
    "anxiety.b2": "Verankert dich im Jetzt",
    "anxiety.b3": "Verlangsamt einen rasenden Puls",
    "gratitude.name": "Dankbarkeit", "gratitude.tag": "Reset · Leichtigkeit",
    "gratitude.b1": "Richtet den Tag aufs Gute aus",
    "gratitude.b2": "Hebt die Stimmung in Minuten",
    "gratitude.b3": "Trainiert eine sanftere innere Stimme",
    "focus.name": "Fokus", "focus.tag": "Klarheit · Präsenz",
    "focus.b1": "Schärft die Aufmerksamkeit vor tiefer Arbeit",
    "focus.b2": "Lichtet den mentalen Nebel",
    "focus.b3": "Verbindet dich neu mit deiner Absicht",
    closing: "Nimm diese Ruhe mit.",
    trialBadge: "Gratis-Test",
    trialUsedTitle: "Test verbraucht",
    trialUsedDesc: "Werde Pro für unbegrenzte Meditationen.",
    upgrade: "Pro werden",
    notNow: "Später",
    "settle.1": "Finde eine Haltung, in der dein Körper weich werden kann.",
    "settle.2": "Schließe die Augen, oder lass deinen Blick ruhen.",
    "settle.3": "Spüre die Oberfläche, die dich trägt.",
    "breath.deep": "Atme lang und langsam ein. Und lass sanft los.",
    "breath.in": "Atme langsam durch die Nase ein.",
    "breath.out": "Und atme aus, lass los, was du nicht brauchst.",
    "sleep.1": "Lass Kiefer, Schultern, Hände weicher werden.",
    "sleep.2": "Jede Ausatmung trägt ein Stück Tag fort.",
    "sleep.3": "Nichts mehr zu tun. Du bist schon angekommen.",
    "sleep.4": "Lass den Körper schwer werden. Lass dich sinken.",
    "sleep.close": "Schlaf sanft. Du hast dir diese Ruhe verdient.",
    "anxiety.1": "Bemerke fünf Dinge, die du um dich sehen kannst.",
    "anxiety.2": "Bemerke drei Geräusche. Nah, oder fern.",
    "anxiety.3": "Lege eine Hand auf die Brust. Spüre die Wärme deines Atems.",
    "anxiety.4": "Was du fühlst, darf da sein. Es wird vorbeiziehen.",
    "anxiety.close": "Du bist sicher, jetzt. Das genügt.",
    "grat.1": "Erinnere dich an eine kleine Sache, die heute gut lief.",
    "grat.2": "Stell dir jemanden vor, der dein Leben weicher macht.",
    "grat.3": "Bemerke etwas, das dein Körper heute für dich getan hat.",
    "grat.4": "Halte sie behutsam, wie warme Hände mit Licht.",
    "grat.close": "Trag diese Leichtigkeit weiter.",
    "focus.1": "Erinnere dich daran, was du als Nächstes tun willst.",
    "focus.2": "Sieh dich es ruhig und stetig tun.",
    "focus.3": "Lass den Rest der Welt an den Rand rücken.",
    "focus.4": "Ein Atemzug. Eine Sache. Ein Schritt nach dem anderen.",
    "focus.close": "Du bist bereit. Geh mit Absicht.",
  },
  pt: {
    title: "Meditação", kicker: "MEDITAÇÃO GUIADA",
    pickTitle: "Escolhe a tua meditação",
    pickSub: "Sessões curtas e suaves. Escolhe o que precisas hoje.",
    start: "Começar", stop: "Parar", change: "Mudar", minutes: "min",
    headphones: "✦ Com auscultadores fica 10× mais suave.",
    "sleep.name": "Sono", "sleep.tag": "Dormir · Descanso",
    "sleep.b1": "Acalma uma mente agitada antes de dormir",
    "sleep.b2": "Liberta tensão dos pés à cabeça",
    "sleep.b3": "Adormeces em menos de 5 minutos",
    "anxiety.name": "Ansiedade", "anxiety.tag": "Ancoragem · Calma",
    "anxiety.b1": "Quebra a espiral do pensamento",
    "anxiety.b2": "Ancora-te no presente",
    "anxiety.b3": "Abranda o ritmo cardíaco",
    "gratitude.name": "Gratidão", "gratitude.tag": "Reset · Leveza",
    "gratitude.b1": "Vira o teu dia para o positivo",
    "gratitude.b2": "Melhora o humor em minutos",
    "gratitude.b3": "Treina uma voz interior mais gentil",
    "focus.name": "Foco", "focus.tag": "Clareza · Presença",
    "focus.b1": "Afina a atenção antes do trabalho profundo",
    "focus.b2": "Dissipa a névoa mental",
    "focus.b3": "Reconecta-te à tua intenção",
    closing: "Leva esta calma contigo.",
    trialBadge: "Teste grátis",
    trialUsedTitle: "Teste utilizado",
    trialUsedDesc: "Sobe para Pro para meditações ilimitadas.",
    upgrade: "Passar a Pro",
    notNow: "Mais tarde",
    "settle.1": "Encontra uma posição em que o corpo possa amaciar.",
    "settle.2": "Fecha os olhos se quiseres, ou deixa o olhar pousar.",
    "settle.3": "Sente a superfície que te sustenta.",
    "breath.deep": "Inspira longo e devagar. E solta com suavidade.",
    "breath.in": "Inspira devagar pelo nariz.",
    "breath.out": "Expira, soltando o que já não precisas.",
    "sleep.1": "Deixa o maxilar, os ombros, as mãos amolecerem.",
    "sleep.2": "Cada expiração leva um pouco mais do dia.",
    "sleep.3": "Nada mais para fazer. Já chegaste.",
    "sleep.4": "Deixa o corpo ficar pesado. Deixa-te afundar.",
    "sleep.close": "Dorme em paz. Mereceste este descanso.",
    "anxiety.1": "Repara em cinco coisas que podes ver à tua volta.",
    "anxiety.2": "Repara em três sons. Próximos ou distantes.",
    "anxiety.3": "Pousa uma mão no peito. Sente o calor do teu respirar.",
    "anxiety.4": "O que sentes pode estar aqui. Vai passar.",
    "anxiety.close": "Estás seguro neste instante. É suficiente.",
    "grat.1": "Traz à mente uma coisa pequena que correu bem hoje.",
    "grat.2": "Imagina alguém que torna a tua vida mais suave.",
    "grat.3": "Repara em algo que o teu corpo fez por ti hoje.",
    "grat.4": "Segura-os com delicadeza, como mãos em concha com luz quente.",
    "grat.close": "Leva esta leveza contigo.",
    "focus.1": "Traz à mente o que queres fazer a seguir.",
    "focus.2": "Vê-te a fazê-lo com atenção calma e firme.",
    "focus.3": "Deixa o resto do mundo desvanecer-se nas margens.",
    "focus.4": "Uma respiração. Uma coisa. Um passo de cada vez.",
    "focus.close": "Estás pronto. Avança com intenção.",
  },
  ar: {
    title: "تأمّل", kicker: "تأمّل موجَّه",
    pickTitle: "اختر تأمّلك",
    pickSub: "جلسات قصيرة ولطيفة. اختر ما تحتاجه اليوم.",
    start: "ابدأ", stop: "إيقاف", change: "تغيير", minutes: "دقيقة",
    headphones: "✦ مع السماعات يصبح أنعم بعشرة أضعاف.",
    "sleep.name": "النوم", "sleep.tag": "النوم · الراحة",
    "sleep.b1": "يهدّئ ذهنًا مضطربًا قبل النوم",
    "sleep.b2": "يحرّر التوتر من الرأس إلى القدمين",
    "sleep.b3": "تنام في أقل من 5 دقائق",
    "anxiety.name": "القلق", "anxiety.tag": "الترسيخ · الهدوء",
    "anxiety.b1": "يكسر دوامة التفكير الزائد",
    "anxiety.b2": "يثبّتك في اللحظة الحاضرة",
    "anxiety.b3": "يخفف تسارع نبضات القلب",
    "gratitude.name": "الامتنان", "gratitude.tag": "إعادة ضبط · خفّة",
    "gratitude.b1": "يوجّه يومك نحو الجميل",
    "gratitude.b2": "يحسّن المزاج في دقائق",
    "gratitude.b3": "يدرّب صوتًا داخليًا ألطف",
    "focus.name": "التركيز", "focus.tag": "وضوح · حضور",
    "focus.b1": "يصقل الانتباه قبل العمل العميق",
    "focus.b2": "يبدّد الضباب الذهني",
    "focus.b3": "يعيد ربطك بنيّتك",
    closing: "خذ هذا الهدوء معك.",
    trialBadge: "تجربة مجانية",
    trialUsedTitle: "تم استخدام التجربة",
    trialUsedDesc: "ترقّ إلى Pro لفتح تأملات بلا حدود.",
    upgrade: "ترقية إلى Pro",
    notNow: "لاحقًا",
    "settle.1": "اعثر على وضعية يستطيع جسدك فيها أن يلين.",
    "settle.2": "أغلق عينيك إن شئت، أو دع نظرك يستريح.",
    "settle.3": "اشعر بالسطح الذي يحملك.",
    "breath.deep": "خذ شهيقًا طويلاً ببطء. ثم أطلقه بلطف.",
    "breath.in": "خذ شهيقًا بطيئًا عبر الأنف.",
    "breath.out": "وأطلق الزفير، تاركًا ما لا تحتاجه.",
    "sleep.1": "دع فكّك وكتفيك ويديك تلين.",
    "sleep.2": "كل زفير يحمل قليلاً من اليوم بعيدًا.",
    "sleep.3": "لا شيء يُنجَز. لقد وصلت بالفعل.",
    "sleep.4": "دع الجسد يثقل. دع نفسك تغرق.",
    "sleep.close": "نَم بهدوء. تستحق هذه الراحة.",
    "anxiety.1": "لاحظ خمسة أشياء يمكنك رؤيتها حولك.",
    "anxiety.2": "لاحظ ثلاثة أصوات. قريبة أو بعيدة.",
    "anxiety.3": "ضع يدًا على صدرك. اشعر بدفء أنفاسك.",
    "anxiety.4": "ما تشعر به يمكن أن يكون هنا. سيمرّ.",
    "anxiety.close": "أنت آمن في هذه اللحظة. هذا يكفي.",
    "grat.1": "استدعِ شيئًا صغيرًا سار جيدًا اليوم.",
    "grat.2": "تخيّل شخصًا يجعل حياتك أنعم.",
    "grat.3": "لاحظ شيئًا فعله جسدك من أجلك اليوم.",
    "grat.4": "احملهم برفق، كيدين تحملان ضوءًا دافئًا.",
    "grat.close": "احمل هذه الخفّة معك.",
    "focus.1": "استدعِ ما تريد فعله الآن.",
    "focus.2": "تخيّل نفسك تفعله باهتمام هادئ وثابت.",
    "focus.3": "دع بقية العالم تتلاشى عند الأطراف.",
    "focus.4": "نَفَس واحد. شيء واحد. خطوة في كل مرة.",
    "focus.close": "أنت جاهز. تحرّك بنيّة.",
  },
};

const tr = (lc: string, key: string) => (STR[lc] || STR.en)[key] || STR.en[key] || key;

const TTS_LANG_MAP: Record<string, string> = {
  en: "en-US", fr: "fr-FR", es: "es-ES",
  it: "it-IT", de: "de-DE", pt: "pt-PT", ar: "ar-SA",
};

const FEMALE_HINTS: Record<string, string[]> = {
  en: ["samantha", "ava", "allison", "susan", "victoria", "karen", "moira", "tessa", "serena", "fiona", "kate", "zoe", "nicky", "female"],
  fr: ["audrey", "marie", "aurelie", "amelie", "virginie", "celine", "female"],
  es: ["monica", "paulina", "marisol", "esperanza", "maria", "soledad", "female"],
  it: ["alice", "federica", "silvia", "elsa", "carla", "female"],
  de: ["anna", "petra", "viktoria", "helena", "marlene", "female"],
  pt: ["joana", "luciana", "catarina", "ines", "fernanda", "female"],
  ar: ["maha", "laila", "salma", "amira", "female"],
};

const MALE_BLOCKLIST = [
  "thomas", "luca", "yannick", "diego", "jorge", "carlos", "daniel",
  "fred", "alex", "tom", "aaron", "arthur", "oliver", "rishi",
  "majed", "tarik", "khaled",
];

async function pickFemaleVoiceId(language: string): Promise<string | undefined> {
  try {
    const all = await Speech.getAvailableVoicesAsync();
    if (!all?.length) return undefined;
    const langPrefix = language.split("-")[0].toLowerCase();
    const langCode = language.toLowerCase();
    const inLang = all.filter((v) => {
      const l = (v.language || "").toLowerCase();
      return l === langCode || l.startsWith(langPrefix);
    });
    if (!inLang.length) return undefined;
    const QUALITY: Record<string, number> = { Premium: 3, Enhanced: 2, Default: 1 };
    const isMaleNamed = (v: any) => {
      const blob = `${v.name || ""} ${v.identifier || ""}`.toLowerCase();
      return MALE_BLOCKLIST.some((m) => blob.includes(m));
    };
    const score = (v: any) => {
      const blob = `${v.name || ""} ${v.identifier || ""}`.toLowerCase();
      const hints = FEMALE_HINTS[langPrefix] || [];
      let hintIdx = -1;
      for (let i = 0; i < hints.length; i++) {
        if (blob.includes(hints[i])) { hintIdx = i; break; }
      }
      const q = QUALITY[(v as any).quality || "Default"] || 1;
      const malePenalty = isMaleNamed(v) ? 1000 : 0;
      const hintScore = hintIdx >= 0 ? hintIdx : 500;
      return hintScore - q + malePenalty;
    };
    inLang.sort((a, b) => score(a) - score(b));
    return inLang[0]?.identifier;
  } catch {
    return undefined;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// MeditationOrb — same logo asset as breathing, just running on a slower
// continuous loop. Reusing the asset means the user sees a familiar visual
// signature across their wellness rituals.
// ──────────────────────────────────────────────────────────────────────────
function MeditationOrb({ scale }: { scale: Animated.Value }) {
  const opacity = scale.interpolate({
    inputRange: [0.55, 1.0],
    outputRange: [0.78, 1.0],
    extrapolate: "clamp",
  });
  const rotate = scale.interpolate({
    inputRange: [0.55, 1.0],
    // Slower drift than breathing so the rotation doesn't pull focus
    // from the narration.
    outputRange: ["0deg", "30deg"],
    extrapolate: "clamp",
  });
  return (
    <View style={orbStyles.wrap} pointerEvents="none">
      <Animated.Image
        source={require("../assets/images/breath-logo.png")}
        style={[
          orbStyles.logo,
          { opacity, transform: [{ scale }, { rotate }] },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

const orbStyles = StyleSheet.create({
  wrap: { width: 360, height: 360, alignItems: "center", justifyContent: "center" },
  logo: { width: 320, height: 320 },
});

// ──────────────────────────────────────────────────────────────────────────
// Pattern card — visual twin of the breath pattern card, kept distinct so
// each screen can evolve its picker independently.
// ──────────────────────────────────────────────────────────────────────────
function SessionCard({
  sessionKey,
  onPick,
  lc,
  gradient,
  icon,
  trialState,
}: {
  sessionKey: SessionKey;
  onPick: () => void;
  lc: string;
  gradient: [string, string];
  icon: keyof typeof Ionicons.glyphMap;
  // "free-available" → show a "Free trial" badge
  // "free-used"      → dim the card + lock icon
  // "unlimited"      → no badge (Pro/Zen)
  trialState: "free-available" | "free-used" | "unlimited";
}) {
  const T = (k: string) => tr(lc, k);
  const session = SESSIONS[sessionKey];
  const locked = trialState === "free-used";
  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPick} testID={`med-pick-${sessionKey}`}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[pickStyles.card, locked && pickStyles.cardLocked]}
      >
        <View style={pickStyles.headerRow}>
          <View style={pickStyles.iconWrap}>
            <Ionicons name={locked ? "lock-closed" : icon} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={pickStyles.cardTitle}>{T(`${sessionKey}.name`)}</Text>
            <Text style={pickStyles.cardTag}>{T(`${sessionKey}.tag`)}</Text>
          </View>
          {trialState === "free-available" ? (
            <View style={pickStyles.trialPill}>
              <Text style={pickStyles.trialTxt}>{T("trialBadge")}</Text>
            </View>
          ) : (
            <View style={pickStyles.lengthPill}>
              <Text style={pickStyles.lengthTxt}>{session.approxMinutes} {T("minutes")}</Text>
            </View>
          )}
        </View>
        <View style={pickStyles.bullets}>
          {[`${sessionKey}.b1`, `${sessionKey}.b2`, `${sessionKey}.b3`].map((k) => (
            <View key={k} style={pickStyles.bulletRow}>
              <View style={pickStyles.bulletDot} />
              <Text style={pickStyles.bulletTxt}>{T(k)}</Text>
            </View>
          ))}
        </View>
        <View style={pickStyles.cta}>
          <Text style={pickStyles.ctaTxt}>{locked ? T("upgrade") : T("start")}</Text>
          <Ionicons name="arrow-forward" size={16} color="#0E0A1F" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const pickStyles = StyleSheet.create({
  card: { borderRadius: 22, padding: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", gap: 14 },
  // Locked state: still tappable so the user can hit it and see the
  // upgrade alert — but the visual cue tells them immediately what's up.
  cardLocked: { opacity: 0.55 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  cardTitle: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  cardTag: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2, fontWeight: "600" },
  lengthPill: { backgroundColor: "rgba(0,0,0,0.30)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  lengthTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
  // The "Free trial" pill replaces the duration pill for free-available
  // themes — green to read as opportunity, not as a warning.
  trialPill: { backgroundColor: "rgba(16,185,129,0.30)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: "rgba(16,185,129,0.7)" },
  trialTxt: { color: "#fff", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  bullets: { gap: 6 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.85)" },
  bulletTxt: { color: "rgba(255,255,255,0.92)", fontSize: 13, lineHeight: 18, flex: 1 },
  cta: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 4 },
  ctaTxt: { color: "#0E0A1F", fontWeight: "900", fontSize: 13, letterSpacing: 0.3 },
});

// ──────────────────────────────────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────────────────────────────────
export default function MeditationScreen() {
  useI18n();
  const router = useRouter();
  const lc = currentLocale();
  const T = (k: string) => tr(lc, k);
  const ttsLanguage = TTS_LANG_MAP[lc] || "en-US";

  const [stage, setStage] = useState<"pick" | "play">("pick");
  const [sessionKey, setSessionKey] = useState<SessionKey>("sleep");
  const [running, setRunning] = useState(false);
  const [bestVoice, setBestVoice] = useState<string | undefined>();
  // The phrase currently being spoken — shown as a dim subtitle so deaf-
  // accessible users can follow without sound.
  const [currentPhrase, setCurrentPhrase] = useState<string>("");
  const [progress, setProgress] = useState(0);  // 0..1 across the session

  // Server-driven trial gate. We refetch on mount AND every time the user
  // returns to the picker stage after playing — so the "Free trial" badge
  // disappears from a card the moment they consume it.
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);

  const scale = useRef(new Animated.Value(0.55)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const timeouts = useRef<any[]>([]);
  const cancelled = useRef(false);

  const refreshEligibility = async () => {
    try {
      const e = await api<Eligibility>("/meditation/eligibility");
      setEligibility(e);
    } catch {
      // Network failure → assume Pro/unlimited so we don't lock out paying
      // users on a transient blip. The server is the source of truth on the
      // /start call regardless, so freeloading isn't actually possible here.
      setEligibility({ tier: "pro", used: [], remaining: ["sleep", "anxiety", "gratitude", "focus"], unlimited: true, themes: ["sleep", "anxiety", "gratitude", "focus"] });
    }
  };
  useEffect(() => { refreshEligibility(); }, []);

  // Pre-pick the soft female voice once per locale.
  useEffect(() => {
    let isCancelled = false;
    pickFemaleVoiceId(ttsLanguage).then((id) => {
      if (!isCancelled) setBestVoice(id);
    });
    return () => { isCancelled = true; };
  }, [ttsLanguage]);

  const stopAll = () => {
    cancelled.current = true;
    timeouts.current.forEach((t) => clearTimeout(t));
    timeouts.current = [];
    if (loopRef.current) {
      loopRef.current.stop();
      loopRef.current = null;
    }
    Speech.stop().catch(() => {});
    stopNarrator().catch(() => {});
    scale.stopAnimation();
    scale.setValue(0.55);
    setRunning(false);
    setCurrentPhrase("");
    setProgress(0);
  };

  // Always clean up on unmount.
  useEffect(() => () => stopAll(), []);

  // Continuous slow-breath loop for the orb. 4s in / 6s out — slower than
  // the breath screen so it feels meditative rather than instructive.
  const startBreathLoop = () => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.0,
          duration: 4000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.55,
          duration: 6000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    loopRef.current = loop;
  };

  /**
   * Walk through the session's cues one by one. We use Speech.speak's
   * onDone callback so we never have to estimate spoken duration — the
   * NEXT cue is queued exactly when the previous one finishes, then we
   * wait `pauseAfter` seconds before saying the next.
   */
  const runScript = (key: SessionKey) => {
    const session = SESSIONS[key];
    cancelled.current = false;
    let i = 0;

    // Common narrator opts — slower rate and slightly warmer pitch make
    // the meditation feel like a real instructor, not a TTS bot.
    const narratorOpts = {
      lang: (ttsLanguage || "en").split("-")[0],
      rate: "-15%",
      pitch: "-2Hz",
    };

    // Pre-warm the next 3 cues' audio in R2 so the natural voice
    // streams instantly when its turn comes. Best-effort, fire-and-forget.
    const prefetchAhead = (fromIdx: number) => {
      for (let k = fromIdx; k < Math.min(fromIdx + 3, session.cues.length); k++) {
        prefetchNeural(T(session.cues[k].id), narratorOpts);
      }
      prefetchNeural(T("closing"), narratorOpts);
    };
    prefetchAhead(0);

    const speakNext = () => {
      if (cancelled.current) return;
      if (i >= session.cues.length) {
        // End of session — final closing line + stop.
        const closing = T("closing");
        setCurrentPhrase(closing);
        setProgress(1);
        narrateNeural(closing, {
          ...narratorOpts,
          onFinish: () => {
            const t = setTimeout(() => {
              if (cancelled.current) return;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              stopAll();
            }, 1500);
            timeouts.current.push(t);
          },
        });
        return;
      }

      const cue = session.cues[i];
      const phrase = T(cue.id);
      setCurrentPhrase(phrase);
      setProgress(i / session.cues.length);
      narrateNeural(phrase, {
        ...narratorOpts,
        onFinish: () => {
          if (cancelled.current) return;
          // Pause AFTER the cue finishes, then move to the next.
          const t = setTimeout(() => {
            i += 1;
            prefetchAhead(i);
            speakNext();
          }, cue.pauseAfter * 1000);
          timeouts.current.push(t);
        },
      });
    };
    speakNext();
  };

  const start = async (key?: SessionKey) => {
    const sk = key || sessionKey;
    stopAll();
    setSessionKey(sk);

    // Server gate: claim the trial (Free) or no-op (Pro/Zen). If the user
    // exhausted their trial for this theme, we get a 402 and route them
    // to the paywall rather than starting the narration.
    try {
      await api("/meditation/start", {
        method: "POST",
        body: { theme: sk },
      });
    } catch (e: any) {
      const msg = String(e?.message || "");
      // 402 → paywall flow. We don't want to show a generic toast; surface
      // the upsell with an explicit Upgrade CTA.
      if (/402|trial/i.test(msg) || /upgrade/i.test(msg)) {
        setStage("pick");
        Alert.alert(
          T("trialUsedTitle"),
          T("trialUsedDesc"),
          [
            { text: T("notNow"), style: "cancel" },
            { text: T("upgrade"), onPress: () => router.push("/paywall") },
          ],
        );
      }
      // Refresh eligibility so the badge on the card updates immediately.
      refreshEligibility();
      return;
    }

    setRunning(true);
    cancelled.current = false;
    Haptics.selectionAsync().catch(() => {});
    startBreathLoop();
    // Tiny delay so the orb has time to begin its inhale before we speak —
    // makes the very first cue feel less abrupt.
    const t = setTimeout(() => runScript(sk), 600);
    timeouts.current.push(t);
    // Refresh now so the picker badge state is correct when the user
    // navigates back via "Change".
    refreshEligibility();
  };

  // ── Pick screen ───────────────────────────────────────────────────────
  if (stage === "pick") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn} testID="med-back">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{T("title")}</Text>
          <View style={styles.headerBtn} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 18, paddingBottom: 36 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.kicker}>{T("kicker")}</Text>
          <Text style={styles.bigTitle}>{T("pickTitle")}</Text>
          <Text style={styles.bigSub}>{T("pickSub")}</Text>

          <View style={{ marginTop: 22, gap: 14 }}>
            {(["sleep", "anxiety", "gratitude", "focus"] as SessionKey[]).map((k) => {
              // Resolve the trial state for this card from the eligibility
              // payload. Default to "unlimited" while we're loading so the
              // initial paint matches the Pro experience (no jarring badges
              // that disappear after mount).
              const trialState: "free-available" | "free-used" | "unlimited" =
                !eligibility || eligibility.unlimited
                  ? "unlimited"
                  : eligibility.used.includes(k)
                  ? "free-used"
                  : "free-available";
              const meta = (() => {
                switch (k) {
                  case "sleep":     return { gradient: ["#1E1B4B", "#4C1D95"] as [string, string], icon: "moon" as const };
                  case "anxiety":   return { gradient: ["#0EA5E9", "#0284C7"] as [string, string], icon: "leaf" as const };
                  case "gratitude": return { gradient: ["#F59E0B", "#D97706"] as [string, string], icon: "heart" as const };
                  case "focus":     return { gradient: ["#10B981", "#059669"] as [string, string], icon: "eye" as const };
                }
              })();
              return (
                <SessionCard
                  key={k}
                  sessionKey={k}
                  lc={lc}
                  gradient={meta.gradient}
                  icon={meta.icon}
                  trialState={trialState}
                  onPick={() => {
                    if (trialState === "free-used") {
                      // No need to enter the play stage — go straight to paywall.
                      Alert.alert(
                        T("trialUsedTitle"),
                        T("trialUsedDesc"),
                        [
                          { text: T("notNow"), style: "cancel" },
                          { text: T("upgrade"), onPress: () => router.push("/paywall") },
                        ],
                      );
                      return;
                    }
                    setSessionKey(k);
                    setStage("play");
                    setTimeout(() => start(k), 50);
                  }}
                />
              );
            })}
          </View>

          <Text style={styles.hint}>{T("headphones")}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Play screen ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { stopAll(); setStage("pick"); }}
          hitSlop={8}
          style={styles.headerBtn}
          testID="med-change"
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{T(`${sessionKey}.name`)}</Text>
        <TouchableOpacity
          onPress={() => { stopAll(); setStage("pick"); }}
          hitSlop={8}
          style={styles.headerChange}
        >
          <Text style={styles.headerChangeTxt}>{T("change")}</Text>
        </TouchableOpacity>
      </View>

      {/* Orb */}
      <View style={styles.orbWrap}>
        <MeditationOrb scale={scale} />
      </View>

      {/* Live phrase subtitle — fades softly between cues. Useful for
          accessibility and for users who want to read along quietly. */}
      <View style={styles.phraseRow}>
        <Text style={styles.phraseTxt} numberOfLines={3}>
          {currentPhrase || " "}
        </Text>
      </View>

      {/* Progress bar — thin, unobtrusive. */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      {/* CTA */}
      <View style={styles.ctaWrap}>
        {!running ? (
          <TouchableOpacity onPress={() => start(sessionKey)} style={styles.startBtn} testID="med-start">
            <Ionicons name="play" size={20} color="#0E0A1F" />
            <Text style={styles.startTxt}>{T("start")}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={stopAll} style={styles.stopBtn} testID="med-stop">
            <Ionicons name="stop" size={20} color="#fff" />
            <Text style={styles.stopTxt}>{T("stop")}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.hint}>{T("headphones")}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 10,
  },
  headerBtn: { width: 60, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center" },
  headerChange: { width: 60, height: 36, alignItems: "center", justifyContent: "center" },
  headerChangeTxt: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "700" },

  kicker: { color: COLORS.textTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 2.4, marginTop: 6 },
  bigTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -1, marginTop: 6 },
  bigSub: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8, maxWidth: 360 },

  orbWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  phraseRow: {
    minHeight: 70,
    paddingHorizontal: 32,
    alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  phraseTxt: {
    color: "#fff", fontSize: 18, fontWeight: "500",
    textAlign: "center", lineHeight: 26, letterSpacing: 0.2,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },

  progressTrack: {
    height: 3,
    marginHorizontal: 32,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 18,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.55)",
    borderRadius: 999,
  },

  ctaWrap: { alignItems: "center", marginBottom: 18 },
  startBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    height: 52, paddingHorizontal: 32, borderRadius: 999,
    backgroundColor: "#FACC15",
  },
  startTxt: { color: "#0E0A1F", fontWeight: "900", fontSize: 16, letterSpacing: 0.5 },
  stopBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    height: 52, paddingHorizontal: 32, borderRadius: 999,
    backgroundColor: "rgba(239,68,68,0.20)",
    borderWidth: 1, borderColor: "rgba(239,68,68,0.55)",
  },
  stopTxt: { color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: 0.5 },

  hint: {
    color: COLORS.textTertiary, fontSize: 11,
    textAlign: "center", paddingHorizontal: 24,
    marginBottom: 20, lineHeight: 16,
  },
});
