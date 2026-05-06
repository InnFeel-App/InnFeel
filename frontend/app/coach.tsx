import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView,
  Platform, Animated, Easing, Alert, Pressable, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

/**
 * AI Wellness Coach chat — Claude Sonnet 4.5 via Emergent LLM Key.
 *
 * UI:
 *  • Bubble timeline with user (right, accent gradient) + coach (left, glass bubble).
 *  • Sticky composer at the bottom that lifts above the keyboard.
 *  • Animated 3-dot "typing" indicator while we await Claude.
 *  • Daily quota badge in the header — informs user how many turns they have left.
 *
 * Backend:
 *  • GET  /api/coach/history → chronological turns + tier + quota_left
 *  • POST /api/coach/chat    → sends a message, returns the coach's reply
 *  • POST /api/coach/reset   → wipes the thread (long-press the trash icon)
 */
type Turn = { id?: string; role: "user" | "assistant"; text: string; created_at: string };

function TypingDots({ color = "#fff" }: { color?: string }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const mk = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: 420, delay, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    const A = mk(a, 0); const B = mk(b, 120); const C = mk(c, 240);
    A.start(); B.start(); C.start();
    return () => { A.stop(); B.stop(); C.stop(); };
  }, [a, b, c]);
  const dot = (val: Animated.Value) => ({
    transform: [{ translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
  });
  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center", paddingVertical: 4 }}>
      <Animated.View style={[styles.typingDot, { backgroundColor: color }, dot(a)]} />
      <Animated.View style={[styles.typingDot, { backgroundColor: color }, dot(b)]} />
      <Animated.View style={[styles.typingDot, { backgroundColor: color }, dot(c)]} />
    </View>
  );
}

const SUGGESTIONS = [
  "I feel overwhelmed today.",
  "Help me understand a recurring feeling.",
  "Suggest a 60-second grounding exercise.",
  "What might be behind today's aura?",
];

export default function CoachScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<"free" | "pro" | "zen">("free");
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const listRef = useRef<FlatList<Turn>>(null);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ items: Turn[]; tier: any; quota_left: number }>("/coach/history?limit=80");
      setTurns(r.items || []);
      setTier(r.tier || "free");
      setQuotaLeft(typeof r.quota_left === "number" ? r.quota_left : null);
      scrollToEnd();
    } catch (e: any) {
      // Fallback — empty thread is fine.
    } finally { setLoading(false); }
  }, [scrollToEnd]);

  useEffect(() => { refresh(); }, [refresh]);

  const send = async (text?: string) => {
    const body = (text ?? input).trim();
    if (!body || sending) return;
    setInput("");
    setSending(true);
    // Optimistic — show the user's message immediately.
    const optimistic: Turn = { role: "user", text: body, created_at: new Date().toISOString() };
    setTurns((prev) => [...prev, optimistic]);
    scrollToEnd();
    try {
      const r = await api<{ reply: string; tier: any; quota_left: number; turn_id: string }>("/coach/chat", {
        method: "POST",
        body: { text: body },
      });
      setTurns((prev) => [
        ...prev,
        { id: r.turn_id, role: "assistant", text: r.reply, created_at: new Date().toISOString() },
      ]);
      setTier(r.tier || tier);
      setQuotaLeft(typeof r.quota_left === "number" ? r.quota_left : quotaLeft);
      scrollToEnd();
    } catch (e: any) {
      // Roll back the optimistic user turn so the user can resend without seeing
      // a duplicate. The error toast tells them what happened.
      setTurns((prev) => prev.filter((t) => t !== optimistic));
      const msg = (e?.message || "").toString();
      if (msg.includes("402") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("trial")) {
        Alert.alert(
          "Coach quota reached",
          msg || "You've used your coach messages for today. Upgrade to Pro or Zen for more.",
          [
            { text: "Maybe later", style: "cancel" },
            { text: "Upgrade", onPress: () => router.push("/paywall") },
          ],
        );
      } else {
        Alert.alert("Couldn't reach the coach", msg || "Try again in a moment.");
      }
    } finally { setSending(false); }
  };

  const onResetLongPress = () => {
    Alert.alert(
      "Clear conversation?",
      "This wipes your coach thread. Your quota isn't refunded.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear", style: "destructive", onPress: async () => {
            try { await api("/coach/reset", { method: "POST" }); } catch {}
            setTurns([]);
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: Turn }) => {
    const mine = item.role === "user";
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        {mine ? (
          <LinearGradient
            colors={["#A78BFA", "#F472B6"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[styles.bubble, styles.bubbleMine]}
          >
            <Text style={styles.bubbleTxtMine}>{item.text}</Text>
          </LinearGradient>
        ) : (
          <View style={[styles.bubble, styles.bubbleTheirs]}>
            <Text style={styles.bubbleTxtTheirs}>{item.text}</Text>
          </View>
        )}
      </View>
    );
  };

  const headerHint = tier === "free"
    ? (quotaLeft && quotaLeft > 0 ? "Free trial — 1 message" : "Free trial used")
    : tier === "zen"
      ? `${quotaLeft ?? 30}/30 left today · Zen`
      : `${quotaLeft ?? 10}/10 left today · Pro`;

  const isEmpty = !loading && turns.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Wellness Coach</Text>
          <Text style={styles.headerSub}>{headerHint}</Text>
        </View>
        <TouchableOpacity onLongPress={onResetLongPress} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="trash-outline" size={20} color="rgba(255,255,255,0.55)" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color="#A78BFA" /></View>
        ) : isEmpty ? (
          <View style={styles.empty}>
            <View style={styles.emptyOrb}>
              <LinearGradient
                colors={["#A78BFA", "#F472B6", "#FACC15"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
            <Text style={styles.emptyTitle}>Hi {user?.name || "there"} ✦</Text>
            <Text style={styles.emptyTxt}>
              I'm your gentle space to explore feelings, patterns and tiny rituals.
              Tap a starter or write your own.
            </Text>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity key={s} style={styles.sugChip} onPress={() => send(s)}>
                  <Text style={styles.sugTxt}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={turns}
            keyExtractor={(t, i) => `${t.id || i}-${t.created_at}`}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            onContentSizeChange={scrollToEnd}
            ListFooterComponent={sending ? (
              <View style={[styles.row, styles.rowTheirs]}>
                <View style={[styles.bubble, styles.bubbleTheirs, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TypingDots color="rgba(255,255,255,0.7)" />
                </View>
              </View>
            ) : null}
          />
        )}

        {/* Composer */}
        <View style={styles.composerWrap}>
          <View style={styles.composer}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Type how you feel…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              multiline
              maxLength={2000}
              editable={!sending}
            />
            <Pressable
              onPress={() => send()}
              disabled={!input.trim() || sending}
              style={({ pressed }) => [
                styles.sendBtn,
                (!input.trim() || sending) && { opacity: 0.4 },
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
            >
              <Ionicons name="arrow-up" size={20} color="#0E0A1F" />
            </Pressable>
          </View>
          <Text style={styles.disclaimer}>
            ✦ I'm an AI, not a replacement for human support. If you're in crisis,
            visit findahelpline.com.
          </Text>
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
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  headerSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2, letterSpacing: 0.3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  empty: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center" },
  emptyOrb: {
    width: 120, height: 120, borderRadius: 60, overflow: "hidden",
    marginBottom: 20, opacity: 0.85,
  },
  emptyTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 8 },
  emptyTxt: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 340 },
  suggestions: { marginTop: 28, gap: 10, alignSelf: "stretch" },
  sugChip: {
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  sugTxt: { color: "#fff", fontSize: 14, fontWeight: "500" },

  row: { flexDirection: "row", marginBottom: 8 },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { borderBottomRightRadius: 6 },
  bubbleTheirs: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    borderBottomLeftRadius: 6,
  },
  bubbleTxtMine: { color: "#fff", fontSize: 15, lineHeight: 21, fontWeight: "500" },
  bubbleTxtTheirs: { color: "#fff", fontSize: 15, lineHeight: 21 },
  typingDot: { width: 6, height: 6, borderRadius: 3 },

  composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 24, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  input: { flex: 1, color: "#fff", fontSize: 15, lineHeight: 21, maxHeight: 120, paddingVertical: 6 },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: "#FACC15",
    alignItems: "center", justifyContent: "center",
  },
  disclaimer: {
    color: COLORS.textTertiary, fontSize: 10, textAlign: "center", marginTop: 8,
    paddingHorizontal: 18, lineHeight: 14,
  },
});
