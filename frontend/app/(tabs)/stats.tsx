import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import RadialAura from "../../src/components/RadialAura";
import Button from "../../src/components/Button";
import { api } from "../../src/api";
import { COLORS, EMOTION_COLORS } from "../../src/theme";
import { useAuth } from "../../src/auth";
import { t } from "../../src/i18n";
import { Ionicons } from "@expo/vector-icons";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Stats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => { try { setStats(await api("/moods/stats")); } catch {} }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pro = user?.pro;
  const dominant = stats?.dominant;
  const domColor = dominant ? EMOTION_COLORS[dominant]?.hex : "#A78BFA";

  const maxDow = Math.max(1, ...Object.values(stats?.by_weekday || {}).map((v: any) => Number(v)));
  const distEntries = Object.entries(stats?.distribution || {}).filter(([, v]) => Number(v) > 0);
  const distTotal = distEntries.reduce((a, [, v]) => a + Number(v), 0) || 1;

  return (
    <View style={styles.container} testID="stats-screen">
      <RadialAura color={domColor} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#fff" />}>
          <Text style={styles.title}>{t("stats.title")}</Text>

          <View style={styles.statRow}>
            <View style={styles.statCard} testID="stat-streak">
              <Ionicons name="flame" size={18} color="#F97316" />
              <Text style={styles.statNum}>{stats?.streak || 0}</Text>
              <Text style={styles.statLbl}>{t("home.streak")}</Text>
            </View>
            <View style={styles.statCard} testID="stat-drops">
              <Ionicons name="water" size={18} color="#60A5FA" />
              <Text style={styles.statNum}>{stats?.drops_this_week || 0}</Text>
              <Text style={styles.statLbl}>this week</Text>
            </View>
          </View>

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
              <View style={styles.insights}>
                {stats.insights.map((i: string, k: number) => <Text key={k} style={styles.insight}>✦ {i}</Text>)}
                <Text style={styles.subInsight}>30-day avg intensity: {stats.range_30?.avg_intensity} · volatility: {stats.range_30?.volatility}</Text>
              </View>
            </>
          ) : (
            <View style={styles.proCta} testID="stats-pro-cta">
              <Text style={styles.proTxt}>{t("stats.proLock")}</Text>
              <Button testID="go-paywall-from-stats" label={t("profile.goPro")} onPress={() => router.push("/paywall")} />
            </View>
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
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
  insight: { color: "#fff", fontSize: 14 },
  subInsight: { color: COLORS.textTertiary, fontSize: 12, marginTop: 6 },
  proCta: { padding: 20, borderRadius: 22, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.04)", gap: 12, alignItems: "center", marginTop: 14 },
  proTxt: { color: COLORS.textSecondary, textAlign: "center" },
});
