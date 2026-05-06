import React, { forwardRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { EMOTION_COLORS } from "../theme";

const MEDAL_COLORS = ["#FACC15", "#D1D5DB", "#CD7F32"]; // gold / silver / bronze

type Insight = {
  id?: string;
  title: string;
  subtitle?: string;
  tone?: "positive" | "warning" | "neutral";
};

type Achievement = { key: string; label: string; hint?: string };

type LeaderboardCategoryShare = {
  key: string;
  label: string;
  color: string;
  suffix: string;
  icon?: string;
  top3: Array<{ name: string; value: number; isMe: boolean; rank: number; avatar_color?: string | null }>;
  myRank?: number | null;
  total: number;
};

type Props = {
  kind: "mood" | "stats" | "leaderboard";
  // mood
  word?: string;
  emotion?: string;
  intensity?: number;
  userName?: string;
  music?: { title?: string; artist?: string } | null;
  // stats — RICH PAYLOAD (aligned with the in-app Insights page)
  streak?: number;
  auras?: number;              // total auras shared (renamed from "drops")
  aurasThisWeek?: number;      // for "this week" sub-line
  uniqueEmotions?: number;     // # of distinct emotions used
  reactionsReceived?: number;  // total reactions on user's auras
  dominant?: string;
  distribution?: Record<string, number>;
  insights?: Insight[];        // up to 3 cards from /moods/insights
  achievements?: Achievement[]; // earned badges (top 3 shown)
  // leaderboard — top3 per category + user's rank if outside top3
  categories?: LeaderboardCategoryShare[];
};

// This card is rendered off-screen (fixed 1080x1920 Stories size) and captured via react-native-view-shot.
// NOTE: Using `forwardRef<View, Props>` (two type params) confuses Babel's TSX
// parser ("Missing initializer" error) because the `<View,` looks like a JSX
// fragment to it. Annotating params instead is unambiguous.
const ShareCard = forwardRef((props: Props, ref: React.Ref<View>) => {
  const em = EMOTION_COLORS[props.emotion || props.dominant || "joy"] || EMOTION_COLORS.joy;
  const intensity = props.intensity || 0;
  const maxIntensity = intensity > 5 ? 10 : 5;
  const distEntries = Object.entries(props.distribution || {}).filter(([, v]) => Number(v) > 0);
  distEntries.sort((a, b) => Number(b[1]) - Number(a[1]));
  const distTotal = distEntries.reduce((a, [, v]) => a + Number(v), 0) || 1;

  const insightsTop = (props.insights || []).slice(0, 3);
  const achievementsTop = (props.achievements || []).slice(0, 3);

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
        <Text style={styles.brand}>INNFEEL ✦</Text>

        {props.kind === "mood" ? (
          <>
            {/* Top-right: EMOTION as the bold colored title (in its OWN
                emotion-color from the palette). Sized dynamically so long
                emotions like "Overwhelmed" / "Unmotivated" still fit on a
                single line within 1080 - 2×80 = 920px usable width. */}
            {(() => {
              const emoTxt = (em.label || "").toUpperCase();
              const emoLen = emoTxt.length;
              const emoSize = emoLen >= 11 ? 150 : emoLen >= 9 ? 175 : emoLen >= 7 ? 200 : 220;
              return (
                <View style={styles.headlineRight}>
                  <Text
                    style={[
                      styles.emotionTitleRight,
                      {
                        fontSize: emoSize,
                        lineHeight: Math.round(emoSize * 1.02),
                        color: em.hex,
                      },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {emoTxt}
                  </Text>
                </View>
              );
            })()}
            {/* Word — kept at the ORIGINAL location (under the kicker, big
                white headline). Only the emotion moved to top-right. */}
            <Text style={styles.kicker}>
              {(props.userName || "Someone").toUpperCase()} FEELS
            </Text>
            <Text style={styles.hugeWord}>{props.word || "—"}</Text>
            <View style={styles.emotionRow}>
              <View style={[styles.dot, { backgroundColor: em.hex }]} />
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
            {props.music?.title ? (
              <View style={styles.musicRow}>
                <Text style={styles.musicIcon}>🎵</Text>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.musicTitle} numberOfLines={1}>{props.music.title}</Text>
                  {props.music.artist ? <Text style={styles.musicArtist} numberOfLines={1}>{props.music.artist}</Text> : null}
                </View>
              </View>
            ) : null}
          </>
        ) : props.kind === "stats" ? (
          <>
            <Text style={styles.kicker}>{(props.userName || "MY").toUpperCase()} EMOTIONAL JOURNEY</Text>

            {/* 4-stat hero grid — streak, total auras, unique emotions, reactions */}
            <View style={styles.heroGrid}>
              <StatCell big={props.streak || 0} label="day streak" accent="#FB923C" />
              <StatCell big={props.auras || 0} label="auras shared" accent={em.hex} />
              <StatCell big={props.uniqueEmotions || 0} label="emotions explored" accent="#22D3EE" />
              <StatCell big={props.reactionsReceived || 0} label="reactions received" accent="#F472B6" />
            </View>

            {/* Dominant + this-week tag */}
            <View style={styles.dominantBlock}>
              <Text style={styles.dominantTxt}>DOMINANT MOOD</Text>
              <View style={styles.emotionRow}>
                <View style={[styles.dot, { backgroundColor: em.hex }]} />
                <Text style={styles.emotionLabel}>{em.label}</Text>
              </View>
              {typeof props.aurasThisWeek === "number" && props.aurasThisWeek > 0 ? (
                <Text style={styles.thisWeek}>
                  {props.aurasThisWeek} aura{props.aurasThisWeek === 1 ? "" : "s"} this week
                </Text>
              ) : null}
            </View>

            {/* Insights cards (max 3) */}
            {insightsTop.length > 0 ? (
              <View style={styles.insightsWrap}>
                <Text style={styles.sectionLabel}>INSIGHTS</Text>
                {insightsTop.map((it, i) => {
                  const tint =
                    it.tone === "positive" ? "#22C55E"
                    : it.tone === "warning" ? "#F97316"
                    : "#A78BFA";
                  return (
                    <View key={i} style={[styles.insightChip, { borderColor: tint + "55", backgroundColor: tint + "18" }]}>
                      <View style={[styles.insightDot, { backgroundColor: tint }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.insightTitle} numberOfLines={2}>{it.title}</Text>
                        {it.subtitle ? <Text style={styles.insightSub} numberOfLines={2}>{it.subtitle}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Top emotions distribution */}
            {distEntries.length > 0 ? (
              <View style={styles.distWrap}>
                <Text style={styles.sectionLabel}>TOP EMOTIONS</Text>
                {distEntries.slice(0, 4).map(([k, v]) => {
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
            ) : null}

            {/* Achievements row */}
            {achievementsTop.length > 0 ? (
              <View style={styles.achievementsWrap}>
                <Text style={styles.sectionLabel}>ACHIEVEMENTS</Text>
                <View style={styles.achievementsRow}>
                  {achievementsTop.map((a) => (
                    <View key={a.key} style={styles.achBadge}>
                      <Text style={styles.achStar}>✦</Text>
                      <Text style={styles.achLabel} numberOfLines={1}>{a.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : props.kind === "leaderboard" ? (
          <>
            <Text style={styles.kicker}>{(props.userName || "OUR").toUpperCase()} CIRCLE LEADERBOARD</Text>

            {(props.categories || []).map((cat) => (
              <View key={cat.key} style={styles.lbCard}>
                <View style={styles.lbHdrRow}>
                  <View style={[styles.lbBadge, { backgroundColor: cat.color + "30", borderColor: cat.color + "70" }]}>
                    <Text style={[styles.lbBadgeTxt, { color: cat.color }]}>★</Text>
                  </View>
                  <Text style={styles.lbCatTitle}>{cat.label}</Text>
                </View>

                {(cat.top3 || []).map((row) => (
                  <View
                    key={`${cat.key}-${row.rank}-${row.name}`}
                    style={[styles.lbRow, row.isMe && styles.lbRowMe]}
                  >
                    <View style={[styles.lbMedal, { backgroundColor: MEDAL_COLORS[Math.max(0, row.rank - 1)] || "#94A3B8" }]}>
                      <Text style={styles.lbMedalTxt}>{row.rank}</Text>
                    </View>
                    <View style={[styles.lbAvatar, { backgroundColor: row.avatar_color || "#A78BFA" }]}>
                      <Text style={styles.lbAvatarTxt}>{(row.name || "?").slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <Text style={[styles.lbName, row.isMe && { fontWeight: "800" }]} numberOfLines={1}>
                      {row.isMe ? "You" : row.name}
                    </Text>
                    <Text style={[styles.lbValue, { color: cat.color }]}>
                      {row.value} <Text style={styles.lbValueSub}>{cat.suffix}</Text>
                    </Text>
                  </View>
                ))}

                {cat.myRank && cat.myRank > 3 ? (
                  <Text style={styles.lbMyRankLine}>You: #{cat.myRank} of {cat.total}</Text>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <></>
        )}

        <View style={{ flex: 1 }} />
        <Text style={styles.footer}>One aura a day! Twenty seconds. Full color!</Text>
        <Text style={styles.footerSub}>Share yours. Unlock the others.</Text>
        <Text style={styles.footerHandle}>innfeel.app</Text>
      </View>
    </View>
  );
});

function StatCell({ big, label, accent }: { big: number; label: string; accent: string }) {
  return (
    <View style={[styles.statBox, { borderColor: accent + "44" }]}>
      <Text style={[styles.statBig, { color: "#fff" }]}>{big}</Text>
      <Text style={[styles.statSmall, { color: accent }]}>{label}</Text>
    </View>
  );
}

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
  // Emotion title — anchored top-right via absolute positioning so the
  // existing layout (kicker → word → intensity → music) keeps its original
  // vertical rhythm. Color is set inline from the emotion palette so each
  // aura wears its own brand color.
  headlineRight: {
    position: "absolute",
    top: 100,
    right: 80,
    maxWidth: 720,
    alignItems: "flex-end",
  },
  emotionTitleRight: {
    fontWeight: "900",
    letterSpacing: -3,
    textAlign: "right",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 16,
  },
  // Original styles preserved (kicker / word stay at original location,
  // unchanged from the pre-edit layout).
  kicker: { color: "rgba(255,255,255,0.55)", fontSize: 22, letterSpacing: 4, marginTop: 260, fontWeight: "600" },
  hugeWord: { color: "#fff", fontSize: 180, fontWeight: "800", letterSpacing: -4, marginTop: 18, lineHeight: 190 },
  emotionRow: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 14 },
  dot: { width: 42, height: 42, borderRadius: 21 },
  emotionLabel: { color: "#fff", fontSize: 56, fontWeight: "700" },
  intensityRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 44 },
  intensityLabel: { color: "rgba(255,255,255,0.55)", fontSize: 22, marginTop: 18, fontWeight: "500" },

  // 2x2 grid for stats hero (was a single row before)
  heroGrid: { flexDirection: "row", flexWrap: "wrap", gap: 20, marginTop: 36 },
  statBox: {
    width: 432, padding: 28, borderRadius: 36, borderWidth: 2,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  statBig: { fontSize: 96, fontWeight: "800", lineHeight: 102 },
  statSmall: { fontSize: 22, marginTop: 4, fontWeight: "600", letterSpacing: 1.2 },

  dominantBlock: { marginTop: 36 },
  dominantTxt: { color: "rgba(255,255,255,0.55)", fontSize: 22, letterSpacing: 4, fontWeight: "600" },
  thisWeek: { color: "rgba(255,255,255,0.7)", fontSize: 22, marginTop: 6 },

  sectionLabel: { color: "rgba(255,255,255,0.55)", fontSize: 22, letterSpacing: 4, fontWeight: "600", marginBottom: 18 },

  insightsWrap: { marginTop: 36, gap: 14 },
  insightChip: {
    flexDirection: "row", alignItems: "center", gap: 16,
    padding: 22, borderRadius: 24, borderWidth: 2,
  },
  insightDot: { width: 14, height: 14, borderRadius: 7 },
  insightTitle: { color: "#fff", fontSize: 26, fontWeight: "700", lineHeight: 32 },
  insightSub: { color: "rgba(255,255,255,0.7)", fontSize: 20, marginTop: 4 },

  distWrap: { marginTop: 36, gap: 18 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 18 },
  distDot: { width: 24, height: 24, borderRadius: 12 },
  distLabel: { color: "#fff", width: 240, fontSize: 26, fontWeight: "600" },
  distTrack: { flex: 1, height: 18, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.1)" },
  distFill: { height: 18, borderRadius: 9 },
  distPct: { color: "rgba(255,255,255,0.8)", width: 100, textAlign: "right", fontSize: 24 },

  achievementsWrap: { marginTop: 32 },
  achievementsRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  achBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999,
    backgroundColor: "rgba(250,204,21,0.16)", borderWidth: 1, borderColor: "rgba(250,204,21,0.4)",
  },
  achStar: { color: "#FACC15", fontSize: 22, fontWeight: "900" },
  achLabel: { color: "#fff", fontSize: 22, fontWeight: "700" },

  footer: { color: "rgba(255,255,255,0.95)", fontSize: 30, fontWeight: "700", textAlign: "center", paddingHorizontal: 30 },
  footerSub: { color: "rgba(255,255,255,0.75)", fontSize: 24, fontStyle: "italic", marginTop: 6, textAlign: "center" },
  footerHandle: { color: "rgba(255,255,255,0.55)", fontSize: 26, fontWeight: "600", marginTop: 14, letterSpacing: 2, textAlign: "center" },

  musicRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    marginTop: 28, alignSelf: "stretch", paddingVertical: 18, paddingHorizontal: 22,
    backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 28,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  musicIcon: { fontSize: 30 },
  musicTitle: { color: "#fff", fontSize: 26, fontWeight: "700" },
  musicArtist: { color: "rgba(255,255,255,0.7)", fontSize: 22, marginTop: 2 },

  // Leaderboard styles (kind === "leaderboard")
  lbCard: {
    marginTop: 28, padding: 28, borderRadius: 32,
    borderWidth: 2, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  lbHdrRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 },
  lbBadge: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  lbBadgeTxt: { fontSize: 28, fontWeight: "900" },
  lbCatTitle: { color: "#fff", fontSize: 36, fontWeight: "800" },

  lbRow: {
    flexDirection: "row", alignItems: "center", gap: 16,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 18,
  },
  lbRowMe: { backgroundColor: "rgba(255,255,255,0.08)" },
  lbMedal: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center",
  },
  lbMedalTxt: { color: "#000", fontSize: 24, fontWeight: "900" },
  lbAvatar: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  lbAvatarTxt: { color: "#000", fontWeight: "900", fontSize: 26 },
  lbName: { color: "#fff", fontSize: 28, flex: 1, fontWeight: "600" },
  lbValue: { fontSize: 28, fontWeight: "800" },
  lbValueSub: { color: "rgba(255,255,255,0.65)", fontSize: 18, fontWeight: "500" },
  lbMyRankLine: {
    color: "rgba(255,255,255,0.7)", fontSize: 20, fontStyle: "italic",
    marginTop: 8, paddingHorizontal: 12,
  },
});
