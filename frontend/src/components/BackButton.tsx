import React from "react";
import { TouchableOpacity, StyleSheet, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

/**
 * Standard back button used in the leftSlot of every ScreenHeader that
 * isn't a primary tab (Home / Aura / Inbox / Coach / Me are tabs and
 * intentionally have no back button — you reach them via the bottom
 * bar).
 *
 * Behaviour:
 *  • Tap → router.back() if there is a history entry.
 *  • Otherwise → fall back to /(tabs)/profile so the user is never
 *    "stuck" on a leaf screen.
 *
 * Keeping this in one component means we only need to fix the chevron
 * icon, the tap target size, the haptic feedback and the colour in one
 * place. The 40×40 hit area is above iOS HIG's 44pt min-target, padded
 * with internal margin so the icon stays visually 22pt.
 */

type Props = {
  /** Optional override — by default we go back, then to /me as fallback. */
  fallbackPath?: string;
  /** Override icon colour (white by default). */
  color?: string;
  style?: ViewStyle;
  testID?: string;
};

export default function BackButton({
  fallbackPath = "/(tabs)/profile",
  color = "#fff",
  style,
  testID = "back-btn",
}: Props) {
  const router = useRouter();
  return (
    <TouchableOpacity
      testID={testID}
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace(fallbackPath as any);
        }
      }}
      style={[styles.btn, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="chevron-back" size={22} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
});
