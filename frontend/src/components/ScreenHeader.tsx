import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { COLORS } from "../theme";

/**
 * Unified header used at the top of every primary tab screen.
 *
 * Goals
 *  • Visually centred title — feels premium and balanced on mobile.
 *  • Optional uppercase "kicker" above the title for a magazine-feel
 *    (e.g. "YOUR WELLNESS" above "Coach").
 *  • Optional right slot for a badge (e.g. unread count) without
 *    breaking the centred alignment of the title — the badge floats
 *    in an absolutely-positioned slot so a long title never collides
 *    with it.
 *  • Consistent vertical rhythm: 8 / 16 / 24 spacing scale.
 *
 * Used by: messages, coach, friends, stats. (home keeps a custom hero.)
 */

type Props = {
  /** Big bold title — centred. */
  title: string;
  /** Optional small uppercase line ABOVE the title. */
  kicker?: string;
  /** Optional subtitle BELOW the title (auto-centred + soft colour). */
  subtitle?: string;
  /** Optional right-aligned slot (e.g. unread badge). Floats absolutely. */
  rightSlot?: React.ReactNode;
  /** Optional left-aligned slot (e.g. back button). Floats absolutely. */
  leftSlot?: React.ReactNode;
  style?: ViewStyle;
  /** Visual tightness — "default" (24pt bottom) or "tight" (8pt). */
  tone?: "default" | "tight";
  testID?: string;
};

export default function ScreenHeader({
  title,
  kicker,
  subtitle,
  rightSlot,
  leftSlot,
  style,
  tone = "default",
  testID,
}: Props) {
  return (
    <View
      style={[
        styles.wrap,
        tone === "tight" ? styles.wrapTight : styles.wrapDefault,
        style,
      ]}
      testID={testID}
    >
      {/* Slots float absolutely so the title remains perfectly centred
          regardless of slot widths. They line up vertically with the
          title so the visual mass feels balanced. */}
      {leftSlot ? <View style={styles.leftSlot}>{leftSlot}</View> : null}
      {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}

      {kicker ? <Text style={styles.kicker}>{kicker.toUpperCase()}</Text> : null}
      <Text
        style={[
          styles.title,
          // Reserve room for floating slots so a long title can never
          // visually collide with the back button or right badge. 56px
          // = 40 (slot width) + 16 (margin from screen edge).
          (leftSlot || rightSlot) ? { paddingHorizontal: 56 } : null,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  wrapDefault: { paddingBottom: 20 },
  wrapTight:   { paddingBottom: 12 },

  kicker: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.4,
    marginBottom: 6,
  },
  title: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.8,
    textAlign: "center",
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 320,
  },

  // Floating slots — vertically centred against the title row.
  leftSlot: {
    position: "absolute",
    left: 16,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  rightSlot: {
    position: "absolute",
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
