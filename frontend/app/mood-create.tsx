import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import Slider from "@react-native-community/slider";
import RadialAura from "../src/components/RadialAura";
import Button from "../src/components/Button";
import WellnessSheet from "../src/components/WellnessSheet";
import { useShareToStories } from "../src/components/ShareToStories";
import ProBadge from "../src/components/ProBadge";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { EMOTION_COLORS, COLORS } from "../src/theme";
import { t } from "../src/i18n";
import { uploadMedia } from "../src/media";
import { Ionicons } from "@expo/vector-icons";

const MAX_AUDIO_SECONDS = 10;

export default function MoodCreate() {
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string }>();
  const isEdit = params.edit === "1";
  const { user, refresh } = useAuth();
  const pro = !!user?.pro;

  const [emotion, setEmotion] = useState<string>("joy");
  const [word, setWord] = useState("");
  const [intensity, setIntensity] = useState(3);
  const [note, setNote] = useState("");
  // Photo / video: keep local preview URI + uploaded R2 key (preferred). photoB64 is a fallback for legacy clients
  const [photo, setPhoto] = useState<{ uri: string; key?: string } | null>(null);
  const [video, setVideo] = useState<{ uri: string; key?: string; seconds: number } | null>(null);
  const [privacy, setPrivacy] = useState<"friends" | "close" | "private">("friends");
  const [loading, setLoading] = useState(false);
  // Upload-in-progress flags — block submit and show progress UI until finished.
  // Without these, the user could tap Save while a fresh video is still uploading,
  // and we'd ship the OLD R2 key from `video.key` (the previous aura's media) — that
  // bug was reported by users seeing old videos persist after editing.
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);

  // Audio recording state (Pro) — local URI of the recording
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [audioKey, setAudioKey] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<any>(null);

  // Music track (Pro) — iTunes search
  const [musicQuery, setMusicQuery] = useState("");
  const [musicResults, setMusicResults] = useState<any[]>([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [selectedMusic, setSelectedMusic] = useState<any | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const musicSoundRef = useRef<Audio.Sound | null>(null);
  const searchTimer = useRef<any>(null);

  // Wellness sheet shown after successful drop
  const [wellness, setWellness] = useState<any>(null);
  const { share, Renderer: ShareRenderer } = useShareToStories();

  const runMusicSearch = async (q: string) => {
    if (!pro) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) { setMusicResults([]); return; }
    setMusicLoading(true);
    try {
      const r = await api<{ tracks: any[] }>(`/music/search?q=${encodeURIComponent(trimmed)}`);
      setMusicResults(r.tracks || []);
    } catch { setMusicResults([]); }
    finally { setMusicLoading(false); }
  };

  // Debounced search as user types
  useEffect(() => {
    if (!pro) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runMusicSearch(musicQuery), 450);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [musicQuery, pro]);

  const toggleTrackPreview = async (track: any) => {
    try {
      // Reset audio mode to playback mode (important on iOS after recording)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      if (musicSoundRef.current) { await musicSoundRef.current.unloadAsync().catch(() => {}); musicSoundRef.current = null; }
      if (previewingId === track.track_id) { setPreviewingId(null); return; }
      const { sound } = await Audio.Sound.createAsync({ uri: track.preview_url }, { shouldPlay: true });
      musicSoundRef.current = sound;
      setPreviewingId(track.track_id);
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) setPreviewingId(null); });
    } catch (e: any) {
      setPreviewingId(null);
      Alert.alert("Preview failed", e.message || "Could not play preview");
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (soundRef.current) { soundRef.current.unloadAsync().catch(() => {}); }
      if (musicSoundRef.current) { musicSoundRef.current.unloadAsync().catch(() => {}); }
    };
  }, []);

  // Edit mode: prefill the form with today's existing aura when ?edit=1
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const r = await api<{ mood: any }>("/moods/today");
        const m = r?.mood;
        if (!m) return;
        if (m.emotion) setEmotion(m.emotion);
        if (typeof m.intensity === "number") setIntensity(m.intensity);
        if (m.word) setWord(m.word);
        if (m.text) setNote(m.text);
        if (m.privacy) setPrivacy(m.privacy);
        if (m.photo_url) setPhoto({ uri: m.photo_url, key: m.photo_key });
        if (m.video_url && m.video_seconds) setVideo({ uri: m.video_url, key: m.video_key, seconds: m.video_seconds });
        if (m.audio_url) {
          setAudioUri(m.audio_url);
          setAudioKey(m.audio_key);
          if (m.audio_seconds) setRecSeconds(m.audio_seconds);
        }
        if (m.music) setSelectedMusic(m.music);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert("Microphone permission", "We need mic access to record a voice note."); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setIsRecording(true);
      setRecSeconds(0);
      setAudioUri(null);
      setAudioKey(null);
      timerRef.current = setInterval(() => {
        setRecSeconds((s) => {
          if (s + 1 >= MAX_AUDIO_SECONDS) { stopRecording(rec); return MAX_AUDIO_SECONDS; }
          return s + 1;
        });
      }, 1000);
    } catch (e: any) {
      Alert.alert("Recording failed", e.message || "Try again.");
    }
  };

  const stopRecording = async (recArg?: Audio.Recording) => {
    const rec = recArg || recording;
    if (!rec) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (uri) {
        // Local URI now available — but the R2 key isn't ready yet. Show the local
        // playback control immediately and flag the upload as in-progress so the
        // Save button is disabled until we have the new key (otherwise we'd ship
        // the previous aura's audio_key on a quick Save).
        setAudioUri(uri);
        setAudioKey(null);
        setUploadingAudio(true);
        try {
          const key = await uploadMedia("mood_audio", uri, "audio/m4a", { compress: false });
          setAudioKey(key);
        } catch (e: any) {
          // Fallback: keep URI for local playback but flag audioKey as null so submit sends b64
          console.warn("Audio upload failed, will fallback to base64", e?.message);
        } finally {
          setUploadingAudio(false);
        }
      }
      // Reset audio mode so subsequent playback routes to speaker (not earpiece) on iOS
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
    } catch {}
    setRecording(null);
  };

  const playPreview = async () => {
    if (!audioUri) return;
    try {
      // Reset audio mode to playback mode (important on iOS after recording)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null; }
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true, volume: 1.0 },
      );
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) { setPlaying(false); } });
    } catch (e: any) {
      Alert.alert("Playback failed", e.message || "");
      setPlaying(false);
    }
  };

  const clearAudio = async () => {
    if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
    setAudioUri(null); setAudioKey(null); setRecSeconds(0); setPlaying(false);
  };

  const maxIntensity = pro ? 10 : 5;
  const auraColor = EMOTION_COLORS[emotion]?.hex || "#A78BFA";

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "We need photo access to attach images."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!r.canceled && r.assets[0]?.uri) {
      // CRITICAL: clear the previous photo/video keys IMMEDIATELY so that if the user
      // taps Save before the upload finishes, we don't ship the stale R2 key.
      // We keep the local URI for preview but null out the key while uploading.
      const localUri = r.assets[0].uri;
      setPhoto({ uri: localUri, key: undefined });
      setVideo(null);
      setUploadingPhoto(true);
      try {
        const key = await uploadMedia("mood_photo", localUri, "image/jpeg");
        setPhoto({ uri: localUri, key });
      } catch (e: any) {
        Alert.alert("Upload failed", e?.message || "Try again.");
        setPhoto(null);
      } finally {
        setUploadingPhoto(false);
      }
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "We need camera access to take photos."); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!r.canceled && r.assets[0]?.uri) {
      const localUri = r.assets[0].uri;
      setPhoto({ uri: localUri, key: undefined });
      setVideo(null);
      setUploadingPhoto(true);
      try {
        const key = await uploadMedia("mood_photo", localUri, "image/jpeg");
        setPhoto({ uri: localUri, key });
      } catch (e: any) {
        Alert.alert("Upload failed", e?.message || "Try again.");
        setPhoto(null);
      } finally {
        setUploadingPhoto(false);
      }
    }
  };

  // Video: up to 10s looping. Pro-only.
  const pickVideoFromLibrary = async () => {
    if (!pro) { Alert.alert("Pro feature", "Video auras are a Pro feature."); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "We need library access to attach videos."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.6,
      videoMaxDuration: 10,
    });
    if (r.canceled || !r.assets[0]?.uri) return;
    const a = r.assets[0];
    const dur = Math.min(10, Math.max(1, Math.round((a.duration || 10000) / 1000)));
    // Same race-condition fix as photo: drop old key & old photo immediately so a Save
    // mid-upload doesn't reuse the previous aura's video. Visual placeholder shows the
    // upload progress until the new R2 key is in state.
    setVideo({ uri: a.uri, key: undefined, seconds: dur });
    setPhoto(null);
    setUploadingVideo(true);
    try {
      const key = await uploadMedia("mood_video", a.uri, "video/mp4", { compress: false, ext: "mp4" });
      setVideo({ uri: a.uri, key, seconds: dur });
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message || "Try again.");
      setVideo(null);
    } finally {
      setUploadingVideo(false);
    }
  };

  const recordVideo = async () => {
    if (!pro) { Alert.alert("Pro feature", "Video auras are a Pro feature."); return; }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "We need camera access to record videos."); return; }
    const r = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.6,
      videoMaxDuration: 10,
    });
    if (r.canceled || !r.assets[0]?.uri) return;
    const a = r.assets[0];
    const dur = Math.min(10, Math.max(1, Math.round((a.duration || 10000) / 1000)));
    setVideo({ uri: a.uri, key: undefined, seconds: dur });
    setPhoto(null);
    setUploadingVideo(true);
    try {
      const key = await uploadMedia("mood_video", a.uri, "video/mp4", { compress: false, ext: "mp4" });
      setVideo({ uri: a.uri, key, seconds: dur });
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message || "Try again.");
      setVideo(null);
    } finally {
      setUploadingVideo(false);
    }
  };

  const pick = () => {
    const proSuffix = pro ? "" : " 🔒";
    const buttons: any[] = [
      { text: "Take photo", onPress: takePhoto },
      { text: "Pick photo", onPress: pickFromLibrary },
      {
        text: `Record video (10s · Pro${proSuffix})`,
        onPress: () => {
          if (!pro) {
            Alert.alert(
              "Video is a Pro feature ✦",
              "Upgrade to Pro to share looping video auras.",
              [{ text: "Maybe later", style: "cancel" }, { text: "See Pro", onPress: () => router.push("/paywall") }],
            );
            return;
          }
          recordVideo();
        },
      },
      {
        text: `Pick video (10s · Pro${proSuffix})`,
        onPress: () => {
          if (!pro) {
            Alert.alert(
              "Video is a Pro feature ✦",
              "Upgrade to Pro to share looping video auras.",
              [{ text: "Maybe later", style: "cancel" }, { text: "See Pro", onPress: () => router.push("/paywall") }],
            );
            return;
          }
          pickVideoFromLibrary();
        },
      },
      { text: "Cancel", style: "cancel" },
    ];
    Alert.alert("Add media", pro ? "Photo or 10s looping video." : "Photo (Pro: 10s looping video)", buttons);
  };

  const submit = async () => {
    // Block submit if any media upload is still in progress — otherwise we'd ship
    // the previous aura's R2 keys (the reported "old video stays after edit" bug).
    if (uploadingPhoto || uploadingVideo || uploadingAudio) {
      Alert.alert(
        "Upload in progress",
        "Your media is still uploading. Wait a moment and try again.",
      );
      return;
    }
    // Defensive: if the user picked a video/photo/audio but the key never landed
    // (e.g. silent upload error), don't ship a half-baked payload.
    if (video && !video.key) {
      Alert.alert("Video not ready", "Please re-pick the video.");
      return;
    }
    if (photo && !photo.key) {
      Alert.alert("Photo not ready", "Please re-pick the photo.");
      return;
    }
    // word is optional — emotion selection is enough
    setLoading(true);
    try {
      await api("/moods", {
        method: "POST",
        body: {
          word: word.trim() || null, emotion,
          intensity: Math.max(1, Math.min(maxIntensity, intensity)),
          photo_key: photo?.key || null,
          video_key: video?.key || null,
          video_seconds: video?.seconds || null,
          text: pro ? note || null : null,
          audio_key: pro ? audioKey : null,
          audio_seconds: pro && audioUri ? Math.max(1, recSeconds) : null,
          music: pro && selectedMusic ? {
            track_id: selectedMusic.track_id,
            name: selectedMusic.name,
            artist: selectedMusic.artist,
            artwork_url: selectedMusic.artwork_url,
            preview_url: selectedMusic.preview_url,
            source: selectedMusic.source || "apple",
          } : null,
          privacy,
          // B4 — Smart Reminders: send the user's current local hour so the backend
          // can learn their typical posting pattern and personalize the daily reminder.
          local_hour: new Date().getHours(),
        },
      });
      await refresh();
      // User posted — no need for the evening safety-net reminder today.
      try { const n = await import("../src/notifications"); await n.cancelEveningReminder(); } catch {}
      // Re-schedule tomorrow's reminder against the freshly-updated smart hour.
      try { const n = await import("../src/notifications"); await n.refreshSmartReminder(); } catch {}
      // Fetch wellness quote+advice for the chosen emotion and show the sheet
      try {
        const w = await api<any>(`/wellness/${emotion}`);
        setWellness(w);
      } catch {
        router.replace("/(tabs)/home");
      }
    } catch (e: any) {
      Alert.alert("Oops", e.message || "Could not share your aura");
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.container} testID="mood-create-screen">
      <RadialAura color={auraColor} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.headerRow}>
            <TouchableOpacity testID="close-create" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/home"); }} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.hdr}>Share your aura</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>{t("create.pickEmotion")}</Text>
            <View style={styles.emotionsWrap}>
              {Object.entries(EMOTION_COLORS).map(([key, meta]) => {
                const sel = key === emotion;
                return (
                  <TouchableOpacity
                    key={key} testID={`emotion-${key}`}
                    onPress={() => setEmotion(key)}
                    style={[styles.emotionChip, sel && { borderColor: meta.hex, backgroundColor: meta.hex + "22" }]}
                  >
                    <View style={[styles.emotionDot, { backgroundColor: meta.hex }]} />
                    <Text style={[styles.emotionName, sel && { color: "#fff", fontWeight: "700" }]}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.section}>{t("create.word")} · optional</Text>
            <TextInput
              testID="mood-word"
              value={word} onChangeText={setWord}
              style={styles.wordInput}
              placeholder="luminous, heavy, alive…"
              placeholderTextColor="#555" maxLength={30}
            />

            <View style={styles.sectionRow}>
              <Text style={styles.section}>{t("create.intensity")} · {intensity}/{maxIntensity}</Text>
              {!pro && <ProBadge />}
            </View>
            <View style={styles.sliderBox}>
              <Slider
                testID="mood-intensity"
                minimumValue={1} maximumValue={maxIntensity} step={1}
                value={intensity} onValueChange={setIntensity}
                minimumTrackTintColor={auraColor} maximumTrackTintColor="rgba(255,255,255,0.15)"
                thumbTintColor="#fff"
              />
              {!pro ? <Text style={styles.proHint}>Pro unlocks 1–10 intensity</Text> : null}
            </View>

            <View style={styles.sectionRow}>
              <Text style={styles.section}>Photo or Video</Text>
              <View style={styles.proInlineTag}>
                <Ionicons name="sparkles" size={11} color="#FDE047" />
                <Text style={styles.proInlineTxt}>Video is Pro</Text>
              </View>
            </View>
            <TouchableOpacity testID="mood-add-photo" onPress={pick} style={styles.photoBox} disabled={uploadingPhoto || uploadingVideo}>
              {photo ? (
                <View>
                  <Image source={{ uri: photo.uri }} style={styles.photoPrev} />
                  {uploadingPhoto ? (
                    <View style={styles.uploadOverlay}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.uploadOverlayTxt}>Uploading photo…</Text>
                    </View>
                  ) : null}
                </View>
              ) : video ? (
                <View style={[styles.photoPrev, { backgroundColor: "#111", alignItems: "center", justifyContent: "center", gap: 8 }]}>
                  {uploadingVideo ? (
                    <>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={{ color: "#fff", fontWeight: "600" }}>Uploading video…</Text>
                      <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>Don't tap Save just yet ✦</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="videocam" size={28} color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "600" }}>Video · {video.seconds}s · loops</Text>
                      <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>Tap to change</Text>
                    </>
                  )}
                </View>
              ) : (
                <View style={styles.photoEmpty}>
                  <Ionicons name="image-outline" size={22} color={COLORS.textSecondary} />
                  <Text style={styles.photoTxt}>
                    {pro ? "Add a photo or a 10s video" : "Add a photo (video is a Pro feature)"}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {pro ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.section}>{t("create.text")}</Text>
                  <ProBadge />
                </View>
                <TextInput
                  testID="mood-note"
                  value={note} onChangeText={setNote}
                  style={styles.note} multiline maxLength={280}
                  placeholder="A sentence about how you feel…" placeholderTextColor="#555"
                />

                <View style={styles.sectionRow}>
                  <Text style={styles.section}>{t("create.audio")} · {MAX_AUDIO_SECONDS}s</Text>
                  <ProBadge />
                </View>
                <View style={[styles.audioCard, { borderColor: auraColor + "80" }]}>
                  {!audioUri ? (
                    <TouchableOpacity
                      testID={isRecording ? "mood-stop-audio" : "mood-record-audio"}
                      onPress={() => (isRecording ? stopRecording() : startRecording())}
                      activeOpacity={0.8}
                      style={[styles.recBtn, { backgroundColor: isRecording ? "#EF4444" : auraColor }]}
                    >
                      <Ionicons name={isRecording ? "stop" : "mic"} size={22} color="#000" />
                      <Text style={styles.recTxt}>
                        {isRecording ? `Recording… ${recSeconds}s / ${MAX_AUDIO_SECONDS}s` : "Tap to record"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.audioReadyRow}>
                      <TouchableOpacity
                        testID="mood-play-audio"
                        onPress={playPreview}
                        style={[styles.playBtn, { backgroundColor: auraColor }]}
                      >
                        <Ionicons name={playing ? "pause" : "play"} size={18} color="#000" />
                      </TouchableOpacity>
                      <View style={styles.waveformRow}>
                        {Array.from({ length: 18 }).map((_, i) => (
                          <View
                            key={i}
                            style={{
                              width: 3, borderRadius: 2, marginHorizontal: 2,
                              height: 4 + ((i * 7) % 22),
                              backgroundColor: auraColor, opacity: 0.6 + ((i % 3) * 0.15),
                            }}
                          />
                        ))}
                      </View>
                      {uploadingAudio ? (
                        <View style={styles.audioUploadInline}>
                          <ActivityIndicator color={auraColor} size="small" />
                          <Text style={styles.audioUploadTxt}>Uploading…</Text>
                        </View>
                      ) : (
                        <Text style={styles.audioDur}>{recSeconds || MAX_AUDIO_SECONDS}s</Text>
                      )}
                      <TouchableOpacity testID="mood-clear-audio" onPress={clearAudio} style={styles.clearBtn}>
                        <Ionicons name="close" size={16} color={COLORS.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View style={styles.sectionRow}>
                  <Text style={styles.section}>Background music</Text>
                  <ProBadge />
                </View>
                <View style={styles.musicSearchBox}>
                  <Ionicons name="search" size={16} color={COLORS.textTertiary} />
                  <TextInput
                    testID="music-search"
                    value={musicQuery}
                    onChangeText={setMusicQuery}
                    placeholder="Search music — title, artist…"
                    placeholderTextColor="#555"
                    style={styles.musicSearchInput}
                    autoCapitalize="none"
                    returnKeyType="search"
                    onSubmitEditing={() => runMusicSearch(musicQuery)}
                  />
                  {musicQuery ? (
                    <TouchableOpacity onPress={() => { setMusicQuery(""); setMusicResults([]); }}>
                      <Ionicons name="close-circle" size={16} color={COLORS.textTertiary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.musicSource}>30s preview</Text>

                {selectedMusic ? (
                  <View style={[styles.selectedMusic, { borderColor: auraColor }]}>
                    {selectedMusic.artwork_url ? (
                      <Image source={{ uri: selectedMusic.artwork_url }} style={styles.musicArt} />
                    ) : (
                      <View style={[styles.musicArt, { backgroundColor: auraColor, alignItems: "center", justifyContent: "center" }]}>
                        <Ionicons name="musical-notes" size={20} color="#000" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.musicName} numberOfLines={1}>{selectedMusic.name}</Text>
                      <Text style={styles.musicVibe} numberOfLines={1}>{selectedMusic.artist}</Text>
                    </View>
                    <TouchableOpacity
                      testID="music-preview-selected"
                      onPress={() => toggleTrackPreview(selectedMusic)}
                      style={[styles.musicPlay, { backgroundColor: auraColor }]}
                    >
                      <Ionicons name={previewingId === selectedMusic.track_id ? "pause" : "play"} size={14} color="#000" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setSelectedMusic(null)} style={styles.clearBtn} testID="music-clear-selected">
                      <Ionicons name="close" size={16} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View style={styles.musicList}>
                  {musicLoading ? (
                    <Text style={styles.musicEmpty}>Searching…</Text>
                  ) : musicQuery.trim().length < 2 ? (
                    <Text style={styles.musicEmpty}>Type to search tracks ✦</Text>
                  ) : musicResults.length === 0 ? (
                    <Text style={styles.musicEmpty}>No results. Try another title or artist.</Text>
                  ) : (
                    musicResults.slice(0, 8).map((tr) => {
                      const sel = selectedMusic?.track_id === tr.track_id;
                      const prv = previewingId === tr.track_id;
                      return (
                        <View
                          key={tr.track_id}
                          testID={`music-track-${tr.track_id}`}
                          style={[styles.musicRow, sel && { borderColor: auraColor, backgroundColor: auraColor + "1A" }]}
                        >
                          {tr.artwork_url ? (
                            <Image source={{ uri: tr.artwork_url }} style={styles.musicArt} />
                          ) : (
                            <View style={[styles.musicArt, { backgroundColor: auraColor + "55" }]} />
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={styles.musicName} numberOfLines={1}>{tr.name}</Text>
                            <Text style={styles.musicVibe} numberOfLines={1}>{tr.artist}</Text>
                          </View>
                          <TouchableOpacity
                            testID={`music-preview-${tr.track_id}`}
                            onPress={() => toggleTrackPreview(tr)}
                            style={[styles.musicPlay, { backgroundColor: auraColor }]}
                          >
                            <Ionicons name={prv ? "pause" : "play"} size={14} color="#000" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            testID={`music-select-${tr.track_id}`}
                            onPress={() => setSelectedMusic(sel ? null : tr)}
                            style={[styles.musicSel, sel && { backgroundColor: auraColor, borderColor: auraColor }]}
                          >
                            {sel ? <Ionicons name="checkmark" size={14} color="#000" /> : <Text style={styles.musicSelTxt}>Pick</Text>}
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </View>
              </>
            ) : (
              <View style={styles.proLock}>
                <Ionicons name="sparkles" size={14} color="#FACC15" />
                <Text style={styles.proLockTxt}>Text notes & voice notes come with Pro</Text>
              </View>
            )}

            <Text style={styles.section}>{t("create.privacy")}</Text>
            <View style={styles.privacyRow}>
              {(["friends", "close", "private"] as const).map((p) => {
                const closeLocked = p === "close" && !pro;
                return (
                  <TouchableOpacity
                    key={p} testID={`privacy-${p}`}
                    onPress={() => { if (closeLocked) { Alert.alert("Pro feature ✦", "Close friends is a Pro feature."); return; } setPrivacy(p); }}
                    style={[styles.privChip, privacy === p && styles.privChipActive]}
                  >
                    <Text style={[styles.privTxt, privacy === p && { color: "#fff" }]}>
                      {p === "friends" ? t("create.privacy.friends") : p === "close" ? t("create.privacy.close") : t("create.privacy.private")}
                    </Text>
                    {p === "close" ? (
                      <View style={styles.proBadgeSmall}>
                        <Ionicons name="sparkles" size={9} color="#FACC15" />
                        <Text style={styles.proBadgeSmallTxt}>Pro</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ marginTop: 22 }}>
              {(uploadingPhoto || uploadingVideo || uploadingAudio) ? (
                <View style={styles.uploadingBanner}>
                  <ActivityIndicator color="#FACC15" size="small" />
                  <Text style={styles.uploadingBannerTxt}>
                    {uploadingVideo ? "Uploading video — wait a sec ✦" :
                     uploadingPhoto ? "Uploading photo — wait a sec ✦" :
                     "Uploading audio — wait a sec ✦"}
                  </Text>
                </View>
              ) : null}
              <Button
                testID="mood-submit"
                label={t("create.post")}
                onPress={submit}
                loading={loading}
                disabled={uploadingPhoto || uploadingVideo || uploadingAudio}
              />
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
      <WellnessSheet
        visible={!!wellness}
        data={wellness}
        userName={user?.name}
        onClose={() => { setWellness(null); router.replace("/(tabs)/home"); }}
        onShare={() => share({ kind: "mood", word: word.trim(), emotion, intensity, userName: user?.name })}
      />
      <ShareRenderer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  hdr: { color: "#fff", fontSize: 16, fontWeight: "600" },
  scroll: { padding: 20, paddingTop: 4 },
  section: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 18, marginBottom: 10, fontWeight: "700" },
  emotionsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emotionChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.04)" },
  emotionDot: { width: 10, height: 10, borderRadius: 5 },
  emotionName: { color: COLORS.textSecondary, fontSize: 13 },
  wordInput: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16, color: "#fff", fontSize: 22, fontWeight: "600" },
  sliderBox: { backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  proHint: { color: COLORS.textTertiary, fontSize: 11, marginTop: 4 },
  photoBox: { minHeight: 120, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", overflow: "hidden" },
  photoPrev: { width: "100%", height: 180 },
  photoEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 },
  photoTxt: { color: COLORS.textSecondary },
  note: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 14, color: "#fff", minHeight: 80, textAlignVertical: "top" },
  proLock: { flexDirection: "row", alignItems: "center", gap: 6, padding: 12, borderRadius: 14, backgroundColor: "rgba(250,204,21,0.08)", borderWidth: 1, borderColor: "rgba(250,204,21,0.35)" },
  proLockTxt: { color: "#FACC15", fontSize: 12 },
  audioCard: { borderRadius: 18, borderWidth: 1, padding: 14, backgroundColor: "rgba(255,255,255,0.03)" },
  recBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 14 },
  recTxt: { color: "#000", fontWeight: "700" },
  audioReadyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  playBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  waveformRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", height: 40 },
  audioDur: { color: COLORS.textSecondary, fontSize: 12, width: 32, textAlign: "right" },
  clearBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },
  musicList: { gap: 8 },
  musicSearchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  musicSearchInput: { flex: 1, color: "#fff", fontSize: 14 },
  musicSource: { color: COLORS.textTertiary, fontSize: 10, marginBottom: 10, marginTop: 2, fontStyle: "italic" },
  selectedMusic: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.06)", marginBottom: 10 },
  musicArt: { width: 40, height: 40, borderRadius: 8 },
  musicEmpty: { color: COLORS.textTertiary, fontSize: 12, padding: 10 },
  musicRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  musicPlay: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  musicName: { color: "#fff", fontWeight: "600", fontSize: 13 },
  musicVibe: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  musicSel: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  musicSelTxt: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600" },
  privacyRow: { flexDirection: "row", gap: 8 },
  privChip: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center", gap: 4 },
  privChipActive: { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "#fff" },
  privTxt: { color: COLORS.textSecondary, fontWeight: "600", fontSize: 12 },
  proBadgeSmall: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(250,204,21,0.12)", borderWidth: 1, borderColor: "rgba(250,204,21,0.35)" },
  proBadgeSmallTxt: { color: "#FACC15", fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 10 },
  proInlineTag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999,
    backgroundColor: "rgba(253,224,71,0.10)",
    borderWidth: 1, borderColor: "rgba(253,224,71,0.35)",
  },
  proInlineTxt: { color: "#FDE047", fontSize: 10, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  // Upload progress visuals — used to give users clear feedback that an
  // upload is mid-flight so they don't tap Save with the previous aura's
  // R2 key still in state.
  uploadOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  uploadOverlayTxt: { color: "#fff", fontWeight: "600", fontSize: 13 },
  audioUploadInline: { flexDirection: "row", alignItems: "center", gap: 6 },
  audioUploadTxt: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600" },
  uploadingBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 10, marginBottom: 10, borderRadius: 14,
    backgroundColor: "rgba(250,204,21,0.10)",
    borderWidth: 1, borderColor: "rgba(250,204,21,0.35)",
  },
  uploadingBannerTxt: { color: "#FACC15", fontSize: 12, fontWeight: "600" },
});
