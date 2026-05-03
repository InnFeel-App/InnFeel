import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { COLORS, REACTIONS, EMOTION_COLORS } from "../src/theme";

type ActivityItem = {
  activity_id: string;
  from_user_id: string;
  from_name: string;
  from_avatar_color?: string;
  from_avatar_b64?: string | null;
  kind: "reaction" | "comment";
  emoji?: string;
  text?: string;
  mood_id: string;
  mood_word?: string;
  mood_emotion?: string;
  mood_color?: string;
  at: string;
  read: boolean;
};

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function ActivityScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: ActivityItem[] }>("/activity");
      setItems(r.items || []);
      // Auto-mark all as read the moment the user opens this screen
      await api("/activity/mark-read", { method: "POST" }).catch(() => {});
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={styles.container} testID="activity-screen">
      <RadialAura color="#F472B6" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity
            onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/home"); }}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Activity</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        >
          {loading ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : items.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="sparkles-outline" size={40} color={COLORS.textTertiary} />
              <Text style={styles.emptyTitle}>Nothing yet</Text>
              <Text style={styles.empty}>
                When friends react or comment on your auras, you'll see them here.
              </Text>
            </View>
          ) : (
            items.map((it) => {
              const em = EMOTION_COLORS[it.mood_emotion || "calm"];
              const reactDef = REACTIONS.find((r) => r.key === it.emoji);
              return (
                <View key={it.activity_id} style={[styles.row, !it.read && styles.rowUnread]}>
                  <View style={[styles.avatar, { backgroundColor: it.from_avatar_color || "#A78BFA", overflow: "hidden" }]}>
                    {it.from_avatar_b64 ? (
                      <Image source={{ uri: `data:image/jpeg;base64,${it.from_avatar_b64}` }} style={{ width: 44, height: 44 }} />
                    ) : (
                      <Text style={styles.avatarTxt}>{(it.from_name || "?").slice(0, 1).toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.line}>
                      <Text style={styles.name}>{it.from_name || "Someone"} </Text>
                      {it.kind === "reaction" ? (
                        <Text style={styles.action}>reacted {reactDef ? reactDef.label.toLowerCase() : ""} to your </Text>
                      ) : (
                        <Text style={styles.action}>commented on your </Text>
                      )}
                      <Text style={[styles.moodWord, { color: em?.hex || "#fff" }]}>
                        "{it.mood_word || "aura"}"
                      </Text>
                    </Text>
                    {it.kind === "comment" && it.text ? (
                      <Text style={styles.commentTxt} numberOfLines={2}>"{it.text}"</Text>
                    ) : null}
                    <View style={styles.meta}>
                      {it.kind === "reaction" && reactDef ? (
                        <View style={[styles.reactBadge, { borderColor: em?.hex + "55" }]}>
                          <Ionicons name={reactDef.icon as any} size={12} color={em?.hex || "#fff"} />
                          <Text style={[styles.reactBadgeTxt, { color: em?.hex || "#fff" }]}>{reactDef.label}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.time}>{timeAgo(it.at)}</Text>
                    </View>
                  </View>
                  {!it.read ? <View style={styles.unreadDot} /> : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 14, fontSize: 14 },
  emptyBox: { alignItems: "center", marginTop: 80, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
  rowUnread: { backgroundColor: "rgba(236,72,153,0.08)", borderColor: "rgba(236,72,153,0.3)" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#000", fontWeight: "800", fontSize: 16 },
  line: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  name: { color: "#fff", fontWeight: "700" },
  action: { color: COLORS.textSecondary },
  moodWord: { fontWeight: "700" },
  commentTxt: { color: "#fff", fontSize: 13, marginTop: 4, fontStyle: "italic" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  reactBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1 },
  reactBadgeTxt: { fontSize: 10, fontWeight: "700" },
  time: { color: COLORS.textTertiary, fontSize: 11 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EC4899" },
});
