import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { COLORS } from "../src/theme";
import { currentLocale, useI18n } from "../src/i18n";

/**
 * Guided Breathing — paced, rhythmic exercise.
 *
 * Two stages, one screen:
 *   1) "pick"  → hero + 3 benefit cards (4-7-8 / Box / Coherent)
 *   2) "play"  → animated halo + logo orb + cadence-locked TTS
 *
 * Why this isn't part of the chat coach:
 *  • Chat reads back free-form Claude replies — perfect for free content.
 *  • Breathing requires *cadence-locked* audio cues. The TTS prompts must
 *    land precisely at the start of each phase (Inhale / Hold / Exhale)
 *    or the exercise feels off-beat. We schedule each `Speech.speak` via
 *    setTimeout from a known start timestamp, so audio + animation stay
 *    married for the entire session.
 *
 * Voice strategy:
 *  • The user requested a soft, calm, *female* voice. We pre-rank known
 *    female voice IDs per locale (Samantha, Audrey, Monica, Alice, Anna,
 *    Joana, Maha …) and prefer Premium → Enhanced → Default quality.
 *  • If no female voice can be detected, we fall back to the highest
 *    quality voice in the user's language so the exercise is never silent.
 *  • Speech rate is tuned slightly slow (0.88) for a meditative pace —
 *    fast enough that the cue word lands inside even short phases.
 */

type Phase = { sec: number; key: "inhale" | "hold" | "exhale"; scaleTo: number };
type Pattern = {
  key: "478" | "box" | "coherent";
  cycles: number;
  totalSec: number; // computed
  phases: Phase[];
};

const PATTERNS: Record<Pattern["key"], Pattern> = {
  "478": {
    key: "478",
    cycles: 4,
    totalSec: 0,
    phases: [
      { sec: 4, key: "inhale", scaleTo: 1.0 },
      { sec: 7, key: "hold",   scaleTo: 1.0 },
      { sec: 8, key: "exhale", scaleTo: 0.55 },
    ],
  },
  box: {
    key: "box",
    cycles: 4,
    totalSec: 0,
    phases: [
      { sec: 4, key: "inhale", scaleTo: 1.0 },
      { sec: 4, key: "hold",   scaleTo: 1.0 },
      { sec: 4, key: "exhale", scaleTo: 0.55 },
      { sec: 4, key: "hold",   scaleTo: 0.55 },
    ],
  },
  coherent: {
    key: "coherent",
    cycles: 6,
    totalSec: 0,
    phases: [
      { sec: 5, key: "inhale", scaleTo: 1.0 },
      { sec: 5, key: "exhale", scaleTo: 0.55 },
    ],
  },
};
// Compute total seconds once.
for (const p of Object.values(PATTERNS)) {
  p.totalSec = p.phases.reduce((s, ph) => s + ph.sec, 0) * p.cycles;
}

// ──────────────────────────────────────────────────────────────────────────
// i18n — kept inline because this is a self-contained feature. The main
// i18n.ts already overlays domain-specific bundles at boot; copying that
// pattern here keeps the breathing screen independent.
// ──────────────────────────────────────────────────────────────────────────
type LocaleStr = { [k: string]: string };
const STR: Record<string, LocaleStr> = {
  en: {
    title: "Breathing",
    kicker: "GUIDED BREATH",
    pickTitle: "Choose your breath",
    pickSub: "Each rhythm has a purpose. Pick the one that meets you today.",
    start: "Start",
    stop: "Stop",
    change: "Change",
    cycle: "CYCLE",
    total: "TOTAL",
    minutes: "min",
    inhale: "Inhale",
    hold: "Hold",
    exhale: "Exhale",
    ready: "Ready",
    done: "Done ✦",
    closing: "Well done",
    headphones: "✦ Use headphones for the calmest experience.",
    cueIn: "Breathe in",
    cueHold: "Hold",
    cueOut: "Breathe out",
    "478.name": "4-7-8 Relax",
    "478.tag": "Relax · Sleep",
    "478.b1": "Deep relaxation before sleep",
    "478.b2": "Slows the nervous system in 60 seconds",
    "478.b3": "Eases overthinking",
    "box.name": "Box 4-4-4-4",
    "box.tag": "Focus · Anxiety",
    "box.b1": "Restores clarity under pressure",
    "box.b2": "Used by Navy SEALs to stay sharp",
    "box.b3": "Calms a racing heartbeat",
    "coh.name": "Coherence 5-5",
    "coh.tag": "Heart · Mind sync",
    "coh.b1": "Balances heart rate and breath",
    "coh.b2": "Lowers stress hormones",
    "coh.b3": "Boosts emotional resilience",
  },
  fr: {
    title: "Respiration",
    kicker: "RESPIRATION GUIDÉE",
    pickTitle: "Choisis ta respiration",
    pickSub: "Chaque rythme a un but. Choisis celui qui te parle aujourd'hui.",
    start: "Commencer",
    stop: "Arrêter",
    change: "Changer",
    cycle: "CYCLE",
    total: "TOTAL",
    minutes: "min",
    inhale: "Inspire",
    hold: "Retiens",
    exhale: "Expire",
    ready: "Prêt",
    done: "Terminé ✦",
    closing: "Bien joué",
    headphones: "✦ Utilise des écouteurs pour une expérience plus douce.",
    cueIn: "Inspire",
    cueHold: "Retiens",
    cueOut: "Expire",
    "478.name": "4-7-8 Détente",
    "478.tag": "Détente · Sommeil",
    "478.b1": "Détente profonde avant le sommeil",
    "478.b2": "Apaise le système nerveux en 60 s",
    "478.b3": "Calme les pensées qui tournent",
    "box.name": "Carrée 4-4-4-4",
    "box.tag": "Concentration · Anxiété",
    "box.b1": "Retrouve de la clarté sous pression",
    "box.b2": "Utilisée par les Navy SEALs",
    "box.b3": "Calme le rythme cardiaque",
    "coh.name": "Cohérence 5-5",
    "coh.tag": "Cœur · Esprit",
    "coh.b1": "Synchronise cœur et respiration",
    "coh.b2": "Réduit les hormones du stress",
    "coh.b3": "Renforce la résilience émotionnelle",
  },
  es: {
    title: "Respiración",
    kicker: "RESPIRACIÓN GUIADA",
    pickTitle: "Elige tu respiración",
    pickSub: "Cada ritmo tiene un propósito. Elige el que te encuentre hoy.",
    start: "Empezar",
    stop: "Parar",
    change: "Cambiar",
    cycle: "CICLO",
    total: "TOTAL",
    minutes: "min",
    inhale: "Inhala",
    hold: "Sostén",
    exhale: "Exhala",
    ready: "Listo",
    done: "Hecho ✦",
    closing: "Buen trabajo",
    headphones: "✦ Usa auriculares para una experiencia más suave.",
    cueIn: "Inhala",
    cueHold: "Sostén",
    cueOut: "Exhala",
    "478.name": "4-7-8 Relax",
    "478.tag": "Relax · Sueño",
    "478.b1": "Relajación profunda antes de dormir",
    "478.b2": "Calma el sistema nervioso en 60 s",
    "478.b3": "Reduce los pensamientos rumiativos",
    "box.name": "Caja 4-4-4-4",
    "box.tag": "Foco · Ansiedad",
    "box.b1": "Devuelve claridad bajo presión",
    "box.b2": "Usada por los Navy SEALs",
    "box.b3": "Calma el ritmo cardíaco",
    "coh.name": "Coherencia 5-5",
    "coh.tag": "Corazón · Mente",
    "coh.b1": "Sincroniza ritmo cardíaco y respiración",
    "coh.b2": "Baja las hormonas del estrés",
    "coh.b3": "Refuerza la resiliencia emocional",
  },
  it: {
    title: "Respirazione",
    kicker: "RESPIRO GUIDATO",
    pickTitle: "Scegli il tuo respiro",
    pickSub: "Ogni ritmo ha uno scopo. Scegli quello che ti parla oggi.",
    start: "Inizia",
    stop: "Stop",
    change: "Cambia",
    cycle: "CICLO",
    total: "TOTALE",
    minutes: "min",
    inhale: "Inspira",
    hold: "Trattieni",
    exhale: "Espira",
    ready: "Pronto",
    done: "Fatto ✦",
    closing: "Ben fatto",
    headphones: "✦ Usa le cuffie per un'esperienza più dolce.",
    cueIn: "Inspira",
    cueHold: "Trattieni",
    cueOut: "Espira",
    "478.name": "4-7-8 Relax",
    "478.tag": "Relax · Sonno",
    "478.b1": "Rilassamento profondo prima di dormire",
    "478.b2": "Calma il sistema nervoso in 60 s",
    "478.b3": "Riduce i pensieri ossessivi",
    "box.name": "Box 4-4-4-4",
    "box.tag": "Focus · Ansia",
    "box.b1": "Ritrovi chiarezza sotto pressione",
    "box.b2": "Usata dai Navy SEAL",
    "box.b3": "Calma il battito accelerato",
    "coh.name": "Coerenza 5-5",
    "coh.tag": "Cuore · Mente",
    "coh.b1": "Sincronizza cuore e respiro",
    "coh.b2": "Abbassa gli ormoni dello stress",
    "coh.b3": "Aumenta la resilienza emotiva",
  },
  de: {
    title: "Atmung",
    kicker: "GEFÜHRTES ATMEN",
    pickTitle: "Wähle deinen Atem",
    pickSub: "Jeder Rhythmus hat einen Zweck. Wähle, was heute zu dir passt.",
    start: "Start",
    stop: "Stopp",
    change: "Ändern",
    cycle: "ZYKLUS",
    total: "GESAMT",
    minutes: "min",
    inhale: "Einatmen",
    hold: "Halten",
    exhale: "Ausatmen",
    ready: "Bereit",
    done: "Fertig ✦",
    closing: "Gut gemacht",
    headphones: "✦ Kopfhörer sorgen für die ruhigste Erfahrung.",
    cueIn: "Einatmen",
    cueHold: "Halten",
    cueOut: "Ausatmen",
    "478.name": "4-7-8 Entspannung",
    "478.tag": "Entspannung · Schlaf",
    "478.b1": "Tiefe Entspannung vor dem Schlaf",
    "478.b2": "Beruhigt das Nervensystem in 60 s",
    "478.b3": "Mindert Grübeln",
    "box.name": "Box 4-4-4-4",
    "box.tag": "Fokus · Angst",
    "box.b1": "Klarheit unter Druck",
    "box.b2": "Genutzt von Navy SEALs",
    "box.b3": "Beruhigt einen schnellen Puls",
    "coh.name": "Kohärenz 5-5",
    "coh.tag": "Herz · Geist",
    "coh.b1": "Synchronisiert Herz und Atem",
    "coh.b2": "Senkt Stresshormone",
    "coh.b3": "Stärkt emotionale Belastbarkeit",
  },
  pt: {
    title: "Respiração",
    kicker: "RESPIRAÇÃO GUIADA",
    pickTitle: "Escolhe a tua respiração",
    pickSub: "Cada ritmo tem um propósito. Escolhe o que te chega hoje.",
    start: "Começar",
    stop: "Parar",
    change: "Mudar",
    cycle: "CICLO",
    total: "TOTAL",
    minutes: "min",
    inhale: "Inspira",
    hold: "Segura",
    exhale: "Expira",
    ready: "Pronto",
    done: "Concluído ✦",
    closing: "Bem feito",
    headphones: "✦ Usa auscultadores para uma experiência mais suave.",
    cueIn: "Inspira",
    cueHold: "Segura",
    cueOut: "Expira",
    "478.name": "4-7-8 Relax",
    "478.tag": "Relax · Sono",
    "478.b1": "Relaxamento profundo antes de dormir",
    "478.b2": "Acalma o sistema nervoso em 60 s",
    "478.b3": "Reduz o excesso de pensamento",
    "box.name": "Caixa 4-4-4-4",
    "box.tag": "Foco · Ansiedade",
    "box.b1": "Recupera clareza sob pressão",
    "box.b2": "Usada pelos Navy SEALs",
    "box.b3": "Acalma o ritmo cardíaco",
    "coh.name": "Coerência 5-5",
    "coh.tag": "Coração · Mente",
    "coh.b1": "Sincroniza coração e respiração",
    "coh.b2": "Reduz as hormonas do stress",
    "coh.b3": "Aumenta a resiliência emocional",
  },
  ar: {
    title: "التنفس",
    kicker: "تنفس موجّه",
    pickTitle: "اختر نفسك",
    pickSub: "لكل إيقاع غاية. اختر ما يناسبك اليوم.",
    start: "ابدأ",
    stop: "إيقاف",
    change: "تغيير",
    cycle: "دورة",
    total: "المجموع",
    minutes: "دقيقة",
    inhale: "شهيق",
    hold: "احبس",
    exhale: "زفير",
    ready: "جاهز",
    done: "تم ✦",
    closing: "أحسنت",
    headphones: "✦ استخدم سماعات للحصول على تجربة أهدأ.",
    cueIn: "شهيق",
    cueHold: "احبس",
    cueOut: "زفير",
    "478.name": "استرخاء 4-7-8",
    "478.tag": "استرخاء · نوم",
    "478.b1": "استرخاء عميق قبل النوم",
    "478.b2": "يهدئ الجهاز العصبي خلال 60 ث",
    "478.b3": "يخفف التفكير الزائد",
    "box.name": "الصندوق 4-4-4-4",
    "box.tag": "تركيز · قلق",
    "box.b1": "يستعيد الصفاء تحت الضغط",
    "box.b2": "يستخدمه نخبة القوات الخاصة",
    "box.b3": "يهدئ تسارع نبض القلب",
    "coh.name": "التناغم 5-5",
    "coh.tag": "القلب · العقل",
    "coh.b1": "يوفّق بين القلب والنفس",
    "coh.b2": "يخفض هرمونات التوتر",
    "coh.b3": "يعزّز المرونة العاطفية",
  },
};
const tr = (lc: string, key: string) => (STR[lc] || STR.en)[key] || STR.en[key] || key;

// ──────────────────────────────────────────────────────────────────────────
// Voice helpers
// ──────────────────────────────────────────────────────────────────────────
const TTS_LANG_MAP: Record<string, string> = {
  en: "en-US", fr: "fr-FR", es: "es-ES",
  it: "it-IT", de: "de-DE", pt: "pt-PT", ar: "ar-SA",
};

/**
 * Known soft, calm female voice identifiers per language.
 * Order = preference. Both Apple's voice "name" field and the "identifier"
 * may contain these tokens (Apple's identifier is like
 * "com.apple.ttsbundle.Samantha-compact"). We test against both.
 */
const FEMALE_HINTS: Record<string, string[]> = {
  en: [
    "samantha", "ava", "allison", "susan", "victoria", "karen", "moira", "tessa",
    "serena", "fiona", "kate", "zoe", "nicky", "female",
  ],
  fr: [
    "audrey", "marie", "aurelie", "thomas",  // Thomas is male — kept last as guard
    "amelie", "virginie", "celine", "female",
  ],
  es: ["monica", "paulina", "marisol", "esperanza", "maria", "soledad", "female"],
  it: ["alice", "federica", "silvia", "elsa", "carla", "luca",  /* luca = male, last */ "female"],
  de: ["anna", "petra", "viktoria", "helena", "marlene", "yannick", /* male, last */ "female"],
  pt: ["joana", "luciana", "catarina", "ines", "fernanda", "female"],
  ar: ["maha", "laila", "salma", "amira", "female"],
};

// Voices we *don't* want even if they match the language (clearly male).
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
      // Lower is better → prioritise hint match (early index = high priority),
      // then highest quality. Male-named voices are de-prioritised hard.
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
// UI Components
// ──────────────────────────────────────────────────────────────────────────

/**
 * The breathing orb: app logo at the centre, surrounded by 3 soft halos
 * that scale together. Halos use semi-transparent overlapping circles to
 * fake a radial glow (no SVG needed). The tint shifts per phase to give
 * a subliminal cue: cyan-violet on inhale, amber on exhale, emerald on
 * hold — matches the rest of InnFeel's emotional palette.
 */
function BreathOrb({
  scale,
  phaseKey,
}: {
  scale: Animated.Value;
  phaseKey: "inhale" | "hold" | "exhale" | "idle";
}) {
  const tint = useMemo(() => {
    if (phaseKey === "inhale") return { c1: "#A78BFA", c2: "#22D3EE", glow: "rgba(167,139,250,0.55)" };
    if (phaseKey === "exhale") return { c1: "#FBBF24", c2: "#F59E0B", glow: "rgba(251,191,36,0.45)" };
    if (phaseKey === "hold")   return { c1: "#34D399", c2: "#10B981", glow: "rgba(52,211,153,0.45)" };
    return { c1: "#4C1D95", c2: "#1E1B4B", glow: "rgba(167,139,250,0.30)" };
  }, [phaseKey]);

  // Halo rings — each one tracks the same scale value but with extra padding.
  // The outermost ring is the largest & faintest, the inner ring is brighter.
  return (
    <View style={orbStyles.wrap} pointerEvents="none">
      {/* Outer halo — softest, biggest */}
      <Animated.View
        style={[
          orbStyles.halo,
          { width: 320, height: 320, borderRadius: 160, backgroundColor: tint.glow, opacity: 0.35,
            transform: [{ scale }] },
        ]}
      />
      {/* Mid halo */}
      <Animated.View
        style={[
          orbStyles.halo,
          { width: 270, height: 270, borderRadius: 135, backgroundColor: tint.glow, opacity: 0.55,
            transform: [{ scale }] },
        ]}
      />
      {/* Core gradient orb */}
      <Animated.View
        style={[
          orbStyles.core,
          { transform: [{ scale }] },
        ]}
      >
        <LinearGradient
          colors={[tint.c1, tint.c2]}
          start={{ x: 0.15, y: 0.15 }}
          end={{ x: 0.85, y: 0.85 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Soft inner highlight to give the orb depth */}
        <View style={orbStyles.highlight} />
        {/* InnFeel petal mark — built from primitives so we never have to
            fight a wordmark crop. Six soft, overlapping circles in the app's
            emotional palette form the signature aura bloom. */}
        <PetalMark />
      </Animated.View>
    </View>
  );
}

/**
 * The InnFeel mark, drawn from React Native primitives.
 *
 * Why not the icon.png?  The shipped raster includes the "InnFeel" wordmark
 * baked into the lower half. Cropping reliably across iOS, Android and web
 * is messy. Composing the mark from 6 soft circles gives us:
 *   • crisp edges at every DPR
 *   • the same bloom shape the splash & adaptive icons use
 *   • zero asset dependency (works offline, never cached wrong)
 * The hex values come straight from theme.ts EMOTION_COLORS.
 */
function PetalMark() {
  // 6 petals positioned around the centre on a small circle. Indexes:
  //   0=top, 1=top-right, 2=bottom-right, 3=bottom, 4=bottom-left, 5=top-left
  const PETALS: { color: string; angle: number }[] = [
    { color: "#FACC15", angle: -90  }, // joy / yellow
    { color: "#EC4899", angle: -30  }, // love / pink
    { color: "#22D3EE", angle:  30  }, // motivated / cyan
    { color: "#10B981", angle:  90  }, // peace / green
    { color: "#FF7A00", angle:  150 }, // excitement / orange
    { color: "#A855F7", angle:  210 }, // inspired / purple
  ];
  const RADIUS = 22;        // distance from centre to petal centre
  const PETAL_SIZE = 48;    // each soft circle's diameter
  return (
    <View style={petalStyles.wrap}>
      {PETALS.map((p, i) => {
        const rad = (p.angle * Math.PI) / 180;
        const dx = Math.cos(rad) * RADIUS;
        const dy = Math.sin(rad) * RADIUS;
        return (
          <View
            key={i}
            style={[
              petalStyles.petal,
              {
                width: PETAL_SIZE,
                height: PETAL_SIZE,
                borderRadius: PETAL_SIZE / 2,
                backgroundColor: p.color,
                transform: [{ translateX: dx }, { translateY: dy }],
              },
            ]}
          />
        );
      })}
      {/* Inner highlight — a small luminous core that ties the petals
          together and sells the "aura" feeling. */}
      <View style={petalStyles.core} />
    </View>
  );
}

const petalStyles = StyleSheet.create({
  wrap: {
    width: 130,
    height: 130,
    alignItems: "center",
    justifyContent: "center",
  },
  petal: {
    position: "absolute",
    opacity: 0.85,
    // Subtle bloom: a wide soft shadow makes neighbouring petals melt into
    // each other (tested on iOS/Android — Android falls back gracefully via
    // elevation). On web the box-shadow polyfill takes over.
    shadowColor: "#fff",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  core: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff",
    opacity: 0.95,
    shadowColor: "#fff",
    shadowOpacity: 0.95,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
});

const orbStyles = StyleSheet.create({
  wrap: {
    width: 340,
    height: 340,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
  },
  core: {
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#A78BFA",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 28,
    elevation: 12,
  },
  highlight: {
    position: "absolute",
    top: 18,
    left: 30,
    width: 80,
    height: 60,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.18)",
    transform: [{ rotate: "-20deg" }],
  },
});

// ──────────────────────────────────────────────────────────────────────────
// Pattern Picker Card
// ──────────────────────────────────────────────────────────────────────────
function PatternCard({
  patternKey,
  onPick,
  lc,
  gradient,
  icon,
}: {
  patternKey: Pattern["key"];
  onPick: () => void;
  lc: string;
  gradient: [string, string];
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const T = (k: string) => tr(lc, k);
  const prefix = patternKey === "478" ? "478" : patternKey === "box" ? "box" : "coh";
  const pattern = PATTERNS[patternKey];
  const minutes = Math.round(pattern.totalSec / 60);
  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPick} testID={`breath-pick-${patternKey}`}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={pickStyles.card}
      >
        <View style={pickStyles.headerRow}>
          <View style={pickStyles.iconWrap}>
            <Ionicons name={icon} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={pickStyles.cardTitle}>{T(`${prefix}.name`)}</Text>
            <Text style={pickStyles.cardTag}>{T(`${prefix}.tag`)}</Text>
          </View>
          <View style={pickStyles.lengthPill}>
            <Text style={pickStyles.lengthTxt}>{minutes} {T("minutes")}</Text>
          </View>
        </View>
        <View style={pickStyles.bullets}>
          {[`${prefix}.b1`, `${prefix}.b2`, `${prefix}.b3`].map((k) => (
            <View key={k} style={pickStyles.bulletRow}>
              <View style={pickStyles.bulletDot} />
              <Text style={pickStyles.bulletTxt}>{T(k)}</Text>
            </View>
          ))}
        </View>
        <View style={pickStyles.cta}>
          <Text style={pickStyles.ctaTxt}>{T("start")}</Text>
          <Ionicons name="arrow-forward" size={16} color="#0E0A1F" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const pickStyles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 14,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  cardTag:   { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2, fontWeight: "600" },
  lengthPill: {
    backgroundColor: "rgba(0,0,0,0.30)",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  lengthTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
  bullets: { gap: 6 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.85)" },
  bulletTxt: { color: "rgba(255,255,255,0.92)", fontSize: 13, lineHeight: 18, flex: 1 },
  cta: {
    alignSelf: "flex-start",
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#fff",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    marginTop: 4,
  },
  ctaTxt: { color: "#0E0A1F", fontWeight: "900", fontSize: 13, letterSpacing: 0.3 },
});

// ──────────────────────────────────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────────────────────────────────
export default function BreathScreen() {
  // Subscribe to locale changes so the screen re-renders when the user
  // switches languages from Profile → Settings.
  useI18n();
  const router = useRouter();
  const lc = currentLocale();
  const T = (k: string) => tr(lc, k);
  const ttsLanguage = TTS_LANG_MAP[lc] || "en-US";

  const [stage, setStage] = useState<"pick" | "play">("pick");
  const [patternKey, setPatternKey] = useState<Pattern["key"]>("478");
  const [running, setRunning] = useState(false);
  const [phaseKey, setPhaseKey] = useState<"inhale" | "hold" | "exhale" | "idle">("idle");
  const [cycle, setCycle] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [bestVoice, setBestVoice] = useState<string | undefined>();

  const scale = useRef(new Animated.Value(0.55)).current;
  const timeouts = useRef<any[]>([]);
  const tickRef = useRef<any>(null);

  // Pre-pick a soft female voice once per locale.
  useEffect(() => {
    let cancelled = false;
    pickFemaleVoiceId(ttsLanguage).then((id) => {
      if (!cancelled) setBestVoice(id);
    });
    return () => { cancelled = true; };
  }, [ttsLanguage]);

  const stopAll = () => {
    timeouts.current.forEach((t) => clearTimeout(t));
    timeouts.current = [];
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    Speech.stop().catch(() => {});
    scale.stopAnimation();
    setRunning(false);
    setPhaseKey("idle");
    setCycle(0);
    setSecondsLeft(0);
  };

  // Always clean up on unmount.
  useEffect(() => () => stopAll(), []);

  const speak = (text: string) => {
    Speech.speak(text, {
      language: ttsLanguage,
      voice: bestVoice,
      // Slower than conversational speech so each cue feels like a soft
      // exhalation — calmer pacing for a mindfulness exercise.
      rate: Platform.OS === "ios" ? 0.46 : 0.88,
      pitch: 1.0,
    });
  };

  // Map phase keys to the localised TTS cue word.
  const cueFor = (k: Phase["key"]) => {
    if (k === "inhale") return T("cueIn");
    if (k === "exhale") return T("cueOut");
    return T("cueHold");
  };

  const start = () => {
    const p = PATTERNS[patternKey];
    if (!p) return;
    stopAll();
    setRunning(true);
    setCycle(1);

    // Build a flat schedule covering every phase in every cycle, then drop
    // a setTimeout at each boundary so audio + animation stay locked.
    let offset = 0;
    const schedule: { atMs: number; phase: Phase; cycleIdx: number }[] = [];
    for (let c = 0; c < p.cycles; c++) {
      for (const ph of p.phases) {
        schedule.push({ atMs: offset, phase: ph, cycleIdx: c + 1 });
        offset += ph.sec * 1000;
      }
    }
    const totalDurationMs = offset;

    for (const step of schedule) {
      const t = setTimeout(() => {
        const ph = step.phase;
        speak(cueFor(ph.key));
        setPhaseKey(ph.key);
        setSecondsLeft(ph.sec);
        setCycle(step.cycleIdx);
        // Soft haptic at every phase change — a subliminal "land" so the
        // user feels the rhythm physically, not just hears it.
        Haptics.selectionAsync().catch(() => {});
        Animated.timing(scale, {
          toValue: ph.scaleTo,
          duration: ph.sec * 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start();
      }, step.atMs);
      timeouts.current.push(t);
    }

    // Visible countdown (10Hz so it ticks down smoothly in big text).
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, +(s - 0.1).toFixed(1)));
    }, 100);

    // End-of-session: gentle closing line.
    const endT = setTimeout(() => {
      stopAll();
      setPhaseKey("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Speak the closing greeting with a small delay so it doesn't collide
      // with the last "exhale" cue still finishing on slow devices.
      setTimeout(() => speak(T("closing")), 250);
    }, totalDurationMs + 200);
    timeouts.current.push(endT);
  };

  const pattern = PATTERNS[patternKey];

  // ── Pick screen ───────────────────────────────────────────────────────
  if (stage === "pick") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn} testID="breath-back">
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
            <PatternCard
              patternKey="478"
              lc={lc}
              gradient={["#7C3AED", "#4338CA"]}
              icon="moon"
              onPick={() => { setPatternKey("478"); setStage("play"); setTimeout(start, 50); }}
            />
            <PatternCard
              patternKey="box"
              lc={lc}
              gradient={["#06B6D4", "#0EA5E9"]}
              icon="square-outline"
              onPick={() => { setPatternKey("box"); setStage("play"); setTimeout(start, 50); }}
            />
            <PatternCard
              patternKey="coherent"
              lc={lc}
              gradient={["#10B981", "#059669"]}
              icon="heart"
              onPick={() => { setPatternKey("coherent"); setStage("play"); setTimeout(start, 50); }}
            />
          </View>

          <Text style={styles.hint}>{T("headphones")}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Play screen ───────────────────────────────────────────────────────
  const phaseLabel =
    phaseKey === "inhale" ? T("inhale") :
    phaseKey === "exhale" ? T("exhale") :
    phaseKey === "hold"   ? T("hold")   :
    T("ready");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { stopAll(); setStage("pick"); }}
          hitSlop={8}
          style={styles.headerBtn}
          testID="breath-change"
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {T(patternKey === "478" ? "478.name" : patternKey === "box" ? "box.name" : "coh.name")}
        </Text>
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
        <BreathOrb scale={scale} phaseKey={phaseKey} />
      </View>

      {/* Phase label + countdown — placed *below* the orb so the petal
          mark stays unobscured. The label fades the colour cue (no
          gradient on text, just a clean white) to keep the orb itself
          as the only colourful element on this screen. */}
      <View style={styles.phaseRow}>
        <Text style={styles.phaseTxt}>{phaseLabel}</Text>
        {running ? (
          <Text style={styles.countdown}>{Math.ceil(secondsLeft)}</Text>
        ) : null}
      </View>

      {/* Counters */}
      <View style={styles.counterRow}>
        <View style={styles.counter}>
          <Text style={styles.counterLabel}>{T("cycle")}</Text>
          <Text style={styles.counterVal}>{cycle}/{pattern.cycles}</Text>
        </View>
        <View style={styles.counter}>
          <Text style={styles.counterLabel}>{T("total")}</Text>
          <Text style={styles.counterVal}>{Math.round(pattern.totalSec)}s</Text>
        </View>
      </View>

      {/* CTA */}
      <View style={styles.ctaWrap}>
        {!running ? (
          <TouchableOpacity onPress={start} style={styles.startBtn} testID="breath-start">
            <Ionicons name="play" size={20} color="#0E0A1F" />
            <Text style={styles.startTxt}>{T("start")}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={stopAll} style={styles.stopBtn} testID="breath-stop">
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

  orbWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Phase label sits *below* the orb so the petal mark stays visible.
  phaseRow: {
    alignItems: "center",
    marginTop: -10,
    marginBottom: 6,
    minHeight: 48,
  },
  phaseTxt: {
    color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: 1,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  countdown: { color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 2, fontWeight: "600", letterSpacing: 0.5 },

  counterRow: { flexDirection: "row", justifyContent: "center", gap: 22, marginVertical: 18 },
  counter: { alignItems: "center" },
  counterLabel: { color: COLORS.textTertiary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  counterVal: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 2 },

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
