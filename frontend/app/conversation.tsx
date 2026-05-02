import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

export default function Conversation() {
  const router = useRouter();
  const { user } = useAuth();
  const { peer_id } = useLocalSearchParams<{ peer_id: string }>();
  const [peer, setPeer] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!peer_id) return;
    try {
      const r = await api<any>(`/messages/with/${peer_id}`);
      setPeer(r.peer);
      setMessages(r.messages || []);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    } catch {}
  }, [peer_id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const send = async () => {
    if (!text.trim() || !peer_id) return;
    const v = text.trim();
    setText("");
    try {
      await api(`/messages/with/${peer_id}`, { method: "POST", body: { text: v } });
      await load();
    } catch {}
  };

  const auraColor = peer?.avatar_color || "#A78BFA";

  return (
    <View style={styles.container} testID="conversation-screen">
      <RadialAura color={auraColor} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity testID="conv-back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/friends"); }} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.peerRow}>
            <View style={[styles.peerAvatar, { backgroundColor: auraColor, overflow: "hidden" }]}>
              {peer?.avatar_b64 ? (
                <Image source={{ uri: `data:image/jpeg;base64,${peer.avatar_b64}` }} style={{ width: 36, height: 36 }} />
              ) : (
                <Text style={styles.peerInit}>{(peer?.name || "?").slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.peerName}>{peer?.name || ""}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }} keyboardVerticalOffset={10}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.message_id}
            contentContainerStyle={{ padding: 16, paddingBottom: 12 }}
            renderItem={({ item }) => {
              const mine = item.sender_id === user?.user_id;
              return (
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]} testID={`msg-${item.message_id}`}>
                  <Text style={[styles.msg, mine && { color: "#000" }]}>{item.text}</Text>
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>Say hi to {peer?.name?.split(" ")[0] || "your friend"}.</Text>}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
          <View style={styles.inputRow}>
            <TextInput
              testID="msg-input"
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor="#666"
              style={styles.input}
              multiline
            />
            <TouchableOpacity testID="msg-send" onPress={send} disabled={!text.trim()} style={[styles.sendBtn, !text.trim() && { opacity: 0.4 }]}>
              <Ionicons name="arrow-up" size={20} color="#000" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  peerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  peerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  peerInit: { color: "#000", fontWeight: "800" },
  peerName: { color: "#fff", fontWeight: "700", fontSize: 16 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 60 },
  bubble: { padding: 12, borderRadius: 18, maxWidth: "78%", marginBottom: 8 },
  bubbleMine: { backgroundColor: "#fff", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: "rgba(255,255,255,0.08)", alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  msg: { color: "#fff", fontSize: 15, lineHeight: 20 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(0,0,0,0.5)" },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, color: "#fff", maxHeight: 110, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
