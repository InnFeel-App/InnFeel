import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type Props = {
  color?: string;
  style?: ViewStyle;
  children?: React.ReactNode;
};

export default function RadialAura({ color = "#A78BFA", style, children }: Props) {
  // Multi-layer luminous radial burst — bright funky glow.
  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      <View pointerEvents="none" style={[styles.blob, styles.b1, { backgroundColor: color, opacity: 0.65 }]} />
      <View pointerEvents="none" style={[styles.blob, styles.b2, { backgroundColor: color, opacity: 0.45 }]} />
      <View pointerEvents="none" style={[styles.blob, styles.b3, { backgroundColor: color, opacity: 0.35 }]} />
      <View pointerEvents="none" style={[styles.blob, styles.b4, { backgroundColor: "#EC4899", opacity: 0.18 }]} />
      <View pointerEvents="none" style={[styles.blob, styles.b5, { backgroundColor: "#06D6A0", opacity: 0.15 }]} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(5,5,5,0)", "rgba(5,5,5,0.55)", "rgba(5,5,5,0.92)"]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  blob: {
    position: "absolute",
    borderRadius: 9999,
  },
  b1: { width: 560, height: 560, top: -180, left: -140 },
  b2: { width: 460, height: 460, top: 160, right: -160 },
  b3: { width: 400, height: 400, bottom: -140, left: -80 },
  b4: { width: 320, height: 320, top: 80, right: -60 },
  b5: { width: 300, height: 300, bottom: 60, right: 40 },
});
