import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Slider from "@react-native-community/slider";
import RadialAura from "../src/components/RadialAura";
import Button from "../src/components/Button";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { EMOTION_COLORS, COLORS } from "../src/theme";
import { t } from "../src/i18n";
import { Ionicons } from "@expo/vector-icons";

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
          audio_b64: null, privacy,
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
              </>
            ) : (
              <View style={styles.proLock}>
                <Ionicons name="sparkles" size={14} color="#FDE047" />
                <Text style={styles.proLockTxt}>Text notes & audio come with Pro</Text>
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
  proLock: { flexDirection: "row", alignItems: "center", gap: 6, padding: 12, borderRadius: 14, backgroundColor: "rgba(253,224,71,0.06)", borderWidth: 1, borderColor: "rgba(253,224,71,0.2)" },
  proLockTxt: { color: "#FDE047", fontSize: 12 },
  privacyRow: { flexDirection: "row", gap: 8 },
  privChip: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center" },
  privChipActive: { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "#fff" },
  privTxt: { color: COLORS.textSecondary, fontWeight: "600", fontSize: 12 },
});
