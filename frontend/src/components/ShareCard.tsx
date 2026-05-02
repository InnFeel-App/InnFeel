import React, { forwardRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { EMOTION_COLORS } from "../theme";

type Props = {
  kind: "mood" | "stats";
  // mood
  word?: string;
  emotion?: string;
  intensity?: number;
  userName?: string;
  // stats
  streak?: number;
  dropsThisWeek?: number;
  dominant?: string;
  distribution?: Record<string, number>;
};

// This card is rendered off-screen (fixed 1080x1920 Stories size) and captured via react-native-view-shot.
const ShareCard = forwardRef<View, Props>(function ShareCard(props, ref) {
  const em = EMOTION_COLORS[props.emotion || props.dominant || "joy"] || EMOTION_COLORS.joy;
  const intensity = props.intensity || 0;
  const maxIntensity = intensity > 5 ? 10 : 5;
  const distEntries = Object.entries(props.distribution || {}).filter(([, v]) => Number(v) > 0);
  const distTotal = distEntries.reduce((a, [, v]) => a + Number(v), 0) || 1;

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <LinearGradient
        colors={[em.hex, "#1A0A2E", "#050505"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Multi-color blobs */}
      <View style={[styles.blob, { backgroundColor: em.hex, top: -240, left: -200, width: 800, height: 800, opacity: 0.55 }]} />
      <View style={[styles.blob, { backgroundColor: "#EC4899", bottom: -200, right: -120, width: 650, height: 650, opacity: 0.35 }]} />
      <View style={[styles.blob, { backgroundColor: "#06D6A0", top: 400, right: -80, width: 380, height: 380, opacity: 0.25 }]} />

      <View style={styles.content}>
        <Text style={styles.brand}>MOODDROP ✦</Text>

        {props.kind === "mood" ? (
          <>
            <Text style={styles.kicker}>
              {(props.userName || "Someone").toUpperCase()} FEELS
            </Text>
            <Text style={styles.hugeWord}>{props.word || "—"}</Text>
            <View style={styles.emotionRow}>
              <View style={[styles.dot, { backgroundColor: em.hex }]} />
              <Text style={styles.emotionLabel}>{em.label}</Text>
            </View>
            <View style={styles.intensityRow}>
              {Array.from({ length: maxIntensity }).map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: 42,
                    height: 10,
                    borderRadius: 5,
                    marginHorizontal: 3,
                    backgroundColor: i < intensity ? em.hex : "rgba(255,255,255,0.18)",
                  }}
                />
              ))}
            </View>
            <Text style={styles.intensityLabel}>
              intensity {intensity}/{maxIntensity}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.kicker}>{(props.userName || "My").toUpperCase()} WEEK</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statBig}>{props.streak || 0}</Text>
                <Text style={styles.statSmall}>day streak</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statBig}>{props.dropsThisWeek || 0}</Text>
                <Text style={styles.statSmall}>drops</Text>
              </View>
            </View>
            <Text style={styles.dominantTxt}>Dominant mood</Text>
            <View style={styles.emotionRow}>
              <View style={[styles.dot, { backgroundColor: em.hex }]} />
              <Text style={styles.emotionLabel}>{em.label}</Text>
            </View>
            <View style={styles.distWrap}>
              {distEntries.slice(0, 6).map(([k, v]) => {
                const c = EMOTION_COLORS[k]?.hex || "#999";
                const pct = Math.round((Number(v) / distTotal) * 100);
                return (
                  <View key={k} style={styles.distRow}>
                    <View style={[styles.distDot, { backgroundColor: c }]} />
                    <Text style={styles.distLabel}>{EMOTION_COLORS[k]?.label || k}</Text>
                    <View style={styles.distTrack}>
                      <View style={[styles.distFill, { width: `${pct}%`, backgroundColor: c }]} />
                    </View>
                    <Text style={styles.distPct}>{pct}%</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <View style={{ flex: 1 }} />
        <Text style={styles.footer}>Drop your mood. Unlock the others.</Text>
        <Text style={styles.footerHandle}>mooddrop.app</Text>
      </View>
    </View>
  );
});

export default ShareCard;

const styles = StyleSheet.create({
  card: {
    width: 1080,
    height: 1920,
    backgroundColor: "#050505",
    overflow: "hidden",
  },
  blob: { position: "absolute", borderRadius: 9999 },
  content: { flex: 1, padding: 80, paddingTop: 100 },
  brand: { color: "#fff", fontSize: 28, fontWeight: "700", letterSpacing: 6, opacity: 0.85 },
  kicker: { color: "rgba(255,255,255,0.55)", fontSize: 22, letterSpacing: 4, marginTop: 120, fontWeight: "600" },
  hugeWord: { color: "#fff", fontSize: 180, fontWeight: "800", letterSpacing: -4, marginTop: 18, lineHeight: 190 },
  emotionRow: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 32 },
  dot: { width: 42, height: 42, borderRadius: 21 },
  emotionLabel: { color: "#fff", fontSize: 56, fontWeight: "700" },
  intensityRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 44 },
  intensityLabel: { color: "rgba(255,255,255,0.55)", fontSize: 22, marginTop: 18, fontWeight: "500" },
  statsRow: { flexDirection: "row", gap: 32, marginTop: 60 },
  statBox: {
    flex: 1, padding: 40, borderRadius: 48, borderWidth: 2, borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  statBig: { color: "#fff", fontSize: 120, fontWeight: "800", lineHeight: 130 },
  statSmall: { color: "rgba(255,255,255,0.6)", fontSize: 26, marginTop: 4 },
  dominantTxt: { color: "rgba(255,255,255,0.55)", fontSize: 24, letterSpacing: 3, marginTop: 60, fontWeight: "600" },
  distWrap: { marginTop: 36, gap: 22 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 18 },
  distDot: { width: 24, height: 24, borderRadius: 12 },
  distLabel: { color: "#fff", width: 260, fontSize: 28, fontWeight: "600" },
  distTrack: { flex: 1, height: 18, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.1)" },
  distFill: { height: 18, borderRadius: 9 },
  distPct: { color: "rgba(255,255,255,0.8)", width: 100, textAlign: "right", fontSize: 26 },
  footer: { color: "rgba(255,255,255,0.85)", fontSize: 30, fontWeight: "600" },
  footerHandle: { color: "rgba(255,255,255,0.5)", fontSize: 24, marginTop: 8 },
});
