/**
 * OfflineBanner — slim animated banner that slides in at the top whenever
 * connectivity drops. Sits above safe-area insets so it never overlaps the
 * notch but stays out of the way of regular content when online.
 *
 * Usage: render once near the root (e.g. in `app/_layout.tsx`). It manages
 * its own visibility and never blocks user interaction below.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNetworkStatus } from "../network";
import { t, useI18n } from "../i18n";

export default function OfflineBanner({ onRetry }: { onRetry?: () => void }) {
  // Re-render on language switch so the banner copy updates instantly.
  useI18n();
  const insets = useSafeAreaInsets();
  const { online } = useNetworkStatus();
  const slide = useRef(new Animated.Value(0)).current; // 0 = hidden, 1 = visible
  const visible = !online;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  // Always render (so transitions are smooth), but ignore touches when hidden.
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] });
  const opacity = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.wrap,
        { top: Math.max(insets.top, 8), opacity, transform: [{ translateY }] },
      ]}
      testID="offline-banner"
    >
      <View style={styles.pill}>
        <Ionicons name="cloud-offline" size={14} color="#FACC15" />
        <Text style={styles.text} numberOfLines={1}>
          {t("offline.banner")}
        </Text>
        {onRetry ? (
          <Pressable onPress={onRetry} hitSlop={10} style={styles.retry} testID="offline-retry">
            <Text style={styles.retryTxt}>{t("offline.retry")}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 999,
    // Don't intercept scroll on web — the inner pill is the only touchable area.
    ...Platform.select({ web: { pointerEvents: "box-none" as any } }),
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    borderColor: "rgba(250, 204, 21, 0.35)",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    maxWidth: "92%",
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  retry: {
    marginLeft: 6,
    backgroundColor: "rgba(250, 204, 21, 0.18)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  retryTxt: {
    color: "#FDE047",
    fontSize: 12,
    fontWeight: "700",
  },
});
