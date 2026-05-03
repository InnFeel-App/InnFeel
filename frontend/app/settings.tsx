import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Modal, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RadialAura from "../src/components/RadialAura";
import { COLORS } from "../src/theme";
import {
  t,
  useI18n,
  LANGUAGE_OPTIONS,
  LocaleCode,
  setLocaleOverride,
  currentLocale,
  loadLocaleOverride,
} from "../src/i18n";
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

export default function Settings() {
  const router = useRouter();
  useI18n(); // re-render on locale change
  const [prefs, setPrefs] = useState<Record<NotifCategory, boolean>>({
    reminder: true, reaction: true, message: true, friend: true,
  });
  const [langOpen, setLangOpen] = useState(false);
  const [overrideCode, setOverrideCode] = useState<LocaleCode | null>(null);
  const deviceLocale = (Localization.getLocales?.()[0]?.languageCode || "en").toLowerCase();

  useEffect(() => {
    (async () => {
      setPrefs(await getAllPrefs());
      const ov = await loadLocaleOverride();
      setOverrideCode(ov);
    })();
  }, []);

  const toggle = async (cat: NotifCategory, value: boolean) => {
    setPrefs((p) => ({ ...p, [cat]: value }));
    await setCategoryEnabled(cat, value);
  };

  const pickLocale = async (code: LocaleCode | null) => {
    setOverrideCode(code);
    await setLocaleOverride(code);
    setLangOpen(false);
  };

  const currentLangLabel = useMemo(() => {
    if (!overrideCode) return `${t("settings.language.auto")} · ${deviceLocale.toUpperCase()}`;
    const opt = LANGUAGE_OPTIONS.find((o) => o.code === overrideCode);
    return opt ? opt.native : overrideCode.toUpperCase();
  }, [overrideCode, deviceLocale]);

  // Localized notif rows (rebuild on locale change)
  const ROWS: PrefRow[] = [
    {
      key: "reminder",
      icon: "sparkles",
      color: "#FACC15",
      title: t("settings.notif.reminder"),
      sub: t("settings.notif.reminder.sub"),
    },
    {
      key: "reaction",
      icon: "heart",
      color: "#EC4899",
      title: t("settings.notif.reaction"),
      sub: t("settings.notif.reaction.sub"),
    },
    {
      key: "message",
      icon: "chatbubble",
      color: "#38BDF8",
      title: t("settings.notif.message"),
      sub: t("settings.notif.message.sub"),
    },
    {
      key: "friend",
      icon: "people",
      color: "#A855F7",
      title: t("settings.notif.friend"),
      sub: t("settings.notif.friend.sub"),
    },
  ];

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
          <Text style={styles.sectionTitle}>{t("settings.section.notifications")}</Text>
          <Text style={styles.sectionSub}>{t("settings.notifications.sub")}</Text>

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

          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>{t("settings.section.other")}</Text>

          <TouchableOpacity
            testID="settings-account-row"
            style={styles.row}
            onPress={() => router.push("/account")}
            activeOpacity={0.8}
          >
            <View style={[styles.iconBox, { backgroundColor: "rgba(168,85,247,0.15)", borderColor: "rgba(168,85,247,0.35)" }]}>
              <Ionicons name="person-circle-outline" size={18} color="#A855F7" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Account</Text>
              <Text style={styles.rowSub}>Name, email, data export, delete</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-language-row"
            style={styles.row}
            onPress={() => setLangOpen(true)}
            activeOpacity={0.8}
          >
            <View style={[styles.iconBox, { backgroundColor: "rgba(56,189,248,0.15)", borderColor: "rgba(56,189,248,0.35)" }]}>
              <Ionicons name="globe-outline" size={18} color="#38BDF8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t("settings.language")}</Text>
              <Text style={styles.rowSub}>{currentLangLabel}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: "rgba(167,139,250,0.15)", borderColor: "rgba(167,139,250,0.35)" }]}>
              <Ionicons name="eye-outline" size={18} color="#A78BFA" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t("settings.privacy")}</Text>
              <Text style={styles.rowSub}>{t("settings.privacy.sub")}</Text>
            </View>
          </View>

          <Text style={styles.footer}>{t("settings.footer")}</Text>

          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => router.push("/legal/terms")} testID="settings-terms-link">
              <Text style={styles.legalLink}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.legalSep}> · </Text>
            <TouchableOpacity onPress={() => router.push("/legal/privacy")} testID="settings-privacy-link">
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Language picker */}
      <Modal
        visible={langOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLangOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setLangOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>{t("settings.language")}</Text>
              <TouchableOpacity onPress={() => setLangOpen(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              testID="lang-auto"
              style={[styles.langRow, overrideCode === null && styles.langRowActive]}
              onPress={() => pickLocale(null)}
            >
              <Text style={styles.langLabel}>{t("settings.language.auto")}</Text>
              <Text style={styles.langSub}>{deviceLocale.toUpperCase()}</Text>
              {overrideCode === null && <Ionicons name="checkmark-circle" size={20} color="#22D3EE" />}
            </TouchableOpacity>
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = overrideCode === opt.code;
              return (
                <TouchableOpacity
                  key={opt.code}
                  testID={`lang-${opt.code}`}
                  style={[styles.langRow, active && styles.langRowActive]}
                  onPress={() => pickLocale(opt.code)}
                >
                  <Text style={styles.langLabel}>{opt.native}</Text>
                  <Text style={styles.langSub}>{opt.label}</Text>
                  {active && <Ionicons name="checkmark-circle" size={20} color="#22D3EE" />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
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

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#0B0B0F", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32, borderWidth: 1, borderColor: COLORS.border },
  sheetHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sheetTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  langRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: "transparent", marginBottom: 6 },
  langRowActive: { backgroundColor: "rgba(34,211,238,0.08)", borderColor: "rgba(34,211,238,0.35)" },
  langLabel: { color: "#fff", fontSize: 15, fontWeight: "600", flex: 1 },
  langSub: { color: COLORS.textSecondary, fontSize: 12, marginRight: 10 },
  legalRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 12 },
  legalLink: { color: "#60A5FA", fontSize: 12, textDecorationLine: "underline" },
  legalSep: { color: COLORS.textTertiary, fontSize: 12 },
});
