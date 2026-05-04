/**
 * ShareAuraButton — funky, animated gradient pill with a sparkle ✦.
 *
 * Compared to a plain white button, this one:
 *   · Has a moving aurora gradient (purple → pink → amber → cyan)
 *   · Animates a soft glow pulse continuously
 *   · Sparkles a ✦ that gently rotates
 *   · Compresses on press for tactile feedback
 *
 * Drop-in replacement for the old `<TouchableOpacity testID="share-my-mood">`.
 */
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Pressable,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  onPress: () => void;
  label?: string;
  testID?: string;
};

export default function ShareAuraButton({ onPress, label = "Share your aura", testID = "share-my-mood" }: Props) {
  const shimmer = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const sparkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Shimmer: the gradient sweeps left-right continuously (4s loop)
    Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
    // Pulse: outer glow breathes (1.6s)
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    ).start();
    // Sparkle: rotate the ✦ (8s slow)
    Animated.loop(
      Animated.timing(sparkle, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, [shimmer, pulse, sparkle]);

  const translateX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-160, 160] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const rotate = sparkle.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.wrap} testID={testID}>
      {/* Soft outer glow that pulses */}
      <Animated.View pointerEvents="none" style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}>
        <LinearGradient
          colors={["#A78BFA", "#F472B6", "#FB923C"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(press, { toValue: 0.96, useNativeDriver: true, friction: 5 }).start()}
        onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, friction: 5 }).start()}
        accessibilityRole="button"
      >
        <Animated.View style={{ transform: [{ scale: press }] }}>
          <View style={styles.btn}>
            {/* Base aurora gradient */}
            <LinearGradient
              colors={["#7C3AED", "#A78BFA", "#F472B6", "#FB923C", "#22D3EE"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFillObject}
            />
            {/* Animated highlight band sweeping across */}
            <Animated.View
              pointerEvents="none"
              style={[styles.shimmer, { transform: [{ translateX }] }]}
            >
              <LinearGradient
                colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.55)", "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>
            {/* Content */}
            <View style={styles.content}>
              <Animated.Text style={[styles.sparkle, { transform: [{ rotate }] }]}>✦</Animated.Text>
              <Text style={styles.label} numberOfLines={1}>{label}</Text>
              <Ionicons name="share-social" size={18} color="#fff" style={{ opacity: 0.95 }} />
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, position: "relative" },
  glow: {
    position: "absolute",
    top: -3, bottom: -3, left: -6, right: -6,
    borderRadius: 999,
    overflow: "hidden",
  },
  btn: {
    height: 34,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
  },
  shimmer: {
    position: "absolute",
    top: 0, bottom: 0, width: 56,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    gap: 6,
  },
  sparkle: { color: "#fff", fontSize: 13, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.25)", textShadowRadius: 4 },
  label: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.2,
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowRadius: 4,
    flexShrink: 1,
  },
});
