import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform, ScrollView } from "react-native";
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

export type ShareDestination =
  | "story"
  | "reel"
  | "dm"
  | "messages"
  | "whatsapp"
  | "telegram"
  | "more";

type Props = {
  visible: boolean;
  hasVideo: boolean;
  // Drives the picker copy so the same component reads "Share your aura"
  // on Home, "Share your stats" on Stats and "Share your leaderboard" on
  // Achievements — keeps the wording consistent across the app.
  kind?: "mood" | "stats" | "leaderboard";
  onPick: (dest: ShareDestination) => void;
  onCancel: () => void;
};

export default function ShareDestinationPicker({ visible, hasVideo, kind = "mood", onPick, onCancel }: Props) {
  const titleByKind: Record<string, string> = {
    mood: "Share your aura",
    stats: "Share your stats",
    leaderboard: "Share your leaderboard",
  };
  const title = titleByKind[kind] || titleByKind.mood;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <TouchableOpacity activeOpacity={1} style={styles.overlay} onPress={onCancel}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>Pick where to send it.</Text>

          <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
          {/* Instagram group */}
          <Text style={styles.groupLabel}>INSTAGRAM</Text>
          <DestinationRow
            icon="aperture"
            gradient={["#7B1FA2", "#EC4899", "#FFC371"]}
            title="Story"
            subtitle="Vertical 24h • most popular"
            onPress={() => onPick("story")}
            testID="share-dest-story"
          />
          {hasVideo ? (
            <DestinationRow
              icon="film"
              gradient={["#3F0D70", "#A78BFA", "#22D3EE"]}
              title="Reel"
              subtitle="Vertical loop • feed reach"
              onPress={() => onPick("reel")}
              testID="share-dest-reel"
            />
          ) : null}
          <DestinationRow
            icon="paper-plane"
            gradient={["#0E7490", "#22D3EE", "#A78BFA"]}
            title="Direct message"
            subtitle="Send privately to a friend"
            onPress={() => onPick("dm")}
            testID="share-dest-dm"
          />

          {/* Messaging group */}
          <Text style={styles.groupLabel}>MESSAGING</Text>
          <DestinationRow
            icon="logo-whatsapp"
            gradient={["#075E54", "#25D366", "#34D399"]}
            title="WhatsApp"
            subtitle="Send to a contact or group"
            onPress={() => onPick("whatsapp")}
            testID="share-dest-whatsapp"
          />
          <DestinationRow
            icon="paper-plane-outline"
            gradient={["#0088CC", "#54A9EB", "#A0D8F6"]}
            title="Telegram"
            subtitle="Send to a contact or channel"
            onPress={() => onPick("telegram")}
            testID="share-dest-telegram"
          />
          <DestinationRow
            icon="chatbox"
            gradient={["#22C55E", "#34D399", "#86EFAC"]}
            title="Messages"
            subtitle="iMessage / SMS"
            onPress={() => onPick("messages")}
            testID="share-dest-messages"
          />

          <Text style={styles.groupLabel}>OTHER</Text>
          <DestinationRow
            icon="ellipsis-horizontal-circle"
            gradient={["#475569", "#64748B", "#94A3B8"]}
            title="More apps…"
            subtitle="Open the system share sheet"
            onPress={() => onPick("more")}
            testID="share-dest-more"
          />
          </ScrollView>

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
  gradient,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: any;
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
  subtitle: { color: COLORS.textSecondary, fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: 14 },
  groupLabel: { color: COLORS.textTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginTop: 8, marginBottom: 8, paddingHorizontal: 4 },
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
