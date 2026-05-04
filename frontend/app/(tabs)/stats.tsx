import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import RadialAura from "../../src/components/RadialAura";
import Button from "../../src/components/Button";
import { api } from "../../src/api";
import { COLORS, EMOTION_COLORS } from "../../src/theme";
import { useAuth } from "../../src/auth";
import { t } from "../../src/i18n";
import { Ionicons } from "@expo/vector-icons";
import { useShareToStories } from "../../src/components/ShareToStories";
import ShareAuraButton from "../../src/components/ShareAuraButton";
import StreakFreezeCard from "../../src/components/StreakFreezeCard";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RANGES: { key: 30 | 90 | 365; label: string }[] = [
  { key: 30, label: "30d" },
  { key: 90, label: "90d" },
  { key: 365, label: "1y" },
];

function volatilityLabel(v: number): string {
  if (v <= 1.2) return "Steady";
  if (v <= 2.2) return "Balanced";
  if (v <= 3.2) return "Variable";
  return "Turbulent";
}

export default function Stats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<30 | 90 | 365>(30);
  const router = useRouter();
  const { share, Renderer: ShareRenderer } = useShareToStories();

  const load = useCallback(async () => {
    try {
      const [s, ins] = await Promise.all([
        api("/moods/stats"),
        api("/moods/insights").catch(() => null),
      ]);
      setStats(s);
      setInsights(ins);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pro = user?.pro;
  const dominant = stats?.dominant;
  const domColor = dominant ? EMOTION_COLORS[dominant]?.hex : "#A78BFA";

  const maxDow = Math.max(1, ...Object.values(stats?.by_weekday || {}).map((v: any) => Number(v)));
  const distEntries = Object.entries(stats?.distribution || {}).filter(([, v]) => Number(v) > 0);
  const distTotal = distEntries.reduce((a, [, v]) => a + Number(v), 0) || 1;

  const rangeData = stats?.[`range_${range}`];
  const rangeTop = useMemo(() => {
    const d = rangeData?.distribution || {};
    const entries = Object.entries(d).filter(([, v]) => Number(v) > 0);
    entries.sort((a: any, b: any) => b[1] - a[1]);
    const total = entries.reduce((a, [, v]) => a + Number(v), 0) || 1;
    return entries.slice(0, 5).map(([key, count]) => ({
      key,
      count: Number(count),
      pct: Math.round((Number(count) / total) * 100),
      color: EMOTION_COLORS[key]?.hex || "#888",
      label: EMOTION_COLORS[key]?.label || key,
    }));
  }, [rangeData]);

  return (
    <View style={styles.container} testID="stats-screen">
      <RadialAura color={domColor} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#fff" />}>
          <View style={styles.topHeader}>
            <Text style={styles.title}>{t("stats.title")}</Text>
          </View>

          {/* Mood Patterns Insights — surfaces non-obvious things about the user's
              emotional life (best weekday, trend, dominant emotion, streaks, time-of-day).
              Hidden when the user hasn't dropped enough auras yet (≥3 needed). */}
          {insights?.ready && Array.isArray(insights?.insights) && insights.insights.length > 0 ? (
            <View style={styles.insightsBlock} testID="insights-block">
              <View style={styles.insightsHeader}>
                <Ionicons name="sparkles" size={14} color="#A78BFA" />
                <Text style={styles.insightsTitle}>Insights ✦</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingRight: 16 }}
              >
                {insights.insights.map((it: any) => {
                  const tone = it.tone || "neutral";
                  const accent =
                    it.color
                      ? it.color
                      : tone === "positive"
                        ? "#22C55E"
                        : tone === "warning"
                          ? "#F97316"
                          : "#A78BFA";
                  return (
                    <View
                      key={it.id}
                      testID={`insight-${it.id}`}
                      style={[
                        styles.insightCard,
                        {
                          borderColor: accent + "55",
                          backgroundColor: accent + "10",
                          shadowColor: accent,
                        },
                      ]}
                    >
                      <View style={[styles.insightIconWrap, { backgroundColor: accent + "30" }]}>
                        <Ionicons name={(it.icon || "sparkles") as any} size={16} color={accent} />
                      </View>
                      <Text style={[styles.insightTitle, { color: accent }]} numberOfLines={2}>
                        {it.title}
                      </Text>
                      {it.subtitle ? (
                        <Text style={styles.insightSubtitle} numberOfLines={2}>
                          {it.subtitle}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ) : insights && !insights.ready && insights.needed > 0 ? (
            <View style={styles.insightsTeaser}>
              <Ionicons name="sparkles-outline" size={16} color="#A78BFA" />
              <Text style={styles.insightsTeaserTxt}>
                Drop {insights.needed} more aura{insights.needed > 1 ? "s" : ""} to unlock personalised insights ✦
              </Text>
            </View>
          ) : null}

          <View style={styles.statRow}>
            <View style={styles.statCard} testID="stat-streak">
              <Ionicons name="flame" size={18} color="#F97316" />
              <Text style={styles.statNum}>{stats?.streak || 0}</Text>
              <Text style={styles.statLbl}>{t("home.streak")}</Text>
            </View>
            <View style={styles.statCard} testID="stat-drops">
              <Image source={require("../../assets/images/icon.png")} style={{ width: 22, height: 22, borderRadius: 6 }} />
              <Text style={styles.statNum}>{stats?.drops_this_week || 0}</Text>
              <Text style={styles.statLbl}>auras this week</Text>
            </View>
          </View>

          {/* Streak Freeze — protect the streak with monthly quotas + bundle upsell. */}
          <StreakFreezeCard onChange={load} />

          <View style={[styles.heroCard, { borderColor: domColor + "80" }]} testID="stat-dominant">
            <Text style={styles.heroLbl}>{t("stats.dominant")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
              <View style={[styles.heroDot, { backgroundColor: domColor }]} />
              <Text style={styles.heroTxt}>{dominant ? (EMOTION_COLORS[dominant]?.label || dominant) : "No data yet"}</Text>
            </View>
          </View>

          <Text style={styles.section}>{t("stats.byDay")}</Text>
          <View style={styles.chartCard}>
            <View style={styles.chart}>
              {DOW.map((d, idx) => {
                const v = Number(stats?.by_weekday?.[idx] || 0);
                const h = (v / maxDow) * 100;
                return (
                  <View key={d} style={styles.chartCol}>
                    <View style={[styles.chartBar, { height: Math.max(4, h), backgroundColor: v > 0 ? domColor : "rgba(255,255,255,0.08)" }]} />
                    <Text style={styles.chartLbl}>{d}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <Text style={styles.section}>{t("stats.distribution")}</Text>
          <View style={styles.distCard}>
            {distEntries.length === 0 ? <Text style={styles.empty}>Post moods to see your distribution.</Text> :
              distEntries.map(([key, count]) => {
                const color = EMOTION_COLORS[key]?.hex || "#888";
                const pct = Math.round((Number(count) / distTotal) * 100);
                return (
                  <View key={key} style={styles.distRow}>
                    <View style={[styles.distDot, { backgroundColor: color }]} />
                    <Text style={styles.distLabel}>{EMOTION_COLORS[key]?.label || key}</Text>
                    <View style={styles.distTrack}>
                      <View style={[styles.distFill, { width: `${pct}%`, backgroundColor: color }]} />
                    </View>
                    <Text style={styles.distPct}>{pct}%</Text>
                  </View>
                );
              })}
          </View>

          {pro && stats?.insights ? (
            <>
              <Text style={styles.section}>{t("stats.insights")}</Text>

              {/* Range selector */}
              <View style={styles.rangeRow}>
                {RANGES.map((r) => {
                  const active = range === r.key;
                  return (
                    <TouchableOpacity
                      key={r.key}
                      testID={`range-${r.key}`}
                      onPress={() => setRange(r.key)}
                      style={[styles.rangePill, active && { backgroundColor: domColor + "22", borderColor: domColor }]}
                    >
                      <Text style={[styles.rangeTxt, active && { color: "#fff", fontWeight: "700" }]}>{r.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Metrics grid */}
              <View style={styles.metricsRow}>
                <View style={styles.metricCard}>
                  <Ionicons name="sparkles" size={16} color={domColor} />
                  <Text style={styles.metricNum}>{rangeData?.count || 0}</Text>
                  <Text style={styles.metricLbl}>auras</Text>
                </View>
                <View style={styles.metricCard}>
                  <Ionicons name="flash-outline" size={16} color="#FACC15" />
                  <Text style={styles.metricNum}>{(rangeData?.avg_intensity ?? 0).toFixed(1)}</Text>
                  <Text style={styles.metricLbl}>avg intensity</Text>
                </View>
                <View style={styles.metricCard}>
                  <Ionicons name="pulse-outline" size={16} color="#EC4899" />
                  <Text style={styles.metricNum}>{(rangeData?.volatility ?? 0).toFixed(1)}</Text>
                  <Text style={styles.metricLbl}>{volatilityLabel(rangeData?.volatility ?? 0)}</Text>
                </View>
              </View>

              {/* Top 5 moods over selected range */}
              {rangeTop.length > 0 && (
                <View style={styles.rangeCard}>
                  <Text style={styles.rangeCardHdr}>Top moods · last {range === 365 ? "year" : `${range} days`}</Text>
                  {rangeTop.map((r) => (
                    <View key={r.key} style={styles.distRow}>
                      <View style={[styles.distDot, { backgroundColor: r.color }]} />
                      <Text style={styles.distLabel}>{r.label}</Text>
                      <View style={styles.distTrack}>
                        <View style={[styles.distFill, { width: `${r.pct}%`, backgroundColor: r.color }]} />
                      </View>
                      <Text style={styles.distPct}>{r.pct}%</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* AI-ish insight sentences */}
              <View style={styles.insights}>
                {stats.insights.map((i: string, k: number) => <Text key={k} style={styles.insight}>✦ {i}</Text>)}
              </View>
            </>
          ) : (
            <View style={styles.proCta} testID="stats-pro-cta">
              <Text style={styles.proTxt}>{t("stats.proLock")}</Text>
              <Button testID="go-paywall-from-stats" label={t("profile.goPro")} onPress={() => router.push("/paywall")} />
            </View>
          )}
          {/* Big funky share button at bottom — same component as Home for consistency. */}
          <View style={styles.shareBottom}>
            <ShareAuraButton
              testID="share-stats"
              label="Share my stats"
              onPress={() =>
                share({
                  kind: "stats",
                  streak: stats?.streak || 0,
                  dropsThisWeek: stats?.drops_this_week || 0,
                  dominant: stats?.dominant || "joy",
                  distribution: stats?.distribution || {},
                  userName: user?.name,
                })
              }
            />
          </View>
          <View style={{ height: 120 }} />
        </ScrollView>
        <ShareRenderer />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  scroll: { padding: 20, paddingTop: 12 },
  title: { color: "#fff", fontSize: 32, fontWeight: "700", letterSpacing: -0.5, marginBottom: 16 },
  statRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 22, padding: 16 },
  statNum: { color: "#fff", fontSize: 32, fontWeight: "700", marginTop: 6 },
  statLbl: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  heroCard: { marginTop: 14, borderRadius: 24, borderWidth: 1, padding: 20, backgroundColor: "rgba(255,255,255,0.04)" },
  heroLbl: { color: COLORS.textTertiary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5 },
  heroDot: { width: 26, height: 26, borderRadius: 13 },
  heroTxt: { color: "#fff", fontSize: 26, fontWeight: "700" },
  section: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 22, marginBottom: 10, fontWeight: "600" },
  chartCard: { borderRadius: 22, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", padding: 16 },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 130 },
  chartCol: { flex: 1, alignItems: "center", gap: 6 },
  chartBar: { width: "80%", borderRadius: 6 },
  chartLbl: { color: COLORS.textTertiary, fontSize: 10 },
  distCard: { borderRadius: 22, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", padding: 16, gap: 10 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  distDot: { width: 10, height: 10, borderRadius: 5 },
  distLabel: { color: "#fff", width: 90, fontSize: 13 },
  distTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.06)" },
  distFill: { height: 8, borderRadius: 4 },
  distPct: { color: COLORS.textSecondary, width: 38, textAlign: "right", fontSize: 12 },
  empty: { color: COLORS.textSecondary, textAlign: "center" },
  insights: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", gap: 8 },
  insightsBlock: { marginBottom: 14 },
  insightsHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingHorizontal: 4 },
  insightsTitle: { color: "#fff", fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  insightCard: {
    width: 200,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  insightIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  insightTitle: { fontSize: 14, fontWeight: "700", lineHeight: 18 },
  insightSubtitle: { color: "rgba(255,255,255,0.65)", fontSize: 11, lineHeight: 14 },
  insightsTeaser: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
    backgroundColor: "rgba(167,139,250,0.08)",
  },
  insightsTeaserTxt: { color: "#fff", fontSize: 12, flex: 1 },
  insight: { color: "#fff", fontSize: 14 },
  subInsight: { color: COLORS.textTertiary, fontSize: 12, marginTop: 6 },
  proCta: { padding: 20, borderRadius: 22, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.04)", gap: 12, alignItems: "center", marginTop: 14 },
  proTxt: { color: COLORS.textSecondary, textAlign: "center" },
  rangeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  rangePill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  rangeTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "600" },
  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  metricCard: { flex: 1, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "flex-start", gap: 4 },
  metricNum: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 2 },
  metricLbl: { color: COLORS.textSecondary, fontSize: 11 },
  rangeCard: { padding: 14, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 12, gap: 8 },
  rangeCardHdr: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "700", marginBottom: 4 },
  topHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: COLORS.border },
  shareBottom: { marginTop: 24, marginBottom: 8, paddingHorizontal: 24, alignItems: "center" },
  shareBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
