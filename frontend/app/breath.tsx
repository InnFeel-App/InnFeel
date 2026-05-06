import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import { useRouter } from "expo-router";
import { COLORS } from "../src/theme";
import { currentLocale } from "../src/i18n";

/**
 * Guided Breathing — paced, rhythmic exercise.
 *
 * Why this lives outside the chat coach:
 *  • The chat reads back free-form Claude replies — perfect for content.
 *  • Breathing requires *cadence-locked* audio cues. The TTS prompts must
 *    land precisely at the start of each phase (Inhale / Hold / Exhale)
 *    or the exercise feels off-beat. We schedule each `Speech.speak` via
 *    setTimeout from a known start timestamp so audio + animation stay
 *    married for the entire session.
 *  • The TTS rate is set deliberately (rate 0.85, faster than meditation)
 *    so the cue word completes well within the phase duration.
 *
 * Patterns offered:
 *   • 4-7-8  — relaxation / sleep prep (Dr. Andrew Weil)
 *   • Box    — 4-4-4-4, focus / anxiety (Navy SEALs box-breathing)
 *   • 5-5    — coherent breathing, HRV / heart-mind sync
 */
type Pattern = {
  key: string;
  label: string;
  subtitle: string;
  cycles: number;
  // Each phase: [seconds, label, ttsCue, animTo]
  phases: { sec: number; label: string; cue: string; scaleTo: number }[];
};

const PATTERNS: Record<string, Pattern> = {
  "4-7-8": {
    key: "4-7-8",
    label: "4-7-8",
    subtitle: "Relax · sleep prep",
    cycles: 4,
    phases: [
      { sec: 4, label: "Inhale", cue: "Breathe in",   scaleTo: 1.0 },
      { sec: 7, label: "Hold",   cue: "Hold",          scaleTo: 1.0 },
      { sec: 8, label: "Exhale", cue: "Breathe out",   scaleTo: 0.5 },
    ],
  },
  box: {
    key: "box",
    label: "Box",
    subtitle: "Focus · anxiety",
    cycles: 4,
    phases: [
      { sec: 4, label: "Inhale", cue: "Breathe in",   scaleTo: 1.0 },
      { sec: 4, label: "Hold",   cue: "Hold",          scaleTo: 1.0 },
      { sec: 4, label: "Exhale", cue: "Breathe out",   scaleTo: 0.5 },
      { sec: 4, label: "Hold",   cue: "Hold",          scaleTo: 0.5 },
    ],
  },
  coherent: {
    key: "coherent",
    label: "Coherent",
    subtitle: "Heart-mind sync",
    cycles: 6,
    phases: [
      { sec: 5, label: "Inhale", cue: "Breathe in",   scaleTo: 1.0 },
      { sec: 5, label: "Exhale", cue: "Breathe out",   scaleTo: 0.5 },
    ],
  },
};

// Localised cue words — TTS reads them at the start of each phase.
const CUE_I18N: Record<string, Record<string, string>> = {
  fr: { "Breathe in": "Inspire", "Hold": "Retiens", "Breathe out": "Expire" },
  es: { "Breathe in": "Inhala", "Hold": "Sostén", "Breathe out": "Exhala" },
  it: { "Breathe in": "Inspira", "Hold": "Trattieni", "Breathe out": "Espira" },
  de: { "Breathe in": "Einatmen", "Hold": "Halten", "Breathe out": "Ausatmen" },
  pt: { "Breathe in": "Inspira", "Hold": "Segura", "Breathe out": "Expira" },
  ar: { "Breathe in": "شهيق", "Hold": "احبس", "Breathe out": "زفير" },
};

const TTS_LANG_MAP: Record<string, string> = {
  en: "en-US", fr: "fr-FR", es: "es-ES",
  it: "it-IT", de: "de-DE", pt: "pt-PT", ar: "ar-SA",
};

export default function BreathScreen() {
  const router = useRouter();
  const lc = currentLocale();
  const ttsLanguage = TTS_LANG_MAP[lc] || "en-US";
  const cueDict = CUE_I18N[lc] || null;

  const [patternKey, setPatternKey] = useState<keyof typeof PATTERNS>("4-7-8");
  const [running, setRunning] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState("Ready");
  const [cycle, setCycle] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const scale = useRef(new Animated.Value(0.5)).current;
  const timeouts = useRef<any[]>([]);
  const tickRef = useRef<any>(null);

  // Pick the best installed voice once on mount.
  const [bestVoice, setBestVoice] = useState<string | undefined>();
  useEffect(() => {
    (async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (!voices?.length) return;
        const langPrefix = ttsLanguage.split("-")[0];
        const QUALITY: Record<string, number> = { Premium: 3, Enhanced: 2, Default: 1 };
        const sorted = voices
          .filter((v) => (v.language || "").startsWith(langPrefix))
          .sort((a, b) => (QUALITY[(b as any).quality || "Default"] || 1) - (QUALITY[(a as any).quality || "Default"] || 1));
        if (sorted[0]?.identifier) setBestVoice(sorted[0].identifier);
      } catch {}
    })();
  }, [ttsLanguage]);

  const stopAll = () => {
    timeouts.current.forEach((t) => clearTimeout(t));
    timeouts.current = [];
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    Speech.stop().catch(() => {});
    scale.stopAnimation();
    setRunning(false);
    setPhaseLabel("Ready");
    setCycle(0);
    setSecondsLeft(0);
  };

  // Always clean up on unmount or pattern change.
  useEffect(() => () => stopAll(), []);

  const speak = (text: string) => {
    Speech.speak(text, {
      language: ttsLanguage,
      voice: bestVoice,
      // Faster than meditation rate so the cue word fits inside short phases.
      rate: 0.92,
      pitch: 1.0,
    });
  };

  const start = () => {
    const p = PATTERNS[patternKey];
    if (!p) return;
    stopAll();
    setRunning(true);
    setCycle(1);

    // Build a flat schedule of (offsetMs, action) pairs covering ALL cycles.
    let offset = 0;
    let cycleIndex = 0;
    const schedule: { atMs: number; phase: typeof p.phases[0]; cycleIdx: number }[] = [];
    for (let c = 0; c < p.cycles; c++) {
      for (const ph of p.phases) {
        schedule.push({ atMs: offset, phase: ph, cycleIdx: c + 1 });
        offset += ph.sec * 1000;
      }
    }
    const totalDurationMs = offset;

    // Schedule each phase boundary precisely.
    for (const step of schedule) {
      const t = setTimeout(() => {
        const ph = step.phase;
        const localizedCue = cueDict ? (cueDict[ph.cue] || ph.cue) : ph.cue;
        speak(localizedCue);
        setPhaseLabel(ph.label);
        setSecondsLeft(ph.sec);
        setCycle(step.cycleIdx);
        // Animate the orb over the full phase duration (linear feels best for breath).
        Animated.timing(scale, {
          toValue: ph.scaleTo,
          duration: ph.sec * 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start();
      }, step.atMs);
      timeouts.current.push(t);
    }
    // Tick the visible countdown every 100ms (smoother than 1s).
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, +(s - 0.1).toFixed(1)));
    }, 100);
    // End-of-session callback.
    const endT = setTimeout(() => {
      stopAll();
      setPhaseLabel("Done ✦");
      const closing = lc === "fr" ? "Bien joué" : lc === "es" ? "Buen trabajo" : "Well done";
      speak(closing);
    }, totalDurationMs + 200);
    timeouts.current.push(endT);
  };

  const pattern = PATTERNS[patternKey];
  const totalSec = pattern.phases.reduce((s, p) => s + p.sec, 0) * pattern.cycles;

  const orbColor = (() => {
    if (phaseLabel === "Inhale") return ["#A78BFA", "#22D3EE"];
    if (phaseLabel === "Exhale") return ["#FACC15", "#F59E0B"];
    if (phaseLabel === "Hold")   return ["#34D399", "#10B981"];
    return ["#1E1B4B", "#4C1D95"];
  })();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { stopAll(); router.back(); }} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Breathing</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Pattern picker */}
      <View style={styles.patternRow}>
        {Object.values(PATTERNS).map((p) => (
          <TouchableOpacity
            key={p.key}
            onPress={() => { if (!running) setPatternKey(p.key as any); }}
            style={[styles.patternChip, patternKey === p.key && styles.patternChipActive, running && { opacity: 0.5 }]}
            disabled={running}
          >
            <Text style={[styles.patternLabel, patternKey === p.key && styles.patternLabelActive]}>{p.label}</Text>
            <Text style={styles.patternSub}>{p.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Big breathing orb */}
      <View style={styles.orbWrap}>
        <Animated.View style={{ transform: [{ scale }], width: 240, height: 240, borderRadius: 120, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          <LinearGradient
            colors={orbColor as [string, string]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <View style={styles.orbOverlay}>
          <Text style={styles.phaseTxt}>{phaseLabel}</Text>
          {running ? (
            <Text style={styles.countdown}>{Math.ceil(secondsLeft)}</Text>
          ) : null}
        </View>
      </View>

      {/* Counters */}
      <View style={styles.counterRow}>
        <View style={styles.counter}>
          <Text style={styles.counterLabel}>CYCLE</Text>
          <Text style={styles.counterVal}>{cycle}/{pattern.cycles}</Text>
        </View>
        <View style={styles.counter}>
          <Text style={styles.counterLabel}>TOTAL</Text>
          <Text style={styles.counterVal}>{Math.round(totalSec)}s</Text>
        </View>
      </View>

      {/* CTA */}
      <View style={styles.ctaWrap}>
        {!running ? (
          <TouchableOpacity onPress={start} style={styles.startBtn} testID="breath-start">
            <Ionicons name="play" size={20} color="#0E0A1F" />
            <Text style={styles.startTxt}>Start</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={stopAll} style={styles.stopBtn} testID="breath-stop">
            <Ionicons name="stop" size={20} color="#fff" />
            <Text style={styles.stopTxt}>Stop</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.hint}>
        ✦ Voice cues are read by your phone's on-device voice. Use headphones for best calm.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg, alignItems: "stretch" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10 },
  headerBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center" },

  patternRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 4, marginBottom: 24 },
  patternChip: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
  },
  patternChipActive: { backgroundColor: "rgba(167,139,250,0.18)", borderColor: "rgba(167,139,250,0.55)" },
  patternLabel: { color: "rgba(255,255,255,0.75)", fontSize: 14, fontWeight: "800", letterSpacing: 0.4 },
  patternLabelActive: { color: "#fff" },
  patternSub: { color: COLORS.textTertiary, fontSize: 10, marginTop: 2, letterSpacing: 0.3 },

  orbWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  orbOverlay: { position: "absolute", alignItems: "center", justifyContent: "center" },
  phaseTxt: { color: "#fff", fontSize: 26, fontWeight: "800", letterSpacing: 1, textShadowColor: "rgba(0,0,0,0.4)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  countdown: { color: "rgba(255,255,255,0.85)", fontSize: 16, marginTop: 4, fontWeight: "600" },

  counterRow: { flexDirection: "row", justifyContent: "center", gap: 22, marginVertical: 18 },
  counter: { alignItems: "center" },
  counterLabel: { color: COLORS.textTertiary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  counterVal: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 2 },

  ctaWrap: { alignItems: "center", marginBottom: 18 },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 8, height: 52, paddingHorizontal: 32, borderRadius: 999, backgroundColor: "#FACC15" },
  startTxt: { color: "#0E0A1F", fontWeight: "900", fontSize: 16, letterSpacing: 0.5 },
  stopBtn: { flexDirection: "row", alignItems: "center", gap: 8, height: 52, paddingHorizontal: 32, borderRadius: 999, backgroundColor: "rgba(239,68,68,0.20)", borderWidth: 1, borderColor: "rgba(239,68,68,0.55)" },
  stopTxt: { color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: 0.5 },

  hint: { color: COLORS.textTertiary, fontSize: 11, textAlign: "center", paddingHorizontal: 24, marginBottom: 20, lineHeight: 16 },
});
