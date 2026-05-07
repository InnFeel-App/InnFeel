/**
 * EmptyState — soft-pulsing illustration block for empty / locked / offline /
 * error screens.
 *
 * Phase B5 polish:
 *   • Three small "satellite" orbs orbit the main glyph (slow, native-driver
 *     rotation) so the empty state feels alive without being distracting.
 *   • New `offline` tone uses a desaturated cloud + jittery lightning bolt to
 *     hint at a flaky link, plus an optional "Retry" CTA (passed via `cta`).
 *   • New `error` tone (warm orange) for unrecoverable failures.
 *   • All animations use the native driver so 60 fps is maintained on older
 *     Androids. The orbit ring is purely decorative and pointer-events: none.
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../theme";

type Tone = "default" | "lock" | "people" | "offline" | "spark" | "error";

const TONES: Record<
  Tone,
  {
    colors: string[];
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    /** Three little satellite orbs (color, size factor 0..1 of `size`) */
    satellites: { color: string; sizeFactor: number }[];
    /** Slow rotation period in ms — different per tone gives subtle variety */
    rotateMs: number;
  }
> = {
  default: {
    colors: ["#A78BFA", "#F472B6", "#FACC15"],
    icon: "sparkles",
    iconColor: "#fff",
    satellites: [
      { color: "#A78BFA", sizeFactor: 0.13 },
      { color: "#F472B6", sizeFactor: 0.1 },
      { color: "#FACC15", sizeFactor: 0.11 },
    ],
    rotateMs: 14000,
  },
  spark: {
    colors: ["#A78BFA", "#F472B6", "#FACC15", "#34D399"],
    icon: "sparkles",
    iconColor: "#fff",
    satellites: [
      { color: "#34D399", sizeFactor: 0.12 },
      { color: "#22D3EE", sizeFactor: 0.1 },
      { color: "#F472B6", sizeFactor: 0.13 },
    ],
    rotateMs: 12000,
  },
  lock: {
    colors: ["#475569", "#1E293B", "#0F172A"],
    icon: "lock-closed",
    iconColor: "#FACC15",
    satellites: [
      { color: "#FACC15", sizeFactor: 0.1 },
      { color: "#64748B", sizeFactor: 0.09 },
      { color: "#475569", sizeFactor: 0.1 },
    ],
    rotateMs: 18000,
  },
  people: {
    colors: ["#34D399", "#22D3EE", "#A78BFA"],
    icon: "people",
    iconColor: "#fff",
    satellites: [
      { color: "#34D399", sizeFactor: 0.13 },
      { color: "#22D3EE", sizeFactor: 0.11 },
      { color: "#A78BFA", sizeFactor: 0.12 },
    ],
    rotateMs: 13000,
  },
  offline: {
    colors: ["#475569", "#334155", "#1E293B"],
    icon: "cloud-offline",
    iconColor: "#FDE047",
    satellites: [
      { color: "#94A3B8", sizeFactor: 0.1 },
      { color: "#64748B", sizeFactor: 0.09 },
      { color: "#475569", sizeFactor: 0.11 },
    ],
    rotateMs: 16000,
  },
  error: {
    colors: ["#F97316", "#EF4444", "#7C2D12"],
    icon: "alert-circle",
    iconColor: "#fff",
    satellites: [
      { color: "#F97316", sizeFactor: 0.12 },
      { color: "#FCA5A5", sizeFactor: 0.1 },
      { color: "#FDBA74", sizeFactor: 0.11 },
    ],
    rotateMs: 11000,
  },
};

export interface EmptyStateProps {
  title: string;
  subtitle?: string;
  tone?: Tone;
  size?: number;
  /** Optional CTA rendered under the subtitle (e.g. <Button label="Retry" onPress={…} />). */
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
  const orbit = useRef(new Animated.Value(0)).current;
  const jitter = useRef(new Animated.Value(0)).current; // for offline tone — bolt jitter

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
    // Slow continuous orbit for the satellite ring.
    Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: TONES[tone].rotateMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
    // Sharp little jitter only used when the tone is `offline` — gives the
    // lightning bolt a flickery feel without burning CPU on other tones.
    if (tone === "offline" || tone === "error") {
      Animated.loop(
        Animated.sequence([
          Animated.delay(900),
          Animated.timing(jitter, { toValue: 1, duration: 90, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(jitter, { toValue: 0, duration: 90, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(jitter, { toValue: 1, duration: 80, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(jitter, { toValue: 0, duration: 80, easing: Easing.linear, useNativeDriver: true }),
        ]),
      ).start();
    }
  }, [pulse, float, orbit, jitter, tone]);

  const t = TONES[tone];
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.08] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.65] });
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const rotate = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const counterRotate = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });
  const jitterX = jitter.interpolate({ inputRange: [0, 1], outputRange: [0, 2] });

  // The orbit ring lives on its own square slightly larger than the orb so the
  // satellites trace a nice halo around it.
  const ringSize = size * 1.55;

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={{ width: ringSize, height: ringSize, alignItems: "center", justifyContent: "center" }}>
        {/* Orbit ring of three satellite orbs — purely decorative */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: ringSize,
            height: ringSize,
            transform: [{ rotate }],
          }}
        >
          {t.satellites.map((sat, i) => {
            const angle = (i / t.satellites.length) * 2 * Math.PI;
            const r = ringSize / 2 - (sat.sizeFactor * size) / 2;
            const left = ringSize / 2 + Math.cos(angle) * r - (sat.sizeFactor * size) / 2;
            const top = ringSize / 2 + Math.sin(angle) * r - (sat.sizeFactor * size) / 2;
            return (
              <View
                key={i}
                style={{
                  position: "absolute",
                  left,
                  top,
                  width: sat.sizeFactor * size,
                  height: sat.sizeFactor * size,
                  borderRadius: (sat.sizeFactor * size) / 2,
                  backgroundColor: sat.color,
                  opacity: 0.85,
                  // Subtle rim so the satellites pop against dark backgrounds.
                  ...(({} as any)),
                }}
              />
            );
          })}
        </Animated.View>

        {/* Centered orb (counter-rotates so the icon stays upright) */}
        <Animated.View
          style={{
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ translateY }, { rotate: counterRotate }],
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
            <Animated.View style={{ transform: [{ translateX: tone === "offline" ? jitterX : 0 }] }}>
              <Ionicons name={t.icon} size={Math.round(size * 0.32)} color={t.iconColor} />
            </Animated.View>
          </View>
        </Animated.View>
      </View>

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
