import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, EMOTION_COLORS } from "../theme";
import Button from "./Button";

type Props = {
  visible: boolean;
  data: {
    emotion: string;
    tone: "positive" | "neutral" | "negative";
    quote: string;
    advice: string;
    share_cta: boolean;
    color?: string;
  } | null;
  userName?: string;
  onClose: () => void;
  onShare?: () => void;
};

export default function WellnessSheet({ visible, data, userName, onClose, onShare }: Props) {
  if (!data) return null;
  const em = EMOTION_COLORS[data.emotion] || EMOTION_COLORS.calm;
  const isPositive = data.tone === "positive";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <LinearGradient
            colors={[em.glow, "rgba(10,10,12,0.95)", "rgba(5,5,5,1)"]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.kicker}>
              <View style={[styles.dot, { backgroundColor: em.hex }]} />
              <Text style={styles.kickerTxt}>
                {isPositive ? "KEEP GOING" : data.tone === "negative" ? "BE GENTLE WITH YOURSELF" : "TAKE A MOMENT"}
              </Text>
            </View>

            <Text style={styles.headline}>
              {isPositive ? `Beautiful, ${userName?.split(" ")[0] || "you"}.` : `It's okay, ${userName?.split(" ")[0] || "you"}.`}
            </Text>

            <View style={[styles.quoteCard, { borderColor: em.hex + "70" }]}>
              <Ionicons name="sparkles" size={16} color={em.hex} style={{ marginBottom: 8 }} />
              <Text style={styles.quote}>{data.quote}</Text>
            </View>

            <Text style={styles.adviceLabel}>{isPositive ? "A small ritual" : "One step you can take"}</Text>
            <Text style={styles.advice}>{data.advice}</Text>

            <View style={{ marginTop: 24, gap: 10 }}>
              {data.share_cta && onShare ? (
                <Button testID="wellness-share" label="Share to Stories" onPress={onShare} />
              ) : null}
              <Button testID="wellness-close" variant={data.share_cta ? "secondary" : "primary"} label="Got it" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 16 },
  sheet: { borderRadius: 28, overflow: "hidden", maxHeight: "85%", borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#0A0A0C" },
  scroll: { padding: 28 },
  kicker: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  kickerTxt: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  headline: { color: "#fff", fontSize: 30, fontWeight: "700", letterSpacing: -0.5, marginTop: 12, lineHeight: 36 },
  quoteCard: { padding: 20, borderRadius: 22, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.04)", marginTop: 22 },
  quote: { color: "#fff", fontSize: 18, fontWeight: "500", lineHeight: 26, fontStyle: "italic" },
  adviceLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginTop: 24 },
  advice: { color: "#fff", fontSize: 16, lineHeight: 24, marginTop: 8 },
});
