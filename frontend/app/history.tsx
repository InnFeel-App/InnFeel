import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { EMOTION_COLORS, COLORS } from "../src/theme";
import { useAuth } from "../src/auth";
import { Ionicons } from "@expo/vector-icons";
import { t } from "../src/i18n";

export default function History() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => { try { const r = await api<any>("/moods/history"); setItems(r.items || []); } catch {} }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container} testID="history-screen">
      <RadialAura color="#A78BFA" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity testID="history-back" onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t("history.title")}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.length === 0 ? (
            <Text style={styles.empty}>{t("history.empty")}</Text>
          ) : items.map((m) => {
            const color = EMOTION_COLORS[m.emotion]?.hex || "#A78BFA";
            const d = new Date(m.created_at);
            return (
              <View key={m.mood_id} style={styles.row} testID={`history-item-${m.mood_id}`}>
                <View style={[styles.swatch, { backgroundColor: color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.word}>{m.word}</Text>
                  <Text style={styles.meta}>{EMOTION_COLORS[m.emotion]?.label} · {m.intensity}/{m.intensity > 5 ? 10 : 5}</Text>
                </View>
                <Text style={styles.date}>{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
              </View>
            );
          })}
          {!user?.pro && items.length > 0 ? (
            <View style={styles.proCard}>
              <Text style={styles.proHint}>{t("history.proLock")}</Text>
            </View>
          ) : null}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontSize: 18, fontWeight: "600" },
  scroll: { padding: 20 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
  swatch: { width: 14, height: 48, borderRadius: 7 },
  word: { color: "#fff", fontSize: 18, fontWeight: "700" },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  date: { color: COLORS.textTertiary, fontSize: 12 },
  proCard: { marginTop: 16, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: "rgba(253,224,71,0.25)", backgroundColor: "rgba(253,224,71,0.05)" },
  proHint: { color: "#FDE047", fontSize: 13 },
});
