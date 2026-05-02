import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Platform, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RadialAura from "../src/components/RadialAura";
import { COLORS } from "../src/theme";
import { t } from "../src/i18n";
import { Ionicons } from "@expo/vector-icons";
import * as Localization from "expo-localization";
import {
  scheduleDailyReminder,
  clearAllScheduled,
  getNotificationTime,
  setNotificationTime,
  DEFAULT_HOUR,
  DEFAULT_MINUTE,
} from "../src/notifications";

// Default window: 19:00 → 21:00, stepped every 15 minutes
function buildChoices(): { hour: number; minute: number; label: string }[] {
  const out: { hour: number; minute: number; label: string }[] = [];
  for (let h = 19; h <= 21; h++) {
    for (const m of [0, 15, 30, 45]) {
      if (h === 21 && m > 0) continue;
      out.push({ hour: h, minute: m, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` });
    }
  }
  return out;
}

export default function Settings() {
  const router = useRouter();
  const [notif, setNotif] = React.useState(true);
  const [hour, setHour] = React.useState<number>(DEFAULT_HOUR);
  const [minute, setMinute] = React.useState<number>(DEFAULT_MINUTE);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const locale = Localization.getLocales?.()[0]?.languageCode || "en";
  const choices = React.useMemo(buildChoices, []);

  React.useEffect(() => {
    (async () => {
      const t = await getNotificationTime();
      setHour(t.hour); setMinute(t.minute);
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      if (notif) await scheduleDailyReminder(); else await clearAllScheduled();
    })();
  }, [notif, hour, minute]);

  const pickTime = async (h: number, m: number) => {
    setHour(h); setMinute(m);
    await setNotificationTime(h, m);
    setPickerOpen(false);
  };

  const timeLabel = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return (
    <View style={styles.container} testID="settings-screen">
      <RadialAura color="#60A5FA" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity testID="settings-back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile"); }} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t("settings.title")}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.row}>
            <Ionicons name="notifications-outline" size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Daily reminder</Text>
              <Text style={styles.rowSub}>Build an evening ritual — one aura a day.</Text>
            </View>
            <Switch testID="notif-toggle" value={notif} onValueChange={setNotif} />
          </View>

          <TouchableOpacity
            testID="notif-time-picker"
            onPress={() => setPickerOpen(true)}
            style={[styles.row, !notif && { opacity: 0.4 }]}
            disabled={!notif}
          >
            <Ionicons name="time-outline" size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Reminder time</Text>
              <Text style={styles.rowSub}>Default 19:30 · tap to change</Text>
            </View>
            <View style={styles.timeChip}>
              <Text style={styles.timeTxt}>{timeLabel}</Text>
              <Ionicons name="chevron-down" size={14} color="#fff" />
            </View>
          </TouchableOpacity>

          <View style={styles.row}>
            <Ionicons name="globe-outline" size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t("settings.language")}</Text>
              <Text style={styles.rowSub}>Auto · device: {locale.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <Ionicons name="eye-outline" size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t("settings.privacy")}</Text>
              <Text style={styles.rowSub}>Set per-aura when you post.</Text>
            </View>
          </View>

          <Text style={styles.footer}>InnFeel 1.0 · made with color</Text>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Reminder time</Text>
            <Text style={styles.modalSub}>Pick a time between 19:00 and 21:00 — your evening drop moment.</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {choices.map((c) => {
                const sel = c.hour === hour && c.minute === minute;
                return (
                  <TouchableOpacity
                    key={c.label}
                    testID={`time-${c.label}`}
                    onPress={() => pickTime(c.hour, c.minute)}
                    style={[styles.choice, sel && styles.choiceSel]}
                  >
                    <Text style={[styles.choiceTxt, sel && { color: "#000", fontWeight: "800" }]}>{c.label}</Text>
                    {sel ? <Ionicons name="checkmark" size={18} color="#000" /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity testID="time-close" onPress={() => setPickerOpen(false)} style={styles.modalClose}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontSize: 18, fontWeight: "600" },
  scroll: { padding: 20, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  rowTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: COLORS.border },
  timeTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  footer: { color: COLORS.textTertiary, textAlign: "center", marginTop: 30, fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#0A0A0C", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 40, borderTopWidth: 1, borderColor: COLORS.border },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  modalSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: 16 },
  choice: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8, backgroundColor: "rgba(255,255,255,0.03)" },
  choiceSel: { backgroundColor: "#fff", borderColor: "#fff" },
  choiceTxt: { color: "#fff", fontSize: 16, fontWeight: "600" },
  modalClose: { alignSelf: "center", marginTop: 8, paddingHorizontal: 24, paddingVertical: 10 },
});
