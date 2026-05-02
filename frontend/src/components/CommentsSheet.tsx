import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api";
import { COLORS, EMOTION_COLORS } from "../theme";

type Props = {
  visible: boolean;
  moodId: string;
  emotion: string;
  onClose: () => void;
};

export default function CommentsSheet({ visible, moodId, emotion, onClose }: Props) {
  const em = EMOTION_COLORS[emotion] || EMOTION_COLORS.calm;
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!moodId) return;
    try {
      const r = await api<{ comments: any[] }>(`/moods/${moodId}/comments`);
      setComments(r.comments || []);
    } catch {}
  };

  useEffect(() => { if (visible) load(); }, [visible, moodId]);

  const send = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await api(`/moods/${moodId}/comment`, { method: "POST", body: { text: text.trim() } });
      setText("");
      await load();
    } catch (e: any) { Alert.alert("Couldn't send", e?.message || "Try again."); }
    finally { setLoading(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, justifyContent: "flex-end" }}>
          <View style={[styles.sheet, { borderTopColor: em.hex + "60" }]}>
            <View style={styles.header}>
              <Text style={styles.title}>Comments</Text>
              <TouchableOpacity testID="close-comments" onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={comments}
              keyExtractor={(c) => c.comment_id}
              ListEmptyComponent={<Text style={styles.empty}>Be the first to share a kind word.</Text>}
              renderItem={({ item }) => (
                <View style={styles.commentRow} testID={`comment-${item.comment_id}`}>
                  <View style={[styles.avatar, { backgroundColor: item.avatar_color || em.hex }]}>
                    <Text style={styles.avatarTxt}>{(item.name || "?").slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.author}>{item.name}</Text>
                    <Text style={styles.text}>{item.text}</Text>
                  </View>
                </View>
              )}
              style={{ maxHeight: 320 }}
              contentContainerStyle={{ padding: 14 }}
            />
            <View style={styles.inputRow}>
              <TextInput
                testID="comment-input"
                value={text}
                onChangeText={setText}
                placeholder="Write a kind word…"
                placeholderTextColor="#666"
                style={styles.input}
                multiline
                maxLength={300}
              />
              <TouchableOpacity testID="send-comment" onPress={send} disabled={loading || !text.trim()} style={[styles.sendBtn, { backgroundColor: em.hex, opacity: text.trim() ? 1 : 0.4 }]}>
                <Ionicons name="arrow-up" size={18} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: "#0A0A0C", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 2, paddingBottom: 24 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingBottom: 8 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  empty: { color: COLORS.textSecondary, textAlign: "center", padding: 30, fontSize: 13 },
  commentRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#000", fontWeight: "800" },
  author: { color: "#fff", fontWeight: "700", fontSize: 13 },
  text: { color: COLORS.textSecondary, fontSize: 14, marginTop: 2, lineHeight: 20 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 14, paddingTop: 8, borderTopWidth: 1, borderColor: COLORS.border },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, color: "#fff", maxHeight: 100, fontSize: 14 },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
});
