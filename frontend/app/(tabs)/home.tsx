import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert } from "react-native";
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
import { useShareToStories } from "../../src/components/ShareToStories";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [todayMood, setTodayMood] = useState<any>(null);
  const [feed, setFeed] = useState<{ locked: boolean; items: any[] }>({ locked: true, items: [] });
  const [refreshing, setRefreshing] = useState(false);
  const { share, Renderer: ShareRenderer } = useShareToStories();

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
      const r = await api<{ reactions: any[] }>(`/moods/${mood_id}/react`, { method: "POST", body: { emoji } });
      setFeed((f) => ({
        ...f,
        items: f.items.map((m) => (m.mood_id === mood_id ? { ...m, reactions: r.reactions || [] } : m)),
      }));
      setTodayMood((tm: any) => (tm && tm.mood_id === mood_id ? { ...tm, reactions: r.reactions || [] } : tm));
    } catch {}
  };

  // Activity bell (reactions/comments on MY auras)
  const [activityUnread, setActivityUnread] = useState(0);
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const r = await api<{ unread: number }>("/activity/unread-count");
        if (live) setActivityUnread(r.unread || 0);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => { live = false; clearInterval(id); };
  }, []);

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TouchableOpacity
                testID="activity-bell"
                onPress={() => router.push("/activity" as any)}
                style={styles.bellBtn}
              >
                <Ionicons name="notifications-outline" size={18} color="#fff" />
                {activityUnread > 0 ? (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeTxt}>{activityUnread > 9 ? "9+" : activityUnread}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              <View style={styles.streak} testID="home-streak">
                <Ionicons name="flame" size={16} color="#F97316" />
                <Text style={styles.streakNum}>{user?.streak || 0}</Text>
              </View>
            </View>
          </View>

          {!todayMood ? (
            <View style={styles.cta}>
              <Text style={styles.ctaTitle}>{t("home.dropToday")}</Text>
              <Text style={styles.ctaSub}>One aura. Twenty seconds. Unlock your friends' feelings.</Text>
              <View style={{ marginTop: 16 }}>
                <Button testID="cta-drop-mood" label={t("home.dropCTA")} onPress={() => router.push("/mood-create")} />
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.myMoodHeader}>
                <Text style={styles.sectionTitle}>Your mood today</Text>
                <View style={styles.myMoodActions}>
                  <TouchableOpacity
                    testID="share-my-mood"
                    onPress={() =>
                      share({
                        kind: "mood",
                        word: todayMood.word,
                        emotion: todayMood.emotion,
                        intensity: todayMood.intensity,
                        userName: user?.name,
                      })
                    }
                    style={styles.shareBtn}
                  >
                    <Ionicons name="share-outline" size={14} color="#fff" />
                    <Text style={styles.shareBtnTxt}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="redo-my-mood"
                    onPress={() =>
                      Alert.alert(
                        "Redo today's aura?",
                        "Your current mood will be deleted and you'll be taken to the drop screen.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete & redo",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await api("/moods/today", { method: "DELETE" });
                                setTodayMood(null);
                                router.push("/mood-create");
                              } catch (e: any) {
                                Alert.alert("Failed", e.message || "Could not delete drop");
                              }
                            },
                          },
                        ],
                      )
                    }
                    style={styles.redoBtn}
                  >
                    <Ionicons name="refresh" size={14} color="#fff" />
                    <Text style={styles.shareBtnTxt}>Redo</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <MoodCard
                mood={{
                  ...todayMood,
                  author_name: user?.name,
                  author_color: user?.avatar_color,
                  author_avatar_b64: (user as any)?.avatar_b64,
                }}
                testIDPrefix="my-mood"
              />
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
              <Ionicons name="people" size={24} color="#fff" />
              <Text style={styles.lockedTxt}>{t("home.noFriendsYet")}</Text>
              <Text style={[styles.lockedTxt, { fontSize: 12, marginTop: 6, opacity: 0.7 }]}>
                Friends need to add you back with your email: {user?.email}
              </Text>
              <View style={{ marginTop: 12 }}>
                <Button testID="add-friend-cta" variant="secondary" label={t("friends.add")} onPress={() => router.push("/(tabs)/friends")} />
              </View>
            </View>
          ) : (
            feed.items.map((m) => (
              <MoodCard
                key={m.mood_id}
                mood={m}
                onReact={(e) => react(m.mood_id, e)}
                onMessage={() => router.push({ pathname: "/conversation", params: { peer_id: m.user_id } })}
                testIDPrefix="feed"
              />
            ))
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
        <ShareRenderer />
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
  bellBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border, position: "relative" },
  bellBadge: { position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: "#EC4899", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#050505" },
  bellBadgeTxt: { color: "#fff", fontSize: 9, fontWeight: "800" },
  cta: { padding: 24, borderRadius: 28, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.04)", marginBottom: 24 },
  ctaTitle: { color: "#fff", fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  ctaSub: { color: COLORS.textSecondary, marginTop: 8 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12 },
  feedHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  myMoodHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  myMoodActions: { flexDirection: "row", gap: 8, marginBottom: 10 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: COLORS.border },
  redoBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" },
  shareBtnTxt: { color: "#fff", fontSize: 12, fontWeight: "600" },
  locked: { padding: 24, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center" },
  lockedTxt: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8 },
});
