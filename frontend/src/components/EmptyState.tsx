/**
 * EmptyState — a polished, soft-pulsing illustration block for empty
 * collection screens (no friends yet, no auras yet, locked feed, offline…).
 *
 * Design intent:
 *   • Lightweight: no native deps beyond expo-linear-gradient (already in
 *     the bundle for the share button).
 *   • Native-driver pulse so it stays smooth even on older Android.
 *   • Rainbow orb conveys "still good vibes" — same gradient family as the
 *     share-your-code button so the empty states feel like part of the same
 *     visual system.
 *   • Optional centered icon stays crisp because the orb itself is opaque.
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../theme";

type Tone = "default" | "lock" | "people" | "offline" | "spark";

const TONES: Record<Tone, { colors: string[]; icon: keyof typeof Ionicons.glyphMap; iconColor: string }> = {
  default: { colors: ["#A78BFA", "#F472B6", "#FACC15"], icon: "sparkles", iconColor: "#fff" },
  spark:   { colors: ["#A78BFA", "#F472B6", "#FACC15", "#34D399"], icon: "sparkles", iconColor: "#fff" },
  lock:    { colors: ["#475569", "#1E293B", "#0F172A"], icon: "lock-closed", iconColor: "#FACC15" },
  people:  { colors: ["#34D399", "#22D3EE", "#A78BFA"], icon: "people", iconColor: "#fff" },
  offline: { colors: ["#64748B", "#334155", "#1E293B"], icon: "cloud-offline", iconColor: "#fff" },
};

export interface EmptyStateProps {
  title: string;
  subtitle?: string;
  tone?: Tone;
  size?: number;
  /** Optional CTA rendered under the subtitle (e.g. <Button label="Add" onPress={…} />). */
  cta?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export default function EmptyState({
  title,
  subtitle,
  tone = "default",
  size = 96,
  cta,
  style,
  testID,
}: EmptyStateProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Outer scale + opacity pulse — slow & calm so it doesn't compete with content.
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
    // Tiny vertical bob (~3 px).
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse, float]);

  const t = TONES[tone];
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.08] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.65] });
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <Animated.View
        style={{
          width: size, height: size,
          alignItems: "center", justifyContent: "center",
          transform: [{ translateY }],
        }}
      >
        {/* Halo — soft outer pulse */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { borderRadius: size / 2, overflow: "hidden", opacity: haloOpacity, transform: [{ scale }] },
          ]}
        >
          <LinearGradient
            colors={t.colors as any}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        {/* Inner orb — slightly smaller so the halo glows around it */}
        <View style={{ width: size * 0.78, height: size * 0.78, borderRadius: (size * 0.78) / 2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          <LinearGradient
            colors={t.colors as any}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name={t.icon} size={Math.round(size * 0.32)} color={t.iconColor} />
        </View>
      </Animated.View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {cta ? <View style={{ marginTop: 14 }}>{cta}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
    textAlign: "center",
    marginTop: 16,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
    maxWidth: 320,
  },
});
