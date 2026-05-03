import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Image, Pressable, Modal, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

const REACTIONS: { key: "heart" | "thumb" | "fire" | "laugh" | "wow" | "sad"; emoji: string }[] = [
  { key: "heart", emoji: "❤️" },
  { key: "thumb", emoji: "👍" },
  { key: "fire",  emoji: "🔥" },
  { key: "laugh", emoji: "😂" },
  { key: "wow",   emoji: "😮" },
  { key: "sad",   emoji: "😢" },
];

export default function Conversation() {
  const router = useRouter();
  const { user } = useAuth();
  const { peer_id } = useLocalSearchParams<{ peer_id: string }>();
  const [peer, setPeer] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  // Reaction picker state
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // Audio recording state
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimer = useRef<any>(null);

  // Audio playback (which message is playing)
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

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

  useEffect(() => () => {
    if (recordTimer.current) clearInterval(recordTimer.current);
    soundRef.current?.unloadAsync().catch(() => {});
  }, []);

  // --- Send text ---
  const sendText = async () => {
    if (!text.trim() || !peer_id) return;
    const v = text.trim();
    setText("");
    try {
      await api(`/messages/with/${peer_id}`, { method: "POST", body: { text: v } });
      await load();
    } catch {}
  };

  // --- Send photo ---
  const sendPhoto = async () => {
    if (!peer_id) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permission required", "Allow photo library access to attach images."); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.65,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const b64 = res.assets[0].base64;
      await api(`/messages/with/${peer_id}`, { method: "POST", body: { photo_b64: b64 } });
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't attach photo", e?.message || "Try again.");
    }
  };

  // --- Record voice note ---
  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert("Mic permission required"); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setRecordSeconds(0);
      recordTimer.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 60) { stopAndSend(rec); return s; }
          return s + 1;
        });
      }, 1000);
    } catch (e: any) {
      Alert.alert("Recording error", e?.message || "Try again.");
    }
  };
  const stopAndSend = async (rec?: Audio.Recording | null) => {
    const r = rec || recording;
    if (!r || !peer_id) return;
    try {
      if (recordTimer.current) { clearInterval(recordTimer.current); recordTimer.current = null; }
      await r.stopAndUnloadAsync();
      const uri = r.getURI();
      setRecording(null);
      const secs = recordSeconds;
      setRecordSeconds(0);
      if (!uri) return;
      // Fetch the audio file and base64-encode it
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Read failed"));
        reader.onloadend = () => {
          const s = (reader.result as string) || "";
          resolve(s.split(",")[1] || "");
        };
        reader.readAsDataURL(blob);
      });
      await api(`/messages/with/${peer_id}`, { method: "POST", body: { audio_b64: b64, audio_seconds: Math.max(1, secs) } });
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't send voice note", e?.message || "Try again.");
    }
  };
  const cancelRecording = async () => {
    if (recordTimer.current) { clearInterval(recordTimer.current); recordTimer.current = null; }
    try { await recording?.stopAndUnloadAsync(); } catch {}
    setRecording(null);
    setRecordSeconds(0);
  };

  // --- Play audio message ---
  const playAudio = async (m: any) => {
    try {
      if (playingId === m.message_id) {
        await soundRef.current?.stopAsync();
        await soundRef.current?.unloadAsync();
        soundRef.current = null;
        setPlayingId(null);
        return;
      }
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({
        uri: `data:audio/m4a;base64,${m.audio_b64}`,
      });
      soundRef.current = sound;
      setPlayingId(m.message_id);
      sound.setOnPlaybackStatusUpdate((st: any) => {
        if (st?.didJustFinish) { setPlayingId(null); sound.unloadAsync().catch(() => {}); }
      });
      await sound.playAsync();
    } catch (e: any) {
      Alert.alert("Playback error", e?.message || "Try again.");
    }
  };

  // --- Toggle reaction ---
  const react = async (messageId: string, emoji: string) => {
    setPickerFor(null);
    try {
      const r = await api<{ reactions: any[] }>(`/messages/${messageId}/react`, { method: "POST", body: { emoji } });
      setMessages((prev) => prev.map((m) => m.message_id === messageId ? { ...m, reactions: r.reactions } : m));
    } catch {}
  };

  const auraColor = peer?.avatar_color || "#A78BFA";

  const renderReactions = (m: any) => {
    const reactions = (m.reactions || []) as any[];
    if (reactions.length === 0) return null;
    // Aggregate by emoji key
    const map: Record<string, number> = {};
    for (const r of reactions) { map[r.emoji] = (map[r.emoji] || 0) + 1; }
    return (
      <View style={styles.reactRow}>
        {Object.entries(map).map(([k, count]) => {
          const rx = REACTIONS.find((x) => x.key === k);
          return (
            <View key={k} style={styles.reactChip}>
              <Text style={styles.reactChipTxt}>{rx?.emoji || "·"} {count > 1 ? count : ""}</Text>
            </View>
          );
        })}
      </View>
    );
  };

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
                <View style={[styles.bubbleWrap, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
                  <Pressable
                    onLongPress={() => setPickerFor(item.message_id)}
                    testID={`msg-${item.message_id}`}
                    style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                  >
                    {!!item.photo_b64 && (
                      <Image
                        source={{ uri: `data:image/jpeg;base64,${item.photo_b64}` }}
                        style={styles.attachImg}
                        resizeMode="cover"
                      />
                    )}
                    {!!item.audio_b64 && (
                      <TouchableOpacity onPress={() => playAudio(item)} style={styles.audioRow}>
                        <Ionicons
                          name={playingId === item.message_id ? "pause-circle" : "play-circle"}
                          size={36}
                          color={mine ? "#000" : "#fff"}
                        />
                        <View style={[styles.audioWave, { backgroundColor: mine ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)" }]} />
                        <Text style={[styles.audioTime, { color: mine ? "#000" : "#fff" }]}>
                          {String(Math.floor((item.audio_seconds || 0) / 60)).padStart(2, "0")}:{String((item.audio_seconds || 0) % 60).padStart(2, "0")}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {!!item.text && <Text style={[styles.msg, mine && { color: "#000" }]}>{item.text}</Text>}
                  </Pressable>

                  {/* React button (small bubble-side icon) */}
                  <TouchableOpacity
                    testID={`react-btn-${item.message_id}`}
                    onPress={() => setPickerFor(pickerFor === item.message_id ? null : item.message_id)}
                    style={[styles.reactBtn, mine ? { right: undefined, left: -6 } : { right: -6 }]}
                  >
                    <Ionicons name="happy-outline" size={14} color="#fff" />
                  </TouchableOpacity>

                  {renderReactions(item)}
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>Say hi to {peer?.name?.split(" ")[0] || "your friend"}.</Text>}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />

          {/* Recording banner */}
          {recording && (
            <View style={styles.recBanner}>
              <View style={styles.recDot} />
              <Text style={styles.recTxt}>Recording… {recordSeconds}s / 60s</Text>
              <TouchableOpacity onPress={cancelRecording} style={styles.recBtn}><Text style={styles.recBtnTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => stopAndSend()} style={[styles.recBtn, { backgroundColor: "#fff" }]}><Text style={[styles.recBtnTxt, { color: "#000" }]}>Send</Text></TouchableOpacity>
            </View>
          )}

          <View style={styles.inputRow}>
            <TouchableOpacity testID="msg-photo" onPress={sendPhoto} style={styles.iconBtn}>
              <Ionicons name="image-outline" size={22} color="#fff" />
            </TouchableOpacity>
            {!text.trim() ? (
              <TouchableOpacity
                testID="msg-mic"
                onPress={recording ? () => stopAndSend() : startRecording}
                style={[styles.iconBtn, recording && { backgroundColor: "#EF4444" }]}
              >
                <Ionicons name={recording ? "stop" : "mic-outline"} size={22} color="#fff" />
              </TouchableOpacity>
            ) : null}
            <TextInput
              testID="msg-input"
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor="#666"
              style={styles.input}
              multiline
            />
            {text.trim() ? (
              <TouchableOpacity testID="msg-send" onPress={sendText} style={styles.sendBtn}>
                <Ionicons name="arrow-up" size={20} color="#000" />
              </TouchableOpacity>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Reaction picker */}
      <Modal
        visible={!!pickerFor}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerFor(null)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerFor(null)}>
          <View style={styles.pickerBar}>
            {REACTIONS.map((r) => (
              <TouchableOpacity
                key={r.key}
                testID={`pick-${r.key}`}
                onPress={() => pickerFor && react(pickerFor, r.key)}
                style={styles.pickerEmojiBtn}
              >
                <Text style={styles.pickerEmoji}>{r.emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
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

  bubbleWrap: { marginBottom: 12, position: "relative" },
  bubble: { padding: 10, borderRadius: 18, maxWidth: "78%", overflow: "hidden" },
  bubbleMine: { backgroundColor: "#fff", borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: "rgba(255,255,255,0.08)", borderBottomLeftRadius: 4 },
  msg: { color: "#fff", fontSize: 15, lineHeight: 20, paddingHorizontal: 2, paddingVertical: 2 },
  attachImg: { width: 220, height: 220, borderRadius: 14, marginBottom: 4 },
  audioRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, paddingRight: 6 },
  audioWave: { flex: 1, height: 14, borderRadius: 7, minWidth: 80 },
  audioTime: { fontSize: 12, fontWeight: "600" },

  reactBtn: { position: "absolute", bottom: -8, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.7)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  reactRow: { flexDirection: "row", gap: 4, marginTop: 4, paddingHorizontal: 6 },
  reactChip: { backgroundColor: "rgba(0,0,0,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 14 },
  reactChipTxt: { color: "#fff", fontSize: 12 },

  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center" },
  pickerBar: { flexDirection: "row", gap: 6, backgroundColor: "#0B0B0F", borderRadius: 30, padding: 8, borderWidth: 1, borderColor: COLORS.border },
  pickerEmojiBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  pickerEmoji: { fontSize: 30 },

  recBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(239,68,68,0.15)", borderWidth: 1, borderColor: "#EF4444", paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 12, marginBottom: 4, borderRadius: 14 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444" },
  recTxt: { color: "#fff", flex: 1, fontSize: 13, fontWeight: "600" },
  recBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  recBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },

  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(0,0,0,0.5)" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, color: "#fff", maxHeight: 110, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
