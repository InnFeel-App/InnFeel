import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { EMOTION_COLORS, COLORS, REACTIONS } from "../theme";

type Mood = {
  mood_id: string;
  word: string;
  emotion: string;
  intensity: number;
  photo_b64?: string | null;
  text?: string | null;
  author_name?: string;
  author_color?: string;
  created_at?: string;
  reactions?: any[];
};

type Props = {
  mood: Mood;
  onReact?: (emoji: string) => void;
  showAuthor?: boolean;
  testIDPrefix?: string;
};

export default function MoodCard({ mood, onReact, showAuthor = true, testIDPrefix = "mood-card" }: Props) {
  const em = EMOTION_COLORS[mood.emotion] || EMOTION_COLORS.calm;
  return (
    <View style={styles.card} testID={`${testIDPrefix}-${mood.mood_id}`}>
      <LinearGradient
        colors={[em.glow, "rgba(10,10,12,0.0)"]}
        start={{ x: 0.9, y: 0 }}
        end={{ x: 0.1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.headerRow}>
        {showAuthor ? (
          <View style={styles.authorRow}>
            <View style={[styles.avatar, { backgroundColor: mood.author_color || em.hex }]}>
              <Text style={styles.avatarTxt}>{(mood.author_name || "?").slice(0, 1).toUpperCase()}</Text>
            </View>
            <Text style={styles.authorName}>{mood.author_name || "You"}</Text>
          </View>
        ) : <View />}
        <View style={[styles.emotionPill, { borderColor: em.hex }]}>
          <View style={[styles.dot, { backgroundColor: em.hex }]} />
          <Text style={styles.emotionTxt}>{em.label}</Text>
        </View>
      </View>

      <Text style={styles.word}>{mood.word}</Text>

      <View style={styles.intensityRow}>
        {Array.from({ length: mood.intensity > 5 ? 10 : 5 }).map((_, i) => {
          const on = i < mood.intensity;
          return (
            <View
              key={i}
              style={[
                styles.intensityDot,
                { backgroundColor: on ? em.hex : "rgba(255,255,255,0.08)" },
              ]}
            />
          );
        })}
        <Text style={styles.intensityLabel}>{mood.intensity}/{mood.intensity > 5 ? 10 : 5}</Text>
      </View>

      {mood.photo_b64 ? (
        <Image
          source={{ uri: `data:image/jpeg;base64,${mood.photo_b64}` }}
          style={styles.photo}
        />
      ) : null}

      {mood.text ? <Text style={styles.noteText}>"{mood.text}"</Text> : null}

      {onReact ? (
        <View style={styles.reactRow}>
          {REACTIONS.map((r) => (
            <TouchableOpacity
              key={r.key}
              testID={`react-${r.key}-${mood.mood_id}`}
              onPress={() => onReact(r.key)}
              style={styles.reactBtn}
            >
              <Text style={styles.reactEmoji}>{r.symbol}</Text>
            </TouchableOpacity>
          ))}
          {mood.reactions && mood.reactions.length > 0 ? (
            <Text style={styles.reactCount}>{mood.reactions.length}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
    overflow: "hidden",
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#000", fontWeight: "700" },
  authorName: { color: COLORS.textPrimary, fontWeight: "600" },
  emotionPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  emotionTxt: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "600" },
  word: { color: COLORS.textPrimary, fontSize: 34, fontWeight: "700", letterSpacing: -0.5, marginVertical: 4 },
  intensityRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  intensityDot: { width: 16, height: 6, borderRadius: 3 },
  intensityLabel: { color: COLORS.textTertiary, fontSize: 11, marginLeft: 8 },
  photo: { width: "100%", height: 180, borderRadius: 18, marginTop: 14 },
  noteText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 12, fontStyle: "italic" },
  reactRow: { flexDirection: "row", gap: 8, marginTop: 14, alignItems: "center" },
  reactBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
  reactEmoji: { color: "#fff", fontSize: 16 },
  reactCount: { color: COLORS.textSecondary, marginLeft: 6, fontSize: 12 },
});
