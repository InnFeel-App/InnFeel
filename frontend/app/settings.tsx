import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RadialAura from "../src/components/RadialAura";
import { COLORS } from "../src/theme";
import { t } from "../src/i18n";
import { Ionicons } from "@expo/vector-icons";
import * as Localization from "expo-localization";

export default function Settings() {
  const router = useRouter();
  const [notif, setNotif] = React.useState(true);
  const locale = Localization.getLocales?.()[0]?.languageCode || "en";

  return (
    <View style={styles.container} testID="settings-screen">
      <RadialAura color="#60A5FA" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity testID="settings-back" onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t("settings.title")}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.row}>
            <Ionicons name="notifications-outline" size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t("settings.notifications")}</Text>
              <Text style={styles.rowSub}>Once a day, gently, in your evening.</Text>
            </View>
            <Switch testID="notif-toggle" value={notif} onValueChange={setNotif} />
          </View>

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
              <Text style={styles.rowSub}>Set per-drop when you post.</Text>
            </View>
          </View>

          <Text style={styles.footer}>MoodDrop 1.0 · made with color</Text>
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
  scroll: { padding: 20, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  rowTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  footer: { color: COLORS.textTertiary, textAlign: "center", marginTop: 30, fontSize: 12 },
});
