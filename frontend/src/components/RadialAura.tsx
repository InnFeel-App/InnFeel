import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type Props = {
  color?: string;
  style?: ViewStyle;
  children?: React.ReactNode;
};

export default function RadialAura({ color = "#A78BFA", style, children }: Props) {
  // Multiple blurred translucent layers to fake a luminous radial burst.
  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      <View pointerEvents="none" style={[styles.blob, styles.b1, { backgroundColor: color, opacity: 0.35 }]} />
      <View pointerEvents="none" style={[styles.blob, styles.b2, { backgroundColor: color, opacity: 0.22 }]} />
      <View pointerEvents="none" style={[styles.blob, styles.b3, { backgroundColor: color, opacity: 0.12 }]} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(5,5,5,0)", "rgba(5,5,5,0.75)", "rgba(5,5,5,1)"]}
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
  b1: { width: 520, height: 520, top: -160, left: -120 },
  b2: { width: 420, height: 420, top: 180, right: -140 },
  b3: { width: 380, height: 380, bottom: -120, left: -80 },
});
