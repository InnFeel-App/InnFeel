import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { EMOTION_COLORS, COLORS, REACTIONS } from "../theme";
import { api } from "../api";
import CommentsSheet from "./CommentsSheet";

type Mood = {
  mood_id: string;
  word: string;
  emotion: string;
  intensity: number;
  photo_b64?: string | null;
  text?: string | null;
  audio_b64?: string | null;
  has_audio?: boolean;
  audio_seconds?: number | null;
  music?: { id: string; name: string; url: string; vibe?: string } | null;
  music_track_id?: string | null;
  author_name?: string;
  author_color?: string;
  author_avatar_b64?: string | null;
  created_at?: string;
  reactions?: any[];
};

type Props = {
  mood: Mood;
  onReact?: (emoji: string) => void;
  onMessage?: () => void;
  showAuthor?: boolean;
  testIDPrefix?: string;
};

export default function MoodCard({ mood, onReact, onMessage, showAuthor = true, testIDPrefix = "mood-card" }: Props) {
  const em = EMOTION_COLORS[mood.emotion] || EMOTION_COLORS.calm;
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [cachedAudio, setCachedAudio] = useState<string | null>(mood.audio_b64 || null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reactingKey, setReactingKey] = useState<string | null>(null);
  const hasAudio = !!(mood.has_audio || mood.audio_b64);
  const commentCount = (mood as any).comments?.length || 0;

  const toggleAudio = async () => {
    if (!hasAudio) return;
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      let b64 = cachedAudio;
      if (!b64) {
        setLoadingAudio(true);
        const r = await api<{ audio_b64: string }>(`/moods/${mood.mood_id}/audio`);
        b64 = r.audio_b64;
        setCachedAudio(b64);
        setLoadingAudio(false);
      }
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri: `data:audio/m4a;base64,${b64}` });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((s: any) => {
          if (s.didJustFinish) {
            setPlaying(false);
            sound.setPositionAsync(0).catch(() => {});
          }
        });
      }
      await soundRef.current.playAsync();
      setPlaying(true);
    } catch {
      setLoadingAudio(false);
      setPlaying(false);
    }
  };

  const handleReact = (key: string) => {
    setReactingKey(key);
    onReact?.(key);
    setTimeout(() => setReactingKey(null), 900);
  };

  return (
    <View style={styles.card} testID={`${testIDPrefix}-${mood.mood_id}`}>
      <LinearGradient
        colors={[em.glow, "rgba(10,10,12,0.0)"]}
        start={{ x: 0.9, y: 0 }}
        end={{ x: 0.1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.headerRow}>
        {showAuthor ? (
          <View style={styles.authorRow}>
            <View style={[styles.avatar, { backgroundColor: mood.author_color || em.hex, overflow: "hidden" }]}>
              {mood.author_avatar_b64 ? (
                <Image source={{ uri: `data:image/jpeg;base64,${mood.author_avatar_b64}` }} style={{ width: 32, height: 32 }} />
              ) : (
                <Text style={styles.avatarTxt}>{(mood.author_name || "?").slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.authorName}>{mood.author_name || "You"}</Text>
          </View>
        ) : <View />}
        <View style={[styles.emotionPill, { borderColor: em.hex }]}>
          <View style={[styles.dot, { backgroundColor: em.hex }]} />
          <Text style={styles.emotionTxt}>{em.label}</Text>
        </View>
      </View>

      {mood.music ? (
        <View style={[styles.musicPill, { borderColor: em.hex }]}>
          <Ionicons name="musical-note" size={12} color={em.hex} />
          <Text style={styles.musicPillTxt}>{mood.music.name}</Text>
        </View>
      ) : null}

      <Text style={styles.word}>{mood.word}</Text>

      <View style={styles.intensityRow}>
        {Array.from({ length: mood.intensity > 5 ? 10 : 5 }).map((_, i) => {
          const on = i < mood.intensity;
          return (
            <View
              key={i}
              style={[
                styles.intensityDot,
                { backgroundColor: on ? em.hex : "rgba(255,255,255,0.08)" },
              ]}
            />
          );
        })}
        <Text style={styles.intensityLabel}>{mood.intensity}/{mood.intensity > 5 ? 10 : 5}</Text>
      </View>

      {mood.photo_b64 ? (
        <Image source={{ uri: `data:image/jpeg;base64,${mood.photo_b64}` }} style={styles.photo} />
      ) : null}

      {mood.text ? <Text style={styles.noteText}>"{mood.text}"</Text> : null}

      {hasAudio ? (
        <TouchableOpacity
          testID={`audio-play-${mood.mood_id}`}
          onPress={toggleAudio}
          activeOpacity={0.85}
          style={[styles.audioRow, { borderColor: em.hex + "80" }]}
        >
          <View style={[styles.audioBtn, { backgroundColor: em.hex }]}>
            {loadingAudio ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Ionicons name={playing ? "pause" : "play"} size={16} color="#000" />
            )}
          </View>
          <View style={styles.audioWaves}>
            {Array.from({ length: 16 }).map((_, i) => (
              <View
                key={i}
                style={{
                  width: 3, marginHorizontal: 2, borderRadius: 2,
                  height: 4 + ((i * 9) % 22),
                  backgroundColor: em.hex, opacity: playing ? 0.9 : 0.55,
                }}
              />
            ))}
          </View>
          <Text style={styles.audioLabel}>
            {mood.audio_seconds ? `0:${String(mood.audio_seconds).padStart(2, "0")}` : "Voice note"}
          </Text>
        </TouchableOpacity>
      ) : null}

      {onReact ? (
        <View style={styles.reactWrap}>
          <Text style={styles.sectionLabel}>React</Text>
          <View style={styles.reactRow}>
            {REACTIONS.map((r) => {
              const active = reactingKey === r.key;
              return (
                <TouchableOpacity
                  key={r.key}
                  testID={`react-${r.key}-${mood.mood_id}`}
                  onPress={() => handleReact(r.key)}
                  activeOpacity={0.8}
                  style={[
                    styles.reactBtn,
                    active && { backgroundColor: em.hex + "22", borderColor: em.hex },
                  ]}
                >
                  <Ionicons
                    name={r.icon as any}
                    size={16}
                    color={active ? em.hex : "#fff"}
                  />
                  <Text
                    style={[
                      styles.reactLabel,
                      active && { color: em.hex },
                    ]}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              testID={`comment-${mood.mood_id}`}
              onPress={() => setCommentsOpen(true)}
              style={styles.actionBtn}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-outline" size={15} color="#fff" />
              <Text style={styles.actionLabel}>Comment{commentCount > 0 ? ` · ${commentCount}` : ""}</Text>
            </TouchableOpacity>
            {onMessage ? (
              <TouchableOpacity
                testID={`message-${mood.mood_id}`}
                onPress={onMessage}
                style={styles.actionBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="paper-plane-outline" size={15} color="#fff" />
                <Text style={styles.actionLabel}>Message</Text>
              </TouchableOpacity>
            ) : null}
            {mood.reactions && mood.reactions.length > 0 ? (
              <View style={styles.reactCountPill}>
                <Ionicons name="heart" size={11} color={em.hex} />
                <Text style={styles.reactCountTxt}>{mood.reactions.length}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      <CommentsSheet visible={commentsOpen} moodId={mood.mood_id} emotion={mood.emotion} onClose={() => setCommentsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
    overflow: "hidden",
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#000", fontWeight: "700" },
  authorName: { color: COLORS.textPrimary, fontWeight: "600" },
  emotionPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  emotionTxt: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "600" },
  word: { color: COLORS.textPrimary, fontSize: 34, fontWeight: "700", letterSpacing: -0.5, marginVertical: 4 },
  intensityRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  intensityDot: { width: 16, height: 6, borderRadius: 3 },
  intensityLabel: { color: COLORS.textTertiary, fontSize: 11, marginLeft: 8 },
  photo: { width: "100%", height: 180, borderRadius: 18, marginTop: 14 },
  noteText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 12, fontStyle: "italic" },
  audioRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, padding: 10, borderRadius: 16, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.04)" },
  audioBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  audioWaves: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", height: 34 },
  audioLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600" },
  musicPill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, backgroundColor: "rgba(0,0,0,0.25)", marginTop: 6, marginBottom: 4 },
  musicPillTxt: { color: "#fff", fontSize: 11, fontWeight: "600" },

  reactWrap: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  sectionLabel: { color: COLORS.textTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  reactRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reactLabel: { color: "#fff", fontSize: 12, fontWeight: "600" },

  actionRow: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionLabel: { color: "#fff", fontSize: 12, fontWeight: "600" },
  reactCountPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reactCountTxt: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
