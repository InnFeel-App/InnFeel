import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

/**
 * Guided Journaling — morning intention + evening reflection.
 *
 * Single screen, two cards. We pick the dominant card based on local time
 * (06–14h → morning, otherwise evening) but the user can switch via a tab.
 *
 * Backend endpoints (see /app/backend/routes/journal.py):
 *   POST /api/journal/checkin  { kind, answers, note? } → upsert today's entry
 *   GET  /api/journal/today                              → today's morning + evening
 *   POST /api/journal/reflect  { kind }                  → AI reflection (Pro/Zen only,
 *                                                          consumes a coach quota credit)
 */
type Prompts = { key: string; label: string; placeholder: string }[];

const MORNING_PROMPTS: Prompts = [
  { key: "sleep",     label: "How did you sleep?",                placeholder: "A few words on your night…" },
  { key: "intentions",label: "Your top 3 intentions today",       placeholder: "What do you want to bring into the day?" },
  { key: "gratitude", label: "One thing you're grateful for",     placeholder: "Anything, however small." },
];

const EVENING_PROMPTS: Prompts = [
  { key: "highlight", label: "What lit you up today?",            placeholder: "A moment, a person, a feeling…" },
  { key: "weight",    label: "What weighed on you?",              placeholder: "Be honest. Naming helps." },
  { key: "lesson",    label: "One thing you learned about yourself", placeholder: "Even tiny insights count." },
];

type Kind = "morning" | "evening";

export default function JournalScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pro = !!user?.pro || !!(user as any)?.zen;

  // Local hour decides the default card on mount; user can toggle.
  const [kind, setKind] = useState<Kind>(() => {
    const h = new Date().getHours();
    return h >= 6 && h < 14 ? "morning" : "evening";
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const prompts = kind === "morning" ? MORNING_PROMPTS : EVENING_PROMPTS;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<any>("/journal/today");
      const e = r?.[kind];
      setAnswers((e?.answers as any) || {});
      setNote(e?.note || "");
      setReflection(e?.reflection || null);
      setSavedAt(e?.updated_at || null);
    } catch {} finally { setLoading(false); }
  }, [kind]);

  useEffect(() => { refresh(); }, [refresh]);

  const dirty = useMemo(() => {
    return Object.values(answers).some((v) => (v || "").trim().length > 0) || note.trim().length > 0;
  }, [answers, note]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const r = await api<any>("/journal/checkin", {
        method: "POST",
        body: { kind, answers, note: note.trim() || null },
      });
      setSavedAt(r?.entry?.updated_at || new Date().toISOString());
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message || "Try again.");
    } finally { setSaving(false); }
  };

  const reflect = async () => {
    if (!pro) {
      Alert.alert(
        "Pro feature",
        "AI reflections are part of Pro. Want to upgrade?",
        [
          { text: "Maybe later", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/paywall") },
        ],
      );
      return;
    }
    // Save first so the backend always sees the latest content.
    if (dirty) await save();
    setReflecting(true);
    try {
      const r = await api<any>("/journal/reflect", { method: "POST", body: { kind } });
      setReflection(r?.reflection || null);
    } catch (e: any) {
      const msg = (e?.message || "").toString();
      if (msg.includes("402") || msg.toLowerCase().includes("quota")) {
        Alert.alert("Coach quota reached", msg, [
          { text: "Close", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/paywall") },
        ]);
      } else {
        Alert.alert("Couldn't reflect", msg || "Try again in a moment.");
      }
    } finally { setReflecting(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Journal</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 18, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Kind switcher */}
          <View style={styles.tabs}>
            {(["morning", "evening"] as const).map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.tab, kind === k && styles.tabActive]}
                onPress={() => setKind(k)}
              >
                <Ionicons
                  name={k === "morning" ? "sunny-outline" : "moon-outline"}
                  size={14}
                  color={kind === k ? "#0E0A1F" : "rgba(255,255,255,0.7)"}
                />
                <Text style={[styles.tabTxt, kind === k && styles.tabTxtActive]}>
                  {k === "morning" ? "Morning" : "Evening"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Hero */}
          <LinearGradient
            colors={kind === "morning" ? ["#FACC15", "#F59E0B", "#A78BFA"] : ["#1E1B4B", "#4C1D95", "#A78BFA"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Text style={styles.heroKicker}>
              {kind === "morning" ? "MORNING CHECK-IN" : "EVENING REFLECTION"}
            </Text>
            <Text style={styles.heroTitle}>
              {kind === "morning"
                ? "Set the tone before the noise."
                : "Land the day with kindness."}
            </Text>
          </LinearGradient>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color="#A78BFA" /></View>
          ) : (
            <>
              {prompts.map((p) => (
                <View key={p.key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{p.label}</Text>
                  <TextInput
                    value={answers[p.key] || ""}
                    onChangeText={(v) => setAnswers((prev) => ({ ...prev, [p.key]: v }))}
                    placeholder={p.placeholder}
                    placeholderTextColor="rgba(255,255,255,0.30)"
                    style={styles.input}
                    multiline
                    maxLength={1000}
                  />
                </View>
              ))}

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Free note (optional)</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Anything else on your mind…"
                  placeholderTextColor="rgba(255,255,255,0.30)"
                  style={[styles.input, { minHeight: 80 }]}
                  multiline
                  maxLength={2000}
                />
              </View>

              {/* AI Reflection card */}
              {reflection ? (
                <View style={styles.reflectCard}>
                  <View style={styles.reflectHead}>
                    <Ionicons name="sparkles" size={14} color="#A78BFA" />
                    <Text style={styles.reflectKicker}>Coach reflection</Text>
                  </View>
                  <Text style={styles.reflectTxt}>{reflection}</Text>
                </View>
              ) : null}

              {savedAt ? (
                <Text style={styles.savedHint}>
                  Saved · {new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>

        {/* Sticky CTA bar */}
        <View style={styles.ctaBar}>
          <TouchableOpacity
            style={[styles.ctaSecondary, (!pro || reflecting) && { opacity: 0.55 }]}
            onPress={reflect}
            disabled={reflecting || !dirty}
            testID="journal-reflect"
          >
            {reflecting ? (
              <ActivityIndicator color="#A78BFA" size="small" />
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={16} color="#A78BFA" />
                <Text style={styles.ctaSecondaryTxt}>{pro ? "AI Reflect" : "AI Reflect ✦ Pro"}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctaPrimary, (!dirty || saving) && { opacity: 0.55 }]}
            onPress={save}
            disabled={!dirty || saving}
            testID="journal-save"
          >
            {saving ? (
              <ActivityIndicator color="#0E0A1F" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#0E0A1F" />
                <Text style={styles.ctaPrimaryTxt}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center" },
  center: { padding: 40, alignItems: "center" },

  tabs: { flexDirection: "row", gap: 8, alignSelf: "center", marginBottom: 14, padding: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 },
  tabActive: { backgroundColor: "#FACC15" },
  tabTxt: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "700", letterSpacing: 0.4 },
  tabTxtActive: { color: "#0E0A1F" },

  hero: { borderRadius: 22, padding: 20, marginBottom: 18 },
  heroKicker: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "800", letterSpacing: 1.6 },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 8, lineHeight: 28, letterSpacing: -0.3 },

  field: { marginBottom: 16 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 },
  input: {
    color: "#fff", fontSize: 15, lineHeight: 21,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14, padding: 12, minHeight: 56,
  },

  reflectCard: {
    backgroundColor: "rgba(167,139,250,0.10)",
    borderWidth: 1, borderColor: "rgba(167,139,250,0.30)",
    borderRadius: 16, padding: 14, marginBottom: 12,
  },
  reflectHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  reflectKicker: { color: "#A78BFA", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  reflectTxt: { color: "#fff", fontSize: 14, lineHeight: 20 },

  savedHint: { color: COLORS.textTertiary, fontSize: 11, textAlign: "center", marginTop: 8 },

  ctaBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: 10, padding: 16, paddingBottom: 28,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)",
  },
  ctaSecondary: {
    flex: 1, height: 48, borderRadius: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(167,139,250,0.10)",
    borderWidth: 1, borderColor: "rgba(167,139,250,0.30)",
  },
  ctaSecondaryTxt: { color: "#A78BFA", fontWeight: "700", fontSize: 14 },
  ctaPrimary: {
    flex: 1, height: 48, borderRadius: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#FACC15",
  },
  ctaPrimaryTxt: { color: "#0E0A1F", fontWeight: "800", fontSize: 14 },
});
