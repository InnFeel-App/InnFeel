import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS } from "../theme";

/**
 * ShareDestinationPicker — vertical bottom-sheet picker that lets the user choose
 * WHERE to send their aura before invoking the native share intent.
 *
 * Why this exists:
 *   When the OS share sheet hands off to Instagram, IG shows its OWN picker
 *   (Reel / Post / Story / Direct) which often overlaps & looks scrappy. Showing our
 *   own branded picker first sets expectations + lets us guide the user to the right
 *   IG tab. We omit "Post" entirely (auras don't fit IG's permanent grid).
 *
 * All 3 buttons trigger the SAME native share intent — but each pre-loads a copy
 * tip that tells the user which IG tab to tap.
 */

export type ShareDestination = "story" | "reel" | "dm";

type Props = {
  visible: boolean;
  hasVideo: boolean;
  onPick: (dest: ShareDestination) => void;
  onCancel: () => void;
};

export default function ShareDestinationPicker({ visible, hasVideo, onPick, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity activeOpacity={1} style={styles.overlay} onPress={onCancel}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Share to Instagram</Text>
          <Text style={styles.subtitle}>Pick a destination — we'll open Instagram for you.</Text>

          <DestinationRow
            icon="aperture"
            iconColor="#EC4899"
            gradient={["#7B1FA2", "#EC4899", "#FFC371"]}
            title="Story"
            subtitle="Vertical 24h • most popular"
            onPress={() => onPick("story")}
            testID="share-dest-story"
          />

          {hasVideo ? (
            <DestinationRow
              icon="film"
              iconColor="#A78BFA"
              gradient={["#3F0D70", "#A78BFA", "#22D3EE"]}
              title="Reel"
              subtitle="Vertical loop • feed reach"
              onPress={() => onPick("reel")}
              testID="share-dest-reel"
            />
          ) : null}

          <DestinationRow
            icon="paper-plane"
            iconColor="#22D3EE"
            gradient={["#0E7490", "#22D3EE", "#A78BFA"]}
            title="Direct message"
            subtitle="Send privately to a friend"
            onPress={() => onPick("dm")}
            testID="share-dest-dm"
          />

          <TouchableOpacity onPress={onCancel} style={styles.cancel} testID="share-dest-cancel">
            <Text style={styles.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function DestinationRow({
  icon,
  iconColor,
  gradient,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: any;
  iconColor: string;
  gradient: string[];
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.row} testID={testID}>
      <View style={styles.iconWrap}>
        <LinearGradient
          colors={gradient as any}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <Ionicons name={icon} size={22} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#0F0F14",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignSelf: "center", marginVertical: 8,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "center", marginTop: 4 },
  subtitle: { color: COLORS.textSecondary, fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 10,
  },
  iconWrap: {
    width: 48, height: 48, borderRadius: 14, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
  },
  rowTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  rowSubtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  cancel: { paddingVertical: 14, alignItems: "center", marginTop: 4 },
  cancelTxt: { color: COLORS.textSecondary, fontSize: 14, fontWeight: "600" },
});
