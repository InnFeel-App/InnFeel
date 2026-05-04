import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, AppState } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";
import { useVideoPlayer, VideoView } from "expo-video";
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
  photo_url?: string | null;
  video_b64?: string | null;
  video_url?: string | null;
  video_seconds?: number | null;
  has_video?: boolean;
  text?: string | null;
  audio_b64?: string | null;
  audio_url?: string | null;
  has_audio?: boolean;
  audio_seconds?: number | null;
  music?: {
    track_id?: string;
    name: string;
    artist?: string | null;
    artwork_url?: string | null;
    preview_url?: string | null;
    source?: string;
  } | null;
  music_track_id?: string | null;
  author_name?: string;
  author_color?: string;
  author_avatar_b64?: string | null;
  author_avatar_url?: string | null;
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
  const musicRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [cachedAudio, setCachedAudio] = useState<string | null>(mood.audio_b64 || null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reactingKey, setReactingKey] = useState<string | null>(null);
  const hasAudio = !!(mood.has_audio || mood.audio_b64 || mood.audio_url);
  const commentCount = (mood as any).comments?.length || 0;

  const toggleMusicPreview = async () => {
    if (!mood.music?.preview_url) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      if (musicPlaying && musicRef.current) {
        await musicRef.current.pauseAsync();
        setMusicPlaying(false);
        return;
      }
      if (!musicRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri: mood.music.preview_url },
          { shouldPlay: false, volume: 0.9 },
        );
        musicRef.current = sound;
        sound.setOnPlaybackStatusUpdate((s: any) => {
          if (s.didJustFinish) {
            setMusicPlaying(false);
            sound.setPositionAsync(0).catch(() => {});
          }
        });
      }
      await musicRef.current.playAsync();
      setMusicPlaying(true);
    } catch (e: any) {
      setMusicPlaying(false);
      console.warn("[MoodCard music]", e?.message || e);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) { soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      if (musicRef.current) { musicRef.current.unloadAsync().catch(() => {}); musicRef.current = null; }
    };
  }, []);

  const toggleAudio = async () => {
    if (!hasAudio) return;
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      // Reset audio mode to playback mode — critical on iOS so sound routes
      // to speaker (not earpiece) if user recorded earlier in the session.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      let audioSource: string | null = cachedAudio ? cachedAudio : (mood.audio_url || null);
      if (!audioSource) {
        setLoadingAudio(true);
        const r = await api<{ audio_b64?: string; audio_url?: string }>(`/moods/${mood.mood_id}/audio`);
        audioSource = r.audio_url ? r.audio_url : (r.audio_b64 ? `data:audio/m4a;base64,${r.audio_b64}` : null);
        setCachedAudio(audioSource);
        setLoadingAudio(false);
      } else if (!audioSource.startsWith("http") && !audioSource.startsWith("data:")) {
        audioSource = `data:audio/m4a;base64,${audioSource}`;
      }
      if (!soundRef.current && audioSource) {
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioSource },
          { shouldPlay: false, volume: 1.0 },
        );
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((s: any) => {
          if (s.didJustFinish) {
            setPlaying(false);
            sound.setPositionAsync(0).catch(() => {});
          }
        });
      }
      if (!soundRef.current) return;
      await soundRef.current.playAsync();
      setPlaying(true);
    } catch (e: any) {
      setLoadingAudio(false);
      setPlaying(false);
      // Surface clear error instead of silently failing
      console.warn("[MoodCard audio]", e?.message || e);
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
            <View style={[styles.avatar, { backgroundColor: mood.author_color || em.hex, overflow: "hidden", borderColor: em.hex + "88" }]}>
              {mood.author_avatar_url ? (
                <Image source={{ uri: mood.author_avatar_url }} style={{ width: 40, height: 40 }} />
              ) : mood.author_avatar_b64 ? (
                <Image source={{ uri: `data:image/jpeg;base64,${mood.author_avatar_b64}` }} style={{ width: 40, height: 40 }} />
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
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => mood.music?.preview_url && toggleMusicPreview()}
          style={[styles.musicBanner, { borderColor: em.hex + "80" }]}
          testID={`music-banner-${mood.mood_id}`}
        >
          {mood.music.artwork_url ? (
            <Image source={{ uri: mood.music.artwork_url }} style={styles.musicArt} />
          ) : (
            <View style={[styles.musicArt, { backgroundColor: em.hex, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="musical-notes" size={18} color="#000" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.musicBannerName} numberOfLines={1}>{mood.music.name}</Text>
            {mood.music.artist ? (
              <Text style={styles.musicBannerArtist} numberOfLines={1}>{mood.music.artist}</Text>
            ) : null}
          </View>
          {mood.music.preview_url ? (
            <View style={[styles.musicBannerPlay, { backgroundColor: em.hex }]}>
              <Ionicons name={musicPlaying ? "pause" : "play"} size={14} color="#000" />
            </View>
          ) : null}
        </TouchableOpacity>
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

      {mood.video_url ? (
        <LoopingVideo uri={mood.video_url} />
      ) : mood.video_b64 ? (
        <LoopingVideo b64={mood.video_b64} />
      ) : mood.photo_url ? (
        <Image source={{ uri: mood.photo_url }} style={styles.photo} />
      ) : mood.photo_b64 ? (
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
              style={[
                styles.actionBtn,
                {
                  backgroundColor: em.hex + "18",
                  borderColor: em.hex + "66",
                  shadowColor: em.hex,
                  shadowOpacity: 0.35,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 3,
                },
              ]}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-ellipses" size={15} color={em.hex} />
              <Text style={[styles.actionLabel, { color: em.hex }]}>
                Comment{commentCount > 0 ? ` · ${commentCount}` : ""}
              </Text>
            </TouchableOpacity>
            {onMessage ? (
              <TouchableOpacity
                testID={`message-${mood.mood_id}`}
                onPress={onMessage}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: em.hex + "18",
                    borderColor: em.hex + "66",
                    shadowColor: em.hex,
                    shadowOpacity: 0.35,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 3,
                  },
                ]}
                activeOpacity={0.8}
              >
                <Ionicons name="paper-plane" size={15} color={em.hex} />
                <Text style={[styles.actionLabel, { color: em.hex }]}>Message</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {mood.reactions && mood.reactions.length > 0 ? (
            <View style={styles.reactBreakdownRow}>
              {(() => {
                const counts: Record<string, number> = {};
                for (const r of mood.reactions) {
                  counts[r.emoji] = (counts[r.emoji] || 0) + 1;
                }
                return REACTIONS
                  .filter((r) => counts[r.key])
                  .map((r) => (
                    <View key={r.key} style={[styles.reactCountChip, { borderColor: em.hex + "55" }]}>
                      <Ionicons name={r.icon as any} size={12} color={em.hex} />
                      <Text style={styles.reactCountChipTxt}>{counts[r.key]}</Text>
                    </View>
                  ));
              })()}
              <Text style={styles.reactSummaryTxt} numberOfLines={1}>
                {mood.reactions.slice(0, 3).map((r: any) => r.name).filter(Boolean).join(", ")}
                {mood.reactions.length > 3 ? ` +${mood.reactions.length - 3}` : ""}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <CommentsSheet visible={commentsOpen} moodId={mood.mood_id} emotion={mood.emotion} onClose={() => setCommentsOpen(false)} />
    </View>
  );
}

/**
 * Short looping video attached to an aura. Uses expo-video for efficient playback.
 *
 * Reliability fixes:
 *   · Re-arms `play()` on every `playerStatus` event — sometimes the player loads but
 *     stays paused on iOS when the screen is initially offscreen or the source is slow.
 *   · Re-plays on app focus / on visibility change so the video resumes after the user
 *     leaves and comes back to the home tab.
 *   · Shows a thin loading shimmer until `playerStatus === 'readyToPlay'`.
 *   · Skips empty source defensively (avoids crash on `useVideoPlayer("")`).
 */
function LoopingVideo({ b64, uri }: { b64?: string; uri?: string }) {
  const source = uri || (b64 ? `data:video/mp4;base64,${b64}` : "");
  const [ready, setReady] = useState(false);

  const player = useVideoPlayer(source || null, (p) => {
    if (!p) return;
    try {
      p.loop = true;
      p.muted = true;
      p.timeUpdateEventInterval = 0;
      p.play();
    } catch {}
  });

  // Listen for status changes and re-arm play() when the player becomes ready.
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener("statusChange", ({ status }: any) => {
      if (status === "readyToPlay") {
        setReady(true);
        try { player.play(); } catch {}
      }
    });
    // Best-effort kick the player if it's already ready when listener attaches.
    const kick = setTimeout(() => {
      try {
        if (player.status === "readyToPlay") {
          setReady(true);
          player.play();
        }
      } catch {}
    }, 200);
    return () => {
      try { sub?.remove?.(); } catch {}
      clearTimeout(kick);
    };
  }, [player]);

  // Re-play when app regains focus (Home tab navigation, app foreground)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && player) {
        try { player.play(); } catch {}
      }
    });
    return () => {
      try { sub?.remove?.(); } catch {}
    };
  }, [player]);

  if (!source) return null;
  return (
    <View style={styles.photo}>
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
      {!ready ? (
        <View style={styles.videoLoader} pointerEvents="none">
          <ActivityIndicator color="rgba(255,255,255,0.7)" />
        </View>
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({  card: {
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
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  avatarTxt: { color: "#000", fontWeight: "700", fontSize: 16 },
  authorName: { color: COLORS.textPrimary, fontWeight: "600", fontSize: 14 },
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
  photo: { width: "100%", height: 180, borderRadius: 18, marginTop: 14, backgroundColor: "rgba(255,255,255,0.04)", overflow: "hidden" },
  videoLoader: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  noteText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 12, fontStyle: "italic" },
  audioRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, padding: 10, borderRadius: 16, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.04)" },
  audioBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  audioWaves: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", height: 34 },
  audioLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600" },
  musicPill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, backgroundColor: "rgba(0,0,0,0.25)", marginTop: 6, marginBottom: 4 },
  musicPillTxt: { color: "#fff", fontSize: 11, fontWeight: "600" },
  musicBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.05)", marginTop: 8, marginBottom: 4 },
  musicArt: { width: 40, height: 40, borderRadius: 8 },
  musicBannerName: { color: "#fff", fontSize: 13, fontWeight: "700" },
  musicBannerArtist: { color: "rgba(255,255,255,0.65)", fontSize: 11, marginTop: 2 },
  musicBannerPlay: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },

  reactWrap: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  sectionLabel: { color: COLORS.textTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  // 2 lignes × 4 réactions : flexBasis ~23% garantit 4 colonnes quel que soit l'écran.
  reactRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 6, rowGap: 6 },
  reactBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: COLORS.border,
    flexBasis: "23.5%",
    flexGrow: 1,
    minWidth: 0,
  },
  reactLabel: { color: "#fff", fontSize: 11, fontWeight: "600", flexShrink: 1 },

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
  reactBreakdownRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 10 },
  reactCountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
  },
  reactCountChipTxt: { color: "#fff", fontSize: 11, fontWeight: "700" },
  reactSummaryTxt: { color: COLORS.textTertiary, fontSize: 11, marginLeft: 4, flex: 1 },
});
