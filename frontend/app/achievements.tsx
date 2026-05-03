import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

type Badge = { key: string; label: string; icon: any; color: string; hint: string; earned: boolean };
type LBRow = { user_id: string; name: string; avatar_color?: string; avatar_b64?: string; value: number; rank: number };
type LBCategory = { top3: LBRow[]; my_rank: number | null; total: number };

const CAT_META: { key: "streak" | "moods" | "loved"; label: string; icon: any; color: string; suffix: string }[] = [
  { key: "streak", label: "Longest streak",  icon: "flame",  color: "#FB923C", suffix: "days" },
  { key: "moods",  label: "Most auras",      icon: "sparkles", color: "#FACC15", suffix: "auras" },
  { key: "loved",  label: "Most loved",      icon: "heart",  color: "#EC4899", suffix: "reactions" },
];

const MEDAL_COLORS = ["#FACC15", "#D1D5DB", "#CD7F32"]; // gold / silver / bronze

export default function Achievements() {
  const router = useRouter();
  const { user } = useAuth();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [earnedCount, setEarnedCount] = useState(0);
  const [metrics, setMetrics] = useState<any>(null);
  const [lb, setLB] = useState<Record<string, LBCategory> | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, l] = await Promise.all([
        api<any>("/badges"),
        api<any>("/friends/leaderboard"),
      ]);
      setBadges(b.badges || []);
      setEarnedCount(b.earned_count || 0);
      setMetrics(b.metrics || null);
      setLB(l);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container} testID="achievements-screen">
      <RadialAura color="#FACC15" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Achievements</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* LEADERBOARD */}
          <Text style={styles.sectionHdr}>Top 3 · you &amp; your friends</Text>
          {!lb || lb[CAT_META[0].key].total <= 1 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={24} color={COLORS.textSecondary} />
              <Text style={styles.emptyTitle}>Add friends to compete</Text>
              <Text style={styles.emptySub}>Once you have friends, see who's on the longest streak, the most loved and most active.</Text>
              <TouchableOpacity style={styles.ctaBtn} onPress={() => router.push("/(tabs)/friends")}>
                <Text style={styles.ctaBtnTxt}>Invite friends</Text>
              </TouchableOpacity>
            </View>
          ) : (
            CAT_META.map((cat) => {
              const data = lb[cat.key];
              return (
                <View key={cat.key} style={styles.lbCard}>
                  <View style={styles.lbHdr}>
                    <View style={[styles.lbIcon, { backgroundColor: cat.color + "20", borderColor: cat.color + "50" }]}>
                      <Ionicons name={cat.icon} size={16} color={cat.color} />
                    </View>
                    <Text style={styles.lbTitle}>{cat.label}</Text>
                    {data.my_rank && data.my_rank > 3 ? (
                      <Text style={styles.lbMyRank}>you: #{data.my_rank}/{data.total}</Text>
                    ) : null}
                  </View>
                  {data.top3.map((r) => {
                    const isMe = r.user_id === user?.user_id;
                    return (
                      <View
                        key={r.user_id}
                        testID={`lb-${cat.key}-rank${r.rank}`}
                        style={[styles.lbRow, isMe && styles.lbRowMe]}
                      >
                        <View style={[styles.medal, { backgroundColor: MEDAL_COLORS[r.rank - 1] }]}>
                          <Text style={styles.medalTxt}>{r.rank}</Text>
                        </View>
                        <View style={[styles.avatar, { backgroundColor: r.avatar_color || "#A78BFA", overflow: "hidden" }]}>
                          {r.avatar_b64 ? (
                            <Image source={{ uri: `data:image/jpeg;base64,${r.avatar_b64}` }} style={{ width: 36, height: 36 }} />
                          ) : (
                            <Text style={styles.avatarTxt}>{(r.name || "?").slice(0, 1).toUpperCase()}</Text>
                          )}
                        </View>
                        <Text style={[styles.lbName, isMe && { fontWeight: "800" }]}>{isMe ? "You" : r.name}</Text>
                        <Text style={[styles.lbValue, { color: cat.color }]}>{r.value} <Text style={styles.lbValueSub}>{cat.suffix}</Text></Text>
                      </View>
                    );
                  })}
                </View>
              );
            })
          )}

          {/* BADGES */}
          <Text style={[styles.sectionHdr, { marginTop: 24 }]}>
            Badges · {earnedCount}/{badges.length}
          </Text>
          <View style={styles.badgesGrid}>
            {badges.map((b) => (
              <View key={b.key} style={[styles.badge, !b.earned && styles.badgeLocked]} testID={`badge-${b.key}`}>
                <View style={[styles.badgeIcon, { backgroundColor: b.earned ? b.color + "22" : "rgba(255,255,255,0.05)", borderColor: b.earned ? b.color + "55" : COLORS.border }]}>
                  <Ionicons name={b.icon} size={20} color={b.earned ? b.color : COLORS.textTertiary} />
                </View>
                <Text style={[styles.badgeLabel, !b.earned && { color: COLORS.textSecondary }]} numberOfLines={1}>{b.label}</Text>
                <Text style={styles.badgeHint} numberOfLines={2}>{b.hint}</Text>
              </View>
            ))}
          </View>

          {metrics ? (
            <View style={styles.metricsWrap}>
              <Text style={styles.metricsHdr}>Your stats</Text>
              <Text style={styles.metricsLine}>Streak: {metrics.streak}d · Auras: {metrics.moods_count} · Friends: {metrics.friends}</Text>
              <Text style={styles.metricsLine}>Emotions used: {metrics.unique_emotions}/24 · Reactions received: {metrics.reactions_received}</Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontSize: 18, fontWeight: "600" },
  scroll: { padding: 20, paddingBottom: 80 },
  sectionHdr: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },

  emptyCard: { padding: 20, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center", gap: 8 },
  emptyTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 4 },
  emptySub: { color: COLORS.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 18 },
  ctaBtn: { marginTop: 8, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 },
  ctaBtnTxt: { color: "#000", fontWeight: "700" },

  lbCard: { padding: 14, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 12 },
  lbHdr: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  lbIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  lbTitle: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 1 },
  lbMyRank: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600" },
  lbRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderRadius: 12, paddingHorizontal: 6 },
  lbRowMe: { backgroundColor: "rgba(255,255,255,0.05)" },
  medal: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  medalTxt: { color: "#000", fontWeight: "800", fontSize: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#000", fontWeight: "800", fontSize: 14 },
  lbName: { color: "#fff", fontSize: 15, fontWeight: "500", flex: 1 },
  lbValue: { fontWeight: "800", fontSize: 15 },
  lbValueSub: { color: COLORS.textSecondary, fontWeight: "400", fontSize: 11 },

  badgesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badge: { width: "48%", padding: 14, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", gap: 6, alignItems: "flex-start" },
  badgeLocked: { opacity: 0.55 },
  badgeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  badgeLabel: { color: "#fff", fontWeight: "700", fontSize: 14 },
  badgeHint: { color: COLORS.textTertiary, fontSize: 11, lineHeight: 15 },

  metricsWrap: { marginTop: 22, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  metricsHdr: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  metricsLine: { color: "#fff", fontSize: 13, marginTop: 3 },
});
