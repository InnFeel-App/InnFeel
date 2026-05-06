import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth";
import { COLORS } from "../../src/theme";

/**
 * Coach Hub — the new top-level entry point for InnFeel's premium-feeling
 * wellness flows. Lives in the bottom tab bar at /coach. Each category card
 * routes to a specific screen:
 *   • Wellness Coach  → /coach-chat   (Claude Sonnet 4.5 chat)
 *   • Journaling      → /journal      (morning + evening prompts)
 *   • Future slots    → /breath, /meditation, /insights, … (cards already
 *     scaffolded as "Coming soon" so the design stays consistent).
 *
 * The page is intentionally simple — a hero, a vertical stack of large
 * gradient cards, and gentle animations. It's not a feed; it's a menu of
 * intentional, slow-burn rituals.
 */

type Category = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  colors: [string, string];
  route?: string;
  badge?: string;
};

const CATEGORIES: Category[] = [
  {
    key: "wellness",
    title: "Wellness Coach",
    subtitle: "Talk through what you feel — Claude Sonnet 4.5 listens, mirrors, suggests.",
    icon: "sparkles",
    colors: ["#A78BFA", "#F472B6"],
    route: "/coach-chat",
    badge: "AI ✦",
  },
  {
    key: "journal",
    title: "Journaling",
    subtitle: "Morning intention · Evening reflection · Three-prompt check-ins.",
    icon: "book",
    colors: ["#FACC15", "#F59E0B"],
    route: "/journal",
  },
  {
    key: "breath",
    title: "Breathing",
    subtitle: "60-second guided breath cycles. Land yourself before the noise.",
    icon: "leaf",
    colors: ["#34D399", "#10B981"],
    badge: "Soon",
  },
  {
    key: "meditation",
    title: "Meditation",
    subtitle: "Short, AI-generated meditations matched to your aura of the day.",
    icon: "moon",
    colors: ["#1E1B4B", "#4C1D95"],
    badge: "Soon",
  },
];

function PulseCard({ children, style }: { children: React.ReactNode; style?: any }) {
  // Faint scale-up on mount for a graceful entrance — repeated subtle pulse
  // would be too much on a list of 4 cards. Mount-in only.
  const sc = useRef(new Animated.Value(0.97)).current;
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(sc, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [sc, op]);
  return (
    <Animated.View style={[{ opacity: op, transform: [{ scale: sc }] }, style]}>
      {children}
    </Animated.View>
  );
}

export default function CoachHub() {
  const router = useRouter();
  const { user } = useAuth();
  const pro = !!user?.pro;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Text style={styles.kicker}>YOUR WELLNESS</Text>
        <Text style={styles.title}>Coach</Text>
        <Text style={styles.subtitle}>
          A quiet space to land with yourself.
          {!pro ? "  Upgrade to Pro to unlock everything ✦" : ""}
        </Text>

        {/* Category cards */}
        <View style={{ marginTop: 22, gap: 14 }}>
          {CATEGORIES.map((c, i) => {
            const disabled = c.badge === "Soon";
            return (
              <PulseCard key={c.key} style={{ marginTop: i === 0 ? 0 : 0 }}>
                <TouchableOpacity
                  testID={`coach-card-${c.key}`}
                  activeOpacity={disabled ? 1 : 0.85}
                  onPress={() => {
                    if (disabled) return;
                    if (c.route) router.push(c.route as any);
                  }}
                >
                  <LinearGradient
                    colors={c.colors}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[styles.card, disabled && { opacity: 0.55 }]}
                  >
                    <View style={styles.cardIconWrap}>
                      <Ionicons name={c.icon} size={26} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.cardTitle}>{c.title}</Text>
                        {c.badge ? (
                          <View style={[styles.badge, c.badge === "Soon" ? styles.badgeMuted : styles.badgeBright]}>
                            <Text style={[styles.badgeTxt, c.badge === "Soon" ? styles.badgeTxtMuted : styles.badgeTxtBright]}>
                              {c.badge}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.cardSub}>{c.subtitle}</Text>
                    </View>
                    {!disabled ? (
                      <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
                    ) : null}
                  </LinearGradient>
                </TouchableOpacity>
              </PulseCard>
            );
          })}
        </View>

        {/* Footer note */}
        <Text style={styles.footnote}>
          ✦ AI replies are powered by Claude Sonnet 4.5. We don't store voice or use your
          words to train any model.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  kicker: { color: COLORS.textTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 2.4, marginTop: 8 },
  title: { color: "#fff", fontSize: 36, fontWeight: "900", letterSpacing: -1, marginTop: 6 },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8, maxWidth: 360 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    minHeight: 96,
  },
  cardIconWrap: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  cardSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 4, lineHeight: 17 },

  badge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.30)",
  },
  badgeBright: { backgroundColor: "rgba(255,255,255,0.20)" },
  badgeMuted:  { backgroundColor: "rgba(0,0,0,0.30)" },
  badgeTxt: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  badgeTxtBright: { color: "#fff" },
  badgeTxtMuted:  { color: "rgba(255,255,255,0.85)" },

  footnote: {
    color: COLORS.textTertiary,
    fontSize: 11,
    textAlign: "center",
    marginTop: 28,
    paddingHorizontal: 18,
    lineHeight: 16,
  },
});
