import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import RadialAura from "../../src/components/RadialAura";
import MoodCard from "../../src/components/MoodCard";
import Button from "../../src/components/Button";
import { useAuth } from "../../src/auth";
import { api } from "../../src/api";
import { t, dateLong, useI18n } from "../../src/i18n";
import { useNetworkStatus } from "../../src/network";
import { COLORS, EMOTION_COLORS } from "../../src/theme";
import { Ionicons } from "@expo/vector-icons";
import { useShareToStories } from "../../src/components/ShareToStories";
import ShareAuraButton from "../../src/components/ShareAuraButton";
import EmptyState from "../../src/components/EmptyState";
import { notifyIfNew } from "../../src/notifications";
// Screen capture guard removed — users need to screenshot any screen
// (App Store paywall captures for review, bug reports, sharing flows, etc.).

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  // Re-renders the screen when the user switches the language.
  useI18n();
  // Screen capture guard intentionally removed — users must be able to
  // screenshot any screen (App Store paywall captures for review,
  // bug reports, sharing flows, App Store reviewer testing, etc.).
  const [todayMood, setTodayMood] = useState<any>(null);
  const [feed, setFeed] = useState<{ locked: boolean; items: any[] }>({ locked: true, items: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const { online } = useNetworkStatus();
  const { share, Renderer: ShareRenderer } = useShareToStories();

  const load = useCallback(async () => {
    try {
      const today = await api<{ mood: any }>("/moods/today");
      setTodayMood(today.mood);
      const f = await api<any>("/moods/feed");
      setFeed(f);
      setLoadFailed(false);
    } catch (e) {
      // Distinguish "feed is empty" from "we couldn't fetch it" so the empty
      // state can offer Retry instead of "make friends".
      setLoadFailed(true);
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

  // Activity / message / friend polling → in-app local notifications
  const [activityUnread, setActivityUnread] = useState(0);
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const [act, msg, fr] = await Promise.all([
          api<{ unread: number }>("/activity/unread-count").catch(() => ({ unread: 0 })),
          api<{ total: number }>("/messages/unread-count").catch(() => ({ total: 0 })),
          api<{ friends: any[] }>("/friends").catch(() => ({ friends: [] })),
        ]);
        if (!live) return;
        setActivityUnread(act.unread || 0);
        // Trigger local notifications only when counts increase since last seen
        await notifyIfNew("reaction", act.unread || 0, {
          title: "New activity on your aura ✨",
          body: "A friend just reacted or commented — tap to see.",
          data: { route: "/activity" },
        });
        await notifyIfNew("message", msg.total || 0, {
          title: "New message",
          body: "You have a new message from a friend.",
          data: { route: "/(tabs)/messages" },
        });
        await notifyIfNew("friend", (fr.friends || []).length, {
          title: "New friend added",
          body: "Someone is now part of your InnFeel circle.",
          data: { route: "/(tabs)/friends" },
        });
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
              <Text style={styles.hello}>{t("home.hello", { name: user?.name?.split(" ")[0] || "there" })}</Text>
              <Text style={styles.dateTxt}>{dateLong()}</Text>
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

          {user && !user.email_verified_at ? (
            <TouchableOpacity
              testID="verify-banner"
              onPress={() => router.push("/(auth)/verify-email")}
              activeOpacity={0.85}
              style={styles.verifyBanner}
            >
              <View style={styles.verifyIcon}>
                <Ionicons name="mail-unread-outline" size={18} color="#A78BFA" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.verifyTitle}>{t("home.verifyBanner.title")}</Text>
                <Text style={styles.verifySub}>{t("home.verifyBanner.sub")}</Text>
              </View>
              <View style={styles.verifyCta}>
                <Text style={styles.verifyCtaTxt}>{t("home.verifyBanner.cta")}</Text>
                <Ionicons name="chevron-forward" size={14} color="#050505" />
              </View>
            </TouchableOpacity>
          ) : null}

          {!todayMood ? (
            <View style={styles.cta}>
              <Text style={styles.ctaTitle}>{t("home.dropToday")}</Text>
              <Text style={styles.ctaSub}>{t("home.dropSubtitle")}</Text>
              <View style={{ marginTop: 16 }}>
                <Button testID="cta-drop-mood" label={t("home.dropCTA")} onPress={() => router.push("/mood-create")} />
              </View>
            </View>
          ) : (
            <View>
              <Text style={[styles.sectionTitle, { marginBottom: 14 }]}>{t("home.auraTodayTitle")}</Text>
              <MoodCard
                mood={{
                  ...todayMood,
                  author_name: user?.name,
                  author_color: user?.avatar_color,
                  author_avatar_b64: (user as any)?.avatar_b64,
                  author_avatar_url: (user as any)?.avatar_url,
                }}
                testIDPrefix="my-mood"
              />
              <View style={styles.myMoodActions}>
                <ShareAuraButton
                  testID="share-my-mood"
                  label={t("home.dropCTA")}
                  onPress={() =>
                    share({
                      kind: "mood",
                      mood_id: todayMood.mood_id,
                      word: todayMood.word,
                      emotion: todayMood.emotion,
                      intensity: todayMood.intensity,
                      userName: user?.name,
                      music: todayMood.music || undefined,
                    })
                  }
                />
                <TouchableOpacity
                  testID="redo-my-mood"
                  onPress={() =>
                    Alert.alert(
                      t("home.editTitle"),
                      t("home.editBody"),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                          text: t("common.edit"),
                          onPress: () => router.push("/mood-create?edit=1"),
                        },
                      ],
                    )
                  }
                  style={styles.redoBtn}
                >
                  <Ionicons name="refresh" size={14} color="#fff" />
                  <Text style={styles.shareBtnTxt}>{t("home.redo")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Breathing room between the personal aura actions (share/redo)
              and the friends-feed section. The empty View acts as a vertical
              spacer — easier to tweak than juggling marginTop on the next
              section header. */}
          <View style={{ height: 36 }} />

          <View style={styles.feedHead}>
            <Text style={styles.sectionTitle}>{t("home.friendsFeed")}</Text>
            {feed.locked ? <Ionicons name="lock-closed" size={14} color={COLORS.textTertiary} /> : null}
          </View>
          <View style={{ height: 14 }} />

          {feed.locked ? (
            <EmptyState
              testID="feed-locked"
              tone="lock"
              title={t("home.feedLocked")}
              subtitle={t("home.feedLockedSub")}
            />
          ) : (!online || loadFailed) && feed.items.length === 0 ? (
            <EmptyState
              testID="feed-offline"
              tone="offline"
              title={t("offline.title")}
              subtitle={t("offline.subtitle")}
              cta={
                <Button testID="feed-offline-retry" variant="secondary" label={t("common.retry")} onPress={onRefresh} />
              }
            />
          ) : feed.items.length === 0 ? (
            <EmptyState
              tone="people"
              title={t("home.noFriendsYet")}
              subtitle={t("home.noFriendsSub")}
              cta={
                <Button testID="add-friend-cta" variant="secondary" label={t("friends.add")} onPress={() => router.push("/(tabs)/friends")} />
              }
            />
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
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12, textAlign: "center" },
  feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 },
  myMoodHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  myMoodActions: { flexDirection: "row", gap: 10, marginTop: 14, marginBottom: 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: COLORS.border },
  shareBtnXL: { flex: 1, justifyContent: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 999, backgroundColor: "#fff" },
  shareBtnXLTxt: { color: "#000", fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },
  redoBtn: { height: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" },
  shareBtnTxt: { color: "#fff", fontSize: 12, fontWeight: "600" },
  locked: { padding: 24, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center" },
  lockedTxt: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8 },
  verifyBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18,
    borderWidth: 1, borderColor: "rgba(167,139,250,0.35)",
    backgroundColor: "rgba(167,139,250,0.10)",
    marginBottom: 16,
  },
  verifyIcon: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(167,139,250,0.22)",
  },
  verifyTitle: { color: "#fff", fontWeight: "700", fontSize: 13 },
  verifySub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  verifyCta: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999,
  },
  verifyCtaTxt: { color: "#050505", fontWeight: "800", fontSize: 12 },
});
