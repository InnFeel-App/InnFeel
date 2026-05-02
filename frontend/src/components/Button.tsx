import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { COLORS } from "../theme";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
};

export default function Button({ label, onPress, variant = "primary", loading, disabled, testID }: Props) {
  const style =
    variant === "primary" ? styles.primary : variant === "secondary" ? styles.secondary : styles.ghost;
  const txt =
    variant === "primary" ? styles.primaryTxt : variant === "secondary" ? styles.secondaryTxt : styles.ghostTxt;
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.base, style, (disabled || loading) && { opacity: 0.55 }]}
      activeOpacity={0.85}
    >
      {loading ? <ActivityIndicator color={variant === "primary" ? "#000" : "#fff"} /> : <Text style={txt}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: "#fff" },
  primaryTxt: { color: "#000", fontWeight: "700", fontSize: 16 },
  secondary: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: COLORS.border },
  secondaryTxt: { color: "#fff", fontWeight: "600", fontSize: 15 },
  ghost: { backgroundColor: "transparent" },
  ghostTxt: { color: COLORS.textSecondary, fontWeight: "500", fontSize: 14 },
});
