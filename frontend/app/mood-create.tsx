import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import Slider from "@react-native-community/slider";
import RadialAura from "../src/components/RadialAura";
import Button from "../src/components/Button";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { EMOTION_COLORS, COLORS } from "../src/theme";
import { t } from "../src/i18n";
import { Ionicons } from "@expo/vector-icons";

const MAX_AUDIO_SECONDS = 10;

export default function MoodCreate() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const pro = !!user?.pro;

  const [emotion, setEmotion] = useState<string>("joy");
  const [word, setWord] = useState("");
  const [intensity, setIntensity] = useState(3);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<"friends" | "close" | "private">("friends");
  const [loading, setLoading] = useState(false);

  // Audio recording state (Pro)
  const [audioB64, setAudioB64] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<any>(null);

  // Music track (Pro)
  const [tracks, setTracks] = useState<any[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const musicSoundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (!pro) return;
    api<{ tracks: any[] }>("/music/tracks").then((r) => setTracks(r.tracks)).catch(() => {});
  }, [pro]);

  const toggleTrackPreview = async (track: any) => {
    try {
      if (musicSoundRef.current) { await musicSoundRef.current.unloadAsync().catch(() => {}); musicSoundRef.current = null; }
      if (previewingId === track.id) { setPreviewingId(null); return; }
      const { sound } = await Audio.Sound.createAsync({ uri: track.url });
      musicSoundRef.current = sound;
      setPreviewingId(track.id);
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) setPreviewingId(null); });
      await sound.playAsync();
    } catch { setPreviewingId(null); }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (soundRef.current) { soundRef.current.unloadAsync().catch(() => {}); }
      if (musicSoundRef.current) { musicSoundRef.current.unloadAsync().catch(() => {}); }
    };
  }, []);

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
      setAudioB64(null);
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
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        setAudioB64(b64);
      }
    } catch {}
    setRecording(null);
  };

  const playPreview = async () => {
    if (!audioB64) return;
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null; }
      const { sound } = await Audio.Sound.createAsync({ uri: `data:audio/m4a;base64,${audioB64}` });
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) { setPlaying(false); } });
      await sound.playAsync();
    } catch (e: any) {
      Alert.alert("Playback failed", e.message || "");
      setPlaying(false);
    }
  };

  const clearAudio = async () => {
    if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
    setAudioB64(null); setRecSeconds(0); setPlaying(false);
  };

  const maxIntensity = pro ? 10 : 5;
  const auraColor = EMOTION_COLORS[emotion]?.hex || "#A78BFA";

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "We need photo access to attach images."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6, base64: true });
    if (!r.canceled && r.assets[0]?.base64) setPhoto(r.assets[0].base64);
  };

  const submit = async () => {
    if (!word.trim()) { Alert.alert("Add a word", "Describe your mood in one word."); return; }
    setLoading(true);
    try {
      await api("/moods", {
        method: "POST",
        body: {
          word: word.trim(), emotion,
          intensity: Math.max(1, Math.min(maxIntensity, intensity)),
          photo_b64: photo, text: pro ? note || null : null,
          audio_b64: pro ? audioB64 : null,
          audio_seconds: pro && audioB64 ? Math.max(1, recSeconds) : null,
          music_track_id: pro ? selectedTrackId : null,
          privacy,
        },
      });
      await refresh();
      router.replace("/(tabs)/home");
    } catch (e: any) {
      Alert.alert("Oops", e.message || "Could not post your mood");
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.container} testID="mood-create-screen">
      <RadialAura color={auraColor} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.headerRow}>
            <TouchableOpacity testID="close-create" onPress={() => router.back()} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.hdr}>Drop your mood</Text>
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

            <Text style={styles.section}>{t("create.word")}</Text>
            <TextInput
              testID="mood-word"
              value={word} onChangeText={setWord}
              style={styles.wordInput}
              placeholder="luminous, heavy, alive…"
              placeholderTextColor="#555" maxLength={30}
            />

            <Text style={styles.section}>{t("create.intensity")} · {intensity}/{maxIntensity}</Text>
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

            <Text style={styles.section}>{t("create.photo")}</Text>
            <TouchableOpacity testID="mood-add-photo" onPress={pick} style={styles.photoBox}>
              {photo ? (
                <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photoPrev} />
              ) : (
                <View style={styles.photoEmpty}>
                  <Ionicons name="image-outline" size={22} color={COLORS.textSecondary} />
                  <Text style={styles.photoTxt}>Add a photo</Text>
                </View>
              )}
            </TouchableOpacity>

            {pro ? (
              <>
                <Text style={styles.section}>{t("create.text")}</Text>
                <TextInput
                  testID="mood-note"
                  value={note} onChangeText={setNote}
                  style={styles.note} multiline maxLength={280}
                  placeholder="A sentence about how you feel…" placeholderTextColor="#555"
                />

                <Text style={styles.section}>{t("create.audio")} · {MAX_AUDIO_SECONDS}s</Text>
                <View style={[styles.audioCard, { borderColor: auraColor + "80" }]}>
                  {!audioB64 ? (
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
                      <Text style={styles.audioDur}>{recSeconds || MAX_AUDIO_SECONDS}s</Text>
                      <TouchableOpacity testID="mood-clear-audio" onPress={clearAudio} style={styles.clearBtn}>
                        <Ionicons name="close" size={16} color={COLORS.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <Text style={styles.section}>Background music · Pro ✦</Text>
                <View style={styles.musicList}>
                  {tracks.length === 0 ? (
                    <Text style={styles.musicEmpty}>Loading tracks…</Text>
                  ) : (
                    tracks.map((tr) => {
                      const sel = selectedTrackId === tr.id;
                      const prv = previewingId === tr.id;
                      return (
                        <View
                          key={tr.id}
                          testID={`music-track-${tr.id}`}
                          style={[styles.musicRow, sel && { borderColor: auraColor, backgroundColor: auraColor + "1A" }]}
                        >
                          <TouchableOpacity
                            testID={`music-preview-${tr.id}`}
                            onPress={() => toggleTrackPreview(tr)}
                            style={[styles.musicPlay, { backgroundColor: auraColor }]}
                          >
                            <Ionicons name={prv ? "pause" : "play"} size={14} color="#000" />
                          </TouchableOpacity>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.musicName}>{tr.name}</Text>
                            <Text style={styles.musicVibe}>{tr.vibe}</Text>
                          </View>
                          <TouchableOpacity
                            testID={`music-select-${tr.id}`}
                            onPress={() => setSelectedTrackId(sel ? null : tr.id)}
                            style={[styles.musicSel, sel && { backgroundColor: auraColor, borderColor: auraColor }]}
                          >
                            {sel ? <Ionicons name="checkmark" size={14} color="#000" /> : <Text style={styles.musicSelTxt}>Select</Text>}
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
              {(["friends", "close", "private"] as const).map((p) => (
                <TouchableOpacity
                  key={p} testID={`privacy-${p}`}
                  onPress={() => { if (p === "close" && !pro) { Alert.alert("Pro feature", "Close friends is a Pro feature."); return; } setPrivacy(p); }}
                  style={[styles.privChip, privacy === p && styles.privChipActive]}
                >
                  <Text style={[styles.privTxt, privacy === p && { color: "#fff" }]}>
                    {p === "friends" ? t("create.privacy.friends") : p === "close" ? t("create.privacy.close") : t("create.privacy.private")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 22 }}>
              <Button testID="mood-submit" label={t("create.post")} onPress={submit} loading={loading} />
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
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
  musicEmpty: { color: COLORS.textTertiary, fontSize: 12, padding: 10 },
  musicRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  musicPlay: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  musicName: { color: "#fff", fontWeight: "600", fontSize: 14 },
  musicVibe: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  musicSel: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  musicSelTxt: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600" },
  privacyRow: { flexDirection: "row", gap: 8 },
  privChip: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center" },
  privChipActive: { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "#fff" },
  privTxt: { color: COLORS.textSecondary, fontWeight: "600", fontSize: 12 },
});
