import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RadialAura from "../src/components/RadialAura";
import { COLORS } from "../src/theme";
import { t } from "../src/i18n";
import { Ionicons } from "@expo/vector-icons";
import * as Localization from "expo-localization";
import {
  NotifCategory,
  getAllPrefs,
  setCategoryEnabled,
  REMINDER_NOON_HOUR,
  REMINDER_NOON_MINUTE,
  REMINDER_EVENING_HOUR,
  REMINDER_EVENING_MINUTE,
} from "../src/notifications";

type PrefRow = {
  key: NotifCategory;
  icon: any;
  color: string;
  title: string;
  sub: string;
};

const ROWS: PrefRow[] = [
  {
    key: "reminder",
    icon: "sparkles",
    color: "#FACC15",
    title: "Daily aura reminder",
    sub: `At ${String(REMINDER_NOON_HOUR).padStart(2, "0")}:${String(REMINDER_NOON_MINUTE).padStart(2, "0")} · backup at ${String(REMINDER_EVENING_HOUR).padStart(2, "0")}:${String(REMINDER_EVENING_MINUTE).padStart(2, "0")} if you haven't shared yet`,
  },
  {
    key: "reaction",
    icon: "heart",
    color: "#EC4899",
    title: "Reactions & comments",
    sub: "When friends react or comment on your aura",
  },
  {
    key: "message",
    icon: "chatbubble",
    color: "#38BDF8",
    title: "Direct messages",
    sub: "When a friend sends you a private message",
  },
  {
    key: "friend",
    icon: "people",
    color: "#A855F7",
    title: "Friend activity",
    sub: "When someone adds you as a friend",
  },
];

export default function Settings() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Record<NotifCategory, boolean>>({
    reminder: true, reaction: true, message: true, friend: true,
  });
  const locale = Localization.getLocales?.()[0]?.languageCode || "en";

  useEffect(() => {
    (async () => setPrefs(await getAllPrefs()))();
  }, []);

  const toggle = async (cat: NotifCategory, value: boolean) => {
    setPrefs((p) => ({ ...p, [cat]: value }));
    await setCategoryEnabled(cat, value);
  };

  return (
    <View style={styles.container} testID="settings-screen">
      <RadialAura color="#60A5FA" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity
            testID="settings-back"
            onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile"); }}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t("settings.title")}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <Text style={styles.sectionSub}>Stay in the loop. Toggle any category off anytime.</Text>

          {ROWS.map((r) => (
            <View key={r.key} style={styles.row} testID={`notif-${r.key}-row`}>
              <View style={[styles.iconBox, { backgroundColor: r.color + "20", borderColor: r.color + "50" }]}>
                <Ionicons name={r.icon} size={18} color={r.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowSub}>{r.sub}</Text>
              </View>
              <Switch
                testID={`notif-${r.key}-toggle`}
                value={prefs[r.key]}
                onValueChange={(v) => toggle(r.key, v)}
                trackColor={{ false: "rgba(255,255,255,0.15)", true: r.color }}
                thumbColor="#fff"
              />
            </View>
          ))}

          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Other</Text>

          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: "rgba(56,189,248,0.15)", borderColor: "rgba(56,189,248,0.35)" }]}>
              <Ionicons name="globe-outline" size={18} color="#38BDF8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t("settings.language")}</Text>
              <Text style={styles.rowSub}>Auto · device: {locale.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: "rgba(167,139,250,0.15)", borderColor: "rgba(167,139,250,0.35)" }]}>
              <Ionicons name="eye-outline" size={18} color="#A78BFA" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t("settings.privacy")}</Text>
              <Text style={styles.rowSub}>Set per-aura when you share.</Text>
            </View>
          </View>

          <Text style={styles.footer}>InnFeel 1.0 · made with color</Text>
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
  scroll: { padding: 20, paddingBottom: 60 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  sectionSub: { color: COLORS.textTertiary, fontSize: 12, marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
  iconBox: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 16 },
  footer: { color: COLORS.textTertiary, textAlign: "center", marginTop: 30, fontSize: 12 },
});
