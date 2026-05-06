import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Image, Pressable, Modal, Alert,
  Animated as RNAnimated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { uploadMedia } from "../src/media";
import { COLORS } from "../src/theme";

// Insta-style DM picker reactions (heart is NOT here — it's reserved for double-tap).
// 12 slots = 2 rows of 6 on typical phone widths. Chosen to cover the emotional palette
// of a mood-sharing app (love, support, awe, comfort, prayer/gratitude).
const REACTIONS: {
  key:
    | "thumb" | "fire" | "laugh" | "wow" | "sad" | "clap"
    | "hundred" | "touched" | "love_eyes" | "pray" | "rainbow" | "hug_arms";
  emoji: string;
}[] = [
  { key: "thumb",     emoji: "👍" },
  { key: "fire",      emoji: "🔥" },
  { key: "laugh",     emoji: "😂" },
  { key: "wow",       emoji: "😮" },
  { key: "sad",       emoji: "😢" },
  { key: "clap",      emoji: "👏" },
  { key: "hundred",   emoji: "💯" },
  { key: "touched",   emoji: "🥹" },
  { key: "love_eyes", emoji: "🥰" },
  { key: "pray",      emoji: "🙏" },
  { key: "rainbow",   emoji: "🌈" },
  { key: "hug_arms",  emoji: "🫂" },
];
// Heart is still a valid server-side key — we just send it from the double-tap gesture.
const HEART_EMOJI = "❤️";

// Render a reaction chip for any emoji key (includes heart even though it's not in the picker).
function emojiForKey(k: string): string {
  const found = REACTIONS.find((x) => x.key === k);
  if (found) return found.emoji;
  if (k === "heart") return HEART_EMOJI;
  return "·";
}

export default function Conversation() {
  const router = useRouter();
  const { user } = useAuth();
  const { peer_id } = useLocalSearchParams<{ peer_id: string }>();
  const [peer, setPeer] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  // Reaction picker state
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // Reply-to state — { message_id, preview, sender_name }
  const [replyTo, setReplyTo] = useState<
    { message_id: string; preview: string; sender_name: string } | null
  >(null);

  // Audio recording state
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimer = useRef<any>(null);

  // Audio playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState<1 | 2>(1);
  const [audioProgress, setAudioProgress] = useState(0); // 0..1 for currently playing msg
  const soundRef = useRef<Audio.Sound | null>(null);

  // Double-tap detection per message
  const lastTapRef = useRef<Record<string, number>>({});

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

  // --- Send text / photo / voice ---
  const sendText = async () => {
    if (!text.trim() || !peer_id) return;
    const v = text.trim();
    setText("");
    const body: any = { text: v };
    if (replyTo) {
      body.reply_to = replyTo.message_id;
      body.reply_preview = replyTo.preview;
      body.reply_sender_name = replyTo.sender_name;
    }
    setReplyTo(null);
    try {
      await api(`/messages/with/${peer_id}`, { method: "POST", body });
      await load();
    } catch {}
  };

  const sendPhoto = async () => {
    if (!peer_id) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permission required", "Allow photo library access to attach images."); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const key = await uploadMedia("msg_photo", res.assets[0].uri, "image/jpeg");
      const body: any = { photo_key: key };
      if (replyTo) {
        body.reply_to = replyTo.message_id;
        body.reply_preview = replyTo.preview;
        body.reply_sender_name = replyTo.sender_name;
      }
      setReplyTo(null);
      await api(`/messages/with/${peer_id}`, { method: "POST", body });
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't attach photo", e?.message || "Try again.");
    }
  };

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
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      if (!uri) return;
      const body: any = { audio_seconds: Math.max(1, secs) };
      if (replyTo) {
        body.reply_to = replyTo.message_id;
        body.reply_preview = replyTo.preview;
        body.reply_sender_name = replyTo.sender_name;
      }
      setReplyTo(null);
      try {
        const key = await uploadMedia("msg_audio", uri, "audio/m4a", { compress: false });
        body.audio_key = key;
        await api(`/messages/with/${peer_id}`, { method: "POST", body });
      } catch {
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
        body.audio_b64 = b64;
        await api(`/messages/with/${peer_id}`, { method: "POST", body });
      }
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
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
    } catch {}
  };

  // --- Play / pause audio ---
  const playAudio = async (m: any) => {
    try {
      if (playingId === m.message_id) {
        await soundRef.current?.stopAsync();
        await soundRef.current?.unloadAsync();
        soundRef.current = null;
        setPlayingId(null);
        setAudioProgress(0);
        return;
      }
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      if (!m?.audio_b64 && !m?.audio_url) {
        Alert.alert("Voice note unavailable", "This message has no audio data.");
        return;
      }
      const sourceUri = m.audio_url ? m.audio_url : `data:audio/m4a;base64,${m.audio_b64}`;
      const { sound } = await Audio.Sound.createAsync(
        { uri: sourceUri },
        { shouldPlay: true, volume: 1.0, rate: playbackRate, shouldCorrectPitch: true },
      );
      soundRef.current = sound;
      setPlayingId(m.message_id);
      setAudioProgress(0);
      sound.setOnPlaybackStatusUpdate((st: any) => {
        if (st?.isLoaded && st?.durationMillis) {
          const p = Math.min(1, (st.positionMillis || 0) / st.durationMillis);
          setAudioProgress(p);
        }
        if (st?.didJustFinish) {
          setPlayingId(null);
          setAudioProgress(0);
          sound.unloadAsync().catch(() => {});
        }
      });
    } catch (e: any) {
      Alert.alert("Playback error", e?.message || "Try again.");
      setPlayingId(null);
    }
  };

  // Toggle 1x / 2x — applies to current playback if any, and future ones.
  const toggleRate = async () => {
    const next: 1 | 2 = playbackRate === 1 ? 2 : 1;
    setPlaybackRate(next);
    try {
      if (soundRef.current) {
        await soundRef.current.setRateAsync(next, true /*shouldCorrectPitch*/);
      }
    } catch {}
  };

  // --- Toggle reaction (picker or double-tap) ---
  const react = async (messageId: string, emojiKey: string) => {
    setPickerFor(null);
    // Optimistic local update so the double-tap heart feels instant.
    setMessages((prev) => prev.map((m) => {
      if (m.message_id !== messageId) return m;
      const existing = (m.reactions || []) as any[];
      const mine = existing.filter((r) => r.user_id === user?.user_id);
      const hasSame = mine.some((r) => r.emoji === emojiKey);
      let next: any[];
      if (hasSame) {
        next = existing.filter((r) => !(r.user_id === user?.user_id && r.emoji === emojiKey));
      } else {
        next = existing.filter((r) => r.user_id !== user?.user_id);
        next.push({ user_id: user?.user_id, name: user?.name || "", emoji: emojiKey, at: new Date().toISOString() });
      }
      return { ...m, reactions: next };
    }));
    try {
      const r = await api<{ reactions: any[] }>(`/messages/${messageId}/react`, { method: "POST", body: { emoji: emojiKey } });
      setMessages((prev) => prev.map((m) => m.message_id === messageId ? { ...m, reactions: r.reactions } : m));
    } catch {
      // Revert by re-loading on failure.
      load();
    }
  };

  // Double-tap → heart reaction.
  const handleBubbleTap = (message_id: string) => {
    const now = Date.now();
    const last = lastTapRef.current[message_id] || 0;
    if (now - last < 280) {
      lastTapRef.current[message_id] = 0;
      react(message_id, "heart");
    } else {
      lastTapRef.current[message_id] = now;
    }
  };

  // --- Swipe-to-reply renderer ---
  const renderSwipeAction = (_progress: any, dragX: any) => {
    const translateX = dragX.interpolate({
      inputRange: [0, 64],
      outputRange: [-24, 0],
      extrapolate: "clamp",
    });
    const opacity = dragX.interpolate({
      inputRange: [0, 40, 64],
      outputRange: [0, 0.6, 1],
      extrapolate: "clamp",
    });
    return (
      <RNAnimated.View style={[styles.swipeReplyIcon, { transform: [{ translateX }], opacity }]}>
        <Ionicons name="arrow-undo" size={18} color="#fff" />
      </RNAnimated.View>
    );
  };

  const onSwipeOpen = (m: any) => {
    const preview = m.text
      ? m.text
      : (m.photo_url || m.photo_b64)
        ? "📷 Photo"
        : (m.audio_url || m.audio_b64)
          ? "🎙 Voice note"
          : "";
    setReplyTo({
      message_id: m.message_id,
      preview: preview.slice(0, 140),
      sender_name: m.sender_id === user?.user_id ? (user?.name || "You") : (m.sender_name || peer?.name || "Friend"),
    });
    // Close the swipe immediately after triggering the reply intent.
    setTimeout(() => swipeableRefs.current[m.message_id]?.close(), 50);
  };

  const auraColor = peer?.avatar_color || "#A78BFA";

  const renderReactions = (m: any, mine: boolean) => {
    const reactions = (m.reactions || []) as any[];
    if (reactions.length === 0) return null;
    const map: Record<string, number> = {};
    for (const r of reactions) { map[r.emoji] = (map[r.emoji] || 0) + 1; }
    return (
      <View style={[styles.reactRow, mine ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
        {Object.entries(map).map(([k, count]) => (
          <View key={k} style={styles.reactChip}>
            <Text style={styles.reactChipTxt}>{emojiForKey(k)} {count > 1 ? count : ""}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderReplyChip = (m: any, mine: boolean) => {
    if (!m.reply_to && !m.reply_preview) return null;
    return (
      <View style={[styles.replyChip, mine ? styles.replyChipMine : styles.replyChipTheirs]}>
        <View style={[styles.replyBar, { backgroundColor: mine ? "#6B21A8" : "#A78BFA" }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[styles.replyChipName, mine ? { color: "rgba(0,0,0,0.75)" } : { color: "rgba(255,255,255,0.85)" }]}
            numberOfLines={1}
          >
            {m.reply_sender_name || "Replied"}
          </Text>
          <Text
            style={[styles.replyChipTxt, mine ? { color: "rgba(0,0,0,0.6)" } : { color: "rgba(255,255,255,0.6)" }]}
            numberOfLines={1}
          >
            {m.reply_preview || "Message"}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
                const isPlayingThis = playingId === item.message_id;
                const totalSec = Math.max(1, item.audio_seconds || 0);
                const curSec = Math.floor(totalSec * audioProgress);
                const displaySec = isPlayingThis ? curSec : totalSec;
                const hasAudio = !!item.audio_url || !!item.audio_b64;
                const hasPhoto = !!item.photo_url || !!item.photo_b64;
                const bubbleNode = (
                  <Pressable
                    onPress={() => handleBubbleTap(item.message_id)}
                    onLongPress={() => setPickerFor(item.message_id)}
                    delayLongPress={300}
                    testID={`msg-${item.message_id}`}
                    style={[
                      styles.bubble,
                      mine ? styles.bubbleMine : styles.bubbleTheirs,
                      hasAudio && styles.bubbleAudio,
                      hasPhoto && styles.bubblePhoto,
                    ]}
                  >
                    {renderReplyChip(item, mine)}
                    {hasPhoto && (
                      <Image
                        source={{ uri: item.photo_url || `data:image/jpeg;base64,${item.photo_b64}` }}
                        style={styles.attachImg}
                        resizeMode="cover"
                      />
                    )}
                    {hasAudio && (
                      <View style={styles.audioRow}>
                        <TouchableOpacity onPress={() => playAudio(item)} style={{ flexShrink: 0 }}>
                          <Ionicons
                            name={isPlayingThis ? "pause-circle" : "play-circle"}
                            size={32}
                            color={mine ? "#000" : "#fff"}
                          />
                        </TouchableOpacity>
                        <View style={styles.audioWaveWrap}>
                          <View style={[styles.audioWaveTrack, { backgroundColor: mine ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)" }]} />
                          {isPlayingThis ? (
                            <View
                              style={[
                                styles.audioWaveFill,
                                {
                                  backgroundColor: mine ? "#000" : "#fff",
                                  width: `${Math.max(4, audioProgress * 100)}%`,
                                },
                              ]}
                            />
                          ) : null}
                        </View>
                        <Text style={[styles.audioTime, { color: mine ? "#000" : "#fff" }]}>
                          {String(Math.floor(displaySec / 60)).padStart(2, "0")}:{String(displaySec % 60).padStart(2, "0")}
                        </Text>
                        <TouchableOpacity
                          onPress={toggleRate}
                          hitSlop={6}
                          style={[
                            styles.rateBtn,
                            {
                              backgroundColor: mine ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.12)",
                              borderColor: mine ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.25)",
                            },
                          ]}
                        >
                          <Text style={[styles.rateTxt, { color: mine ? "#000" : "#fff" }]}>{playbackRate}x</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {!!item.text && <Text style={[styles.msg, mine && { color: "#000" }]}>{item.text}</Text>}
                  </Pressable>
                );
                return (
                  <Swipeable
                    ref={(ref) => { swipeableRefs.current[item.message_id] = ref; }}
                    friction={2}
                    rightThreshold={64}
                    leftThreshold={64}
                    overshootRight={false}
                    overshootLeft={false}
                    renderLeftActions={mine ? undefined : renderSwipeAction}
                    renderRightActions={mine ? renderSwipeAction : undefined}
                    onSwipeableOpen={() => onSwipeOpen(item)}
                  >
                    <View style={[styles.rowContainer, mine ? styles.rowContainerMine : styles.rowContainerTheirs]}>
                      <View style={styles.msgCol}>
                        {/* Bubble alone — no inline smiley button. To react, users
                            either double-tap the bubble (quick ❤️) or long-press it
                            (full picker). The redundant smiley icon was removed
                            because it cluttered the chat visually. */}
                        <View style={[styles.bubbleLine, mine ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
                          {bubbleNode}
                        </View>
                        {renderReactions(item, mine)}
                      </View>
                    </View>
                  </Swipeable>
                );
              }}
              ListEmptyComponent={<Text style={styles.empty}>Say hi to {peer?.name?.split(" ")[0] || "your friend"}.</Text>}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            />

            {recording && (
              <View style={styles.recBanner}>
                <View style={styles.recDot} />
                <Text style={styles.recTxt}>Recording… {recordSeconds}s / 60s</Text>
                <TouchableOpacity onPress={cancelRecording} style={styles.recBtn}><Text style={styles.recBtnTxt}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => stopAndSend()} style={[styles.recBtn, { backgroundColor: "#fff" }]}><Text style={[styles.recBtnTxt, { color: "#000" }]}>Send</Text></TouchableOpacity>
              </View>
            )}

            {replyTo && (
              <View style={styles.replyPreviewBar} testID="reply-preview">
                <View style={[styles.replyBar, { backgroundColor: auraColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.replyPreviewName}>Replying to {replyTo.sender_name}</Text>
                  <Text style={styles.replyPreviewTxt} numberOfLines={1}>{replyTo.preview || "Message"}</Text>
                </View>
                <TouchableOpacity onPress={() => setReplyTo(null)} style={styles.replyCancelBtn}>
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
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
                placeholder={replyTo ? "Reply…" : "Message"}
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
    </GestureHandlerRootView>
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
  // Row-level container — full width of the FlatList item, controls left/right alignment
  rowContainer: {
    flexDirection: "row",
    marginBottom: 10,
    width: "100%",
  },
  rowContainerMine: { justifyContent: "flex-end" },
  rowContainerTheirs: { justifyContent: "flex-start" },
  // Column containing the bubble + any under-bubble reactions.
  // Hard-caps width at 82% so voice notes + reply chips can never escape the screen.
  msgCol: { maxWidth: "82%", flexShrink: 1 },
  // Line holding bubble + reactBtn side-by-side.
  bubbleLine: { flexDirection: "row", alignItems: "flex-end", gap: 4, flexShrink: 1 },
  bubble: { padding: 10, borderRadius: 18, overflow: "hidden", flexShrink: 1 },
  bubbleMine: { backgroundColor: "#fff", borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: "rgba(255,255,255,0.08)", borderBottomLeftRadius: 4 },
  // Audio bubbles need a minimum sane width so the progress bar doesn't collapse.
  bubbleAudio: { minWidth: 210, paddingVertical: 8, paddingRight: 10 },
  bubblePhoto: { padding: 4 },
  msg: { color: "#fff", fontSize: 15, lineHeight: 20, paddingHorizontal: 2, paddingVertical: 2 },
  attachImg: { width: 220, height: 220, borderRadius: 14 },

  audioRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  audioWaveWrap: { flexShrink: 1, flexGrow: 1, height: 14, borderRadius: 7, minWidth: 50, justifyContent: "center", overflow: "hidden" },
  audioWaveTrack: { ...StyleSheet.absoluteFillObject, borderRadius: 7 },
  audioWaveFill: { height: 14, borderRadius: 7 },
  audioTime: { fontSize: 12, fontWeight: "700", minWidth: 36, textAlign: "right", flexShrink: 0 },
  rateBtn: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1, flexShrink: 0 },
  rateTxt: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },

  // Inline react button (no absolute positioning — it sits next to the bubble).
  reactBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    marginBottom: 4,
  },
  reactRow: { flexDirection: "row", gap: 4, marginTop: 4, paddingHorizontal: 6, flexWrap: "wrap" },
  reactChip: { backgroundColor: "rgba(0,0,0,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 14 },
  reactChipTxt: { color: "#fff", fontSize: 12 },

  // Reply visuals — kept compact but given a minWidth so preview text actually reads.
  replyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 6,
    minWidth: 180,
  },
  replyChipMine: { backgroundColor: "rgba(0,0,0,0.08)" },
  replyChipTheirs: { backgroundColor: "rgba(255,255,255,0.08)" },
  replyBar: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  replyChipName: { fontSize: 11, fontWeight: "700" },
  replyChipTxt: { fontSize: 12 },
  replyPreviewBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderTopWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  replyPreviewName: { color: "#fff", fontSize: 12, fontWeight: "700" },
  replyPreviewTxt: { color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 2 },
  replyCancelBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },

  // Swipe-to-reply icon
  swipeReplyIcon: {
    width: 64,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
  },

  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center" },
  pickerBar: { flexDirection: "row", flexWrap: "wrap", gap: 4, backgroundColor: "#0B0B0F", borderRadius: 30, padding: 8, borderWidth: 1, borderColor: COLORS.border, maxWidth: 340, justifyContent: "center" },
  pickerEmojiBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  pickerEmoji: { fontSize: 28 },

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
