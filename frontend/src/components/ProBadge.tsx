import React from "react";
import { View, Text, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Consistent gold Pro badge used across the app.
 * Matches the "Close friends" badge — treated as the canonical Pro visual.
 */
export default function ProBadge({ style, size = "sm" }: { style?: StyleProp<ViewStyle>; size?: "sm" | "md" }) {
  const base = size === "md" ? styles.md : styles.sm;
  const iconSize = size === "md" ? 11 : 9;
  const txt = size === "md" ? styles.txtMd : styles.txtSm;
  return (
    <View style={[styles.wrap, base, style]}>
      <Ionicons name="sparkles" size={iconSize} color="#FACC15" />
      <Text style={[styles.txt, txt]}>Pro</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(250,204,21,0.12)",
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.35)",
    borderRadius: 999,
  },
  sm: { paddingHorizontal: 6, paddingVertical: 2 },
  md: { paddingHorizontal: 10, paddingVertical: 3 },
  txt: { color: "#FACC15", fontWeight: "700", letterSpacing: 0.5 },
  txtSm: { fontSize: 9 },
  txtMd: { fontSize: 11 },
});
