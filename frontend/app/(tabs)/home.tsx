import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import RadialAura from "../../src/components/RadialAura";
import MoodCard from "../../src/components/MoodCard";
import Button from "../../src/components/Button";
import { useAuth } from "../../src/auth";
import { api } from "../../src/api";
import { t } from "../../src/i18n";
import { COLORS, EMOTION_COLORS } from "../../src/theme";
import { Ionicons } from "@expo/vector-icons";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [todayMood, setTodayMood] = useState<any>(null);
  const [feed, setFeed] = useState<{ locked: boolean; items: any[] }>({ locked: true, items: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const today = await api<{ mood: any }>("/moods/today");
      setTodayMood(today.mood);
      const f = await api<any>("/moods/feed");
      setFeed(f);
    } catch (e) {
      // ignore
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const react = async (mood_id: string, emoji: string) => {
    try {
      await api(`/moods/${mood_id}/react`, { method: "POST", body: { emoji } });
      await load();
    } catch {}
  };

  const auraColor = todayMood ? EMOTION_COLORS[todayMood.emotion]?.hex || "#A78BFA" : "#A78BFA";

  return (
    <View style={styles.container} testID="home-screen">
      <RadialAura color={auraColor} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        >
          <View style={styles.topRow}>
            <View>
              <Text style={styles.hello}>Hello, {user?.name?.split(" ")[0] || "there"}</Text>
              <Text style={styles.dateTxt}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>
            </View>
            <View style={styles.streak} testID="home-streak">
              <Ionicons name="flame" size={16} color="#F97316" />
              <Text style={styles.streakNum}>{user?.streak || 0}</Text>
            </View>
          </View>

          {!todayMood ? (
            <View style={styles.cta}>
              <Text style={styles.ctaTitle}>{t("home.dropToday")}</Text>
              <Text style={styles.ctaSub}>One drop. Twenty seconds. Unlock your friends' feelings.</Text>
              <View style={{ marginTop: 16 }}>
                <Button testID="cta-drop-mood" label={t("home.dropCTA")} onPress={() => router.push("/mood-create")} />
              </View>
            </View>
          ) : (
            <View>
              <Text style={styles.sectionTitle}>Your mood today</Text>
              <MoodCard mood={{ ...todayMood, author_name: user?.name, author_color: user?.avatar_color }} testIDPrefix="my-mood" />
            </View>
          )}

          <View style={{ height: 8 }} />

          <View style={styles.feedHead}>
            <Text style={styles.sectionTitle}>{t("home.friendsFeed")}</Text>
            {feed.locked ? <Ionicons name="lock-closed" size={14} color={COLORS.textTertiary} /> : null}
          </View>

          {feed.locked ? (
            <View style={styles.locked} testID="feed-locked">
              <Ionicons name="sparkles" size={24} color="#fff" />
              <Text style={styles.lockedTxt}>{t("home.feedLocked")}</Text>
            </View>
          ) : feed.items.length === 0 ? (
            <View style={styles.locked}>
              <Text style={styles.lockedTxt}>{t("home.noFriendsYet")}</Text>
              <View style={{ marginTop: 12 }}>
                <Button testID="add-friend-cta" variant="secondary" label={t("friends.add")} onPress={() => router.push("/(tabs)/friends")} />
              </View>
            </View>
          ) : (
            feed.items.map((m) => (
              <MoodCard key={m.mood_id} mood={m} onReact={(e) => react(m.mood_id, e)} testIDPrefix="feed" />
            ))
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  scroll: { padding: 20, paddingTop: 8 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  hello: { color: "#fff", fontSize: 22, fontWeight: "700" },
  dateTxt: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  streak: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.04)" },
  streakNum: { color: "#fff", fontWeight: "700" },
  cta: { padding: 24, borderRadius: 28, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.04)", marginBottom: 24 },
  ctaTitle: { color: "#fff", fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  ctaSub: { color: COLORS.textSecondary, marginTop: 8 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12 },
  feedHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  locked: { padding: 24, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center" },
  lockedTxt: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8 },
});
