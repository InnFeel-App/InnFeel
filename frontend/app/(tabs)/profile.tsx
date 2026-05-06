import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import RadialAura from "../../src/components/RadialAura";
import Button from "../../src/components/Button";
import { useAuth } from "../../src/auth";
import { api } from "../../src/api";
import { uploadMedia } from "../../src/media";
import { COLORS } from "../../src/theme";
import { t } from "../../src/i18n";
import { Ionicons } from "@expo/vector-icons";

export default function Profile() {
  const router = useRouter();
  const { user, logout, refresh } = useAuth();

  const togglePro = async () => {
    try { await api("/dev/toggle-pro", { method: "POST" }); await refresh(); } catch {}
  };

  const changeAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permission needed", "We need photo access to update your profile picture."); return; }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (r.canceled || !r.assets?.[0]?.uri) return;
      const key = await uploadMedia("avatar", r.assets[0].uri, "image/jpeg");
      await api("/profile/avatar", { method: "POST", body: { avatar_key: key } });
      await refresh();
      Alert.alert("Updated ✦", "Your profile picture is live.");
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message || "Please try again.");
    }
  };

  return (
    <View style={styles.container} testID="profile-screen">
      <RadialAura color={user?.avatar_color || "#A78BFA"} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <TouchableOpacity testID="change-avatar" onPress={changeAvatar} activeOpacity={0.85}>
              <View style={[styles.avatar, { backgroundColor: user?.avatar_color || "#A78BFA" }]}>
                {(user as any)?.avatar_url ? (
                  <Image source={{ uri: (user as any).avatar_url }} style={styles.avatarImg} />
                ) : (user as any)?.avatar_b64 ? (
                  <Image source={{ uri: `data:image/jpeg;base64,${(user as any).avatar_b64}` }} style={styles.avatarImg} />
                ) : (
                  <Text style={styles.avatarTxt}>{(user?.name || "?").slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={styles.editDot}>
                <Ionicons name="camera" size={14} color="#000" />
              </View>
            </TouchableOpacity>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            {user?.pro ? (
              <View style={styles.proBadge}>
                <Ionicons name="sparkles" size={14} color="#FDE047" />
                <Text style={styles.proBadgeTxt}>PRO</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statV}>{user?.streak || 0}</Text>
              <Text style={styles.statK}>streak</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statV}>{user?.friend_count || 0}</Text>
              <Text style={styles.statK}>friends</Text>
            </View>
          </View>

          {/* Wellness Coach + Journal links removed from here — they're now
              dedicated tab destinations under the Coach hub (/coach). */}

          <TouchableOpacity testID="go-friends" style={styles.link} onPress={() => router.push("/(tabs)/friends")}>
            <Ionicons name="people-outline" size={20} color="#34D399" />
            <Text style={styles.linkTxt}>Friends · Invite</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity testID="go-history" style={styles.link} onPress={() => router.push("/history")}>
            <Ionicons name="time-outline" size={20} color="#fff" />
            <Text style={styles.linkTxt}>{t("history.title")}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity testID="go-achievements" style={styles.link} onPress={() => router.push("/achievements")}>
            <Ionicons name="trophy-outline" size={20} color="#FACC15" />
            <Text style={styles.linkTxt}>Achievements · Leaderboard</Text>
          </TouchableOpacity>

          <TouchableOpacity testID="go-settings" style={styles.link} onPress={() => router.push("/settings")}>
            <Ionicons name="settings-outline" size={20} color="#fff" />
            <Text style={styles.linkTxt}>{t("profile.settings")}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity testID="go-stats" style={styles.link} onPress={() => router.push("/(tabs)/stats")}>
            <Ionicons name="stats-chart-outline" size={20} color="#fff" />
            <Text style={styles.linkTxt}>Stats</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
          </TouchableOpacity>

          {user?.is_admin ? (
            <TouchableOpacity testID="go-admin" style={[styles.link, styles.adminLink]} onPress={() => router.push("/admin" as any)}>
              <Ionicons name="sparkles" size={20} color="#FDE047" />
              <Text style={[styles.linkTxt, { color: "#FDE047", fontWeight: "700" }]}>Admin · Grant Pro</Text>
              <Ionicons name="chevron-forward" size={18} color="#FDE047" />
            </TouchableOpacity>
          ) : null}

          <View style={{ marginTop: 10, gap: 10 }}>
            {user?.pro ? (
              <View style={styles.proCard}>
                <Text style={styles.proTitle}>{t("profile.youArePro")} ✦</Text>
                <Text style={styles.proSub}>All features unlocked</Text>
              </View>
            ) : (
              <Button testID="go-paywall" label={t("profile.goPro")} onPress={() => router.push("/paywall")} />
            )}
            <TouchableOpacity testID="toggle-pro" onPress={togglePro} style={{ alignSelf: "center", padding: 8 }}>
              <Text style={{ color: COLORS.textTertiary, fontSize: 12 }}>
                [demo] {user?.pro ? "Disable Pro" : "Enable Pro without paying"}
              </Text>
            </TouchableOpacity>
            <Button testID="logout" variant="secondary" label={t("profile.logout")} onPress={async () => { await logout(); router.replace("/(auth)/login"); }} />
          </View>
          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  scroll: { padding: 20, paddingTop: 20 },
  header: { alignItems: "center", marginBottom: 24 },
  avatar: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden" },
  avatarImg: { width: 92, height: 92 },
  avatarTxt: { color: "#000", fontWeight: "800", fontSize: 36 },
  editDot: { position: "absolute", right: 0, bottom: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#050505" },
  name: { color: "#fff", fontSize: 24, fontWeight: "700" },
  email: { color: COLORS.textSecondary, marginTop: 2 },
  proBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(253,224,71,0.15)", borderWidth: 1, borderColor: "rgba(253,224,71,0.4)", borderRadius: 999 },
  proBadgeTxt: { color: "#FDE047", fontWeight: "700", fontSize: 11, letterSpacing: 1 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  statBox: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, padding: 16, alignItems: "center", backgroundColor: "rgba(255,255,255,0.03)" },
  statV: { color: "#fff", fontSize: 28, fontWeight: "700" },
  statK: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2, textTransform: "uppercase", letterSpacing: 1 },
  link: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
  adminLink: { borderColor: "rgba(253,224,71,0.35)", backgroundColor: "rgba(253,224,71,0.06)" },
  linkTxt: { color: "#fff", fontSize: 15, flex: 1 },
  proCard: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: "rgba(253,224,71,0.35)", backgroundColor: "rgba(253,224,71,0.07)", alignItems: "center" },
  proTitle: { color: "#FDE047", fontWeight: "700", fontSize: 18 },
  proSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
});
