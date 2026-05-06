import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../../src/components/RadialAura";
import EmptyState from "../../src/components/EmptyState";
import { api } from "../../src/api";
import { COLORS } from "../../src/theme";

type Conversation = {
  conversation_id: string;
  peer_id: string;
  peer_name: string;
  peer_avatar_color?: string;
  peer_avatar_b64?: string | null;
  last_text?: string;
  last_at?: string;
  unread: number;
};

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function MessagesInbox() {
  const router = useRouter();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api<{ conversations: Conversation[] }>("/messages/conversations");
      setConvs(r.conversations || []);
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const unreadTotal = convs.reduce((sum, c) => sum + (c.unread || 0), 0);

  return (
    <View style={styles.container} testID="messages-screen">
      <RadialAura color="#A78BFA" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <Text style={styles.title}>Messages</Text>
          {unreadTotal > 0 ? (
            <View style={styles.unreadBadge}>
              <Ionicons name="mail-unread" size={11} color="#fff" />
              <Text style={styles.unreadBadgeTxt}>{unreadTotal} new</Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        >
          {loading ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : convs.length === 0 ? (
            <EmptyState
              tone="default"
              title="No messages yet"
              subtitle="When a friend sends you a message from your aura, it will land here."
              cta={
                <TouchableOpacity
                  style={styles.friendsBtn}
                  testID="go-friends"
                  onPress={() => router.push("/(tabs)/friends")}
                >
                  <Ionicons name="people" size={14} color="#000" />
                  <Text style={styles.friendsBtnTxt}>Find friends</Text>
                </TouchableOpacity>
              }
            />
          ) : (
            convs.map((c) => (
              <TouchableOpacity
                key={c.conversation_id}
                testID={`conv-${c.peer_id}`}
                activeOpacity={0.8}
                onPress={() => router.push({ pathname: "/conversation", params: { peer_id: c.peer_id } })}
                style={[styles.row, c.unread > 0 && styles.rowUnread]}
              >
                <View style={[styles.avatar, { backgroundColor: c.peer_avatar_color || "#A78BFA", overflow: "hidden" }]}>
                  {c.peer_avatar_b64 ? (
                    <Image source={{ uri: `data:image/jpeg;base64,${c.peer_avatar_b64}` }} style={{ width: 44, height: 44 }} />
                  ) : (
                    <Text style={styles.avatarTxt}>{(c.peer_name || "?").slice(0, 1).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={styles.name} numberOfLines={1}>{c.peer_name}</Text>
                    <Text style={styles.time}>{timeAgo(c.last_at)}</Text>
                  </View>
                  <Text
                    style={[styles.preview, c.unread > 0 && styles.previewUnread]}
                    numberOfLines={1}
                  >
                    {c.last_text || "Start the conversation…"}
                  </Text>
                </View>
                {c.unread > 0 ? (
                  <View style={styles.unreadDot}>
                    <Text style={styles.unreadDotTxt}>{c.unread > 9 ? "9+" : c.unread}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { color: "#fff", fontSize: 34, fontWeight: "800", letterSpacing: -1 },
  unreadBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#EC4899" },
  unreadBadgeTxt: { color: "#fff", fontSize: 11, fontWeight: "700" },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 12, fontSize: 14 },
  emptyBox: { alignItems: "center", marginTop: 80, paddingHorizontal: 30 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 12 },
  friendsBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 20, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: "#fff" },
  friendsBtnTxt: { color: "#000", fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
  rowUnread: { backgroundColor: "rgba(236,72,153,0.08)", borderColor: "rgba(236,72,153,0.3)" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#000", fontWeight: "800", fontSize: 16 },
  name: { color: "#fff", fontWeight: "700", fontSize: 15, flex: 1 },
  time: { color: COLORS.textTertiary, fontSize: 11, marginLeft: 8 },
  preview: { color: COLORS.textSecondary, fontSize: 13, marginTop: 3 },
  previewUnread: { color: "#fff", fontWeight: "600" },
  unreadDot: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: "#EC4899", alignItems: "center", justifyContent: "center" },
  unreadDotTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
