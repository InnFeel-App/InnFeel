import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl, Linking, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import RadialAura from "../../src/components/RadialAura";
import Button from "../../src/components/Button";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { COLORS } from "../../src/theme";
import { t } from "../../src/i18n";
import { Ionicons } from "@expo/vector-icons";

export default function Friends() {
  const router = useRouter();
  const { user } = useAuth();
  const pro = !!user?.pro;
  const [friends, setFriends] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const closeCount = friends.filter((f) => f.is_close).length;

  const inviteText = `Hey! I'm on MoodDrop — we share our mood once a day in color. Join me: https://mooddrop.app ✦${user?.email ? ` (add me: ${user.email})` : ""}`;

  const inviteWhatsApp = async () => {
    const url = `whatsapp://send?text=${encodeURIComponent(inviteText)}`;
    const ok = await Linking.canOpenURL(url);
    if (ok) { Linking.openURL(url); return; }
    // Fallback to wa.me universal link
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(inviteText)}`);
  };

  const inviteGeneric = async () => {
    try { await Share.share({ message: inviteText }); } catch {}
  };

  const load = useCallback(async () => {
    try { const r = await api<any>("/friends"); setFriends(r.friends || []); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    setErr(null);
    try {
      await api("/friends/add", { method: "POST", body: { email: email.trim() } });
      setEmail("");
      await load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = (friend_id: string) => {
    Alert.alert("Remove friend?", "They will no longer see your drops.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => { try { await api(`/friends/${friend_id}`, { method: "DELETE" }); await load(); } catch {} } },
    ]);
  };

  const toggleClose = async (friend_id: string, currentlyClose: boolean) => {
    if (!pro) {
      Alert.alert(
        "Close friends ✦ Pro",
        "Mark your inner circle and share moods with just them using the Close privacy option.",
        [
          { text: "Later", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/paywall") },
        ],
      );
      return;
    }
    // optimistic toggle
    setTogglingId(friend_id);
    setFriends((list) => list.map((f) => (f.user_id === friend_id ? { ...f, is_close: !currentlyClose } : f)));
    try {
      await api(`/friends/close/${friend_id}`, { method: "POST" });
    } catch (e: any) {
      // revert
      setFriends((list) => list.map((f) => (f.user_id === friend_id ? { ...f, is_close: currentlyClose } : f)));
      Alert.alert("Oops", e.message || "Could not update close friend");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <View style={styles.container} testID="friends-screen">
      <RadialAura color="#2DD4BF" />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#fff" />}>
          <Text style={styles.title}>{t("friends.title")}</Text>

          <View style={styles.addRow}>
            <TextInput
              testID="friend-email"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              placeholder={t("friends.addByEmail")}
              placeholderTextColor="#555"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity testID="add-friend-btn" onPress={add} style={styles.addBtn}>
              <Ionicons name="add" size={22} color="#000" />
            </TouchableOpacity>
          </View>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Text style={styles.hint}>Try: luna@mooddrop.app · rio@mooddrop.app · sage@mooddrop.app</Text>

          <View style={styles.inviteRow}>
            <TouchableOpacity testID="invite-whatsapp" onPress={inviteWhatsApp} style={[styles.inviteBtn, { backgroundColor: "#25D366" }]}>
              <Ionicons name="logo-whatsapp" size={18} color="#fff" />
              <Text style={styles.inviteTxt}>Invite via WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="invite-share" onPress={inviteGeneric} style={[styles.inviteBtn, { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: COLORS.border }]}>
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={styles.inviteTxt}>More</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 20 }} />
          <View style={styles.sectionHdr}>
            <Text style={styles.sectionTxt}>Your circle {friends.length > 0 ? `· ${friends.length}` : ""}</Text>
            {friends.length > 0 ? (
              <View style={styles.closeBadge}>
                <Ionicons name="star" size={11} color="#FACC15" />
                <Text style={styles.closeBadgeTxt}>{closeCount} close{!pro ? " · Pro ✦" : ""}</Text>
              </View>
            ) : null}
          </View>
          {friends.length === 0 ? (
            <Text style={styles.empty}>No friends yet. Add someone by email to start sharing moods.</Text>
          ) : friends.map((f) => (
            <View key={f.user_id} style={[styles.row, f.is_close && styles.rowClose]} testID={`friend-${f.user_id}`}>
              <View style={[styles.avatar, { backgroundColor: f.avatar_color || "#A78BFA" }]}>
                <Text style={styles.avatarTxt}>{(f.name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.name}>{f.name}</Text>
                  {f.is_close ? (
                    <View style={styles.closeTag}>
                      <Ionicons name="star" size={9} color="#FACC15" />
                      <Text style={styles.closeTagTxt}>Close</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.email}>{f.email}</Text>
              </View>
              <View style={[styles.statusPill, f.dropped_today ? styles.pillGreen : styles.pillGray]}>
                <Text style={styles.pillTxt}>{f.dropped_today ? t("friends.dropped") : t("friends.notDropped")}</Text>
              </View>
              <TouchableOpacity
                onPress={() => toggleClose(f.user_id, !!f.is_close)}
                style={[styles.starBtn, f.is_close && styles.starBtnActive]}
                testID={`toggle-close-${f.user_id}`}
                disabled={togglingId === f.user_id}
              >
                <Ionicons
                  name={f.is_close ? "star" : "star-outline"}
                  size={16}
                  color={f.is_close ? "#FACC15" : COLORS.textTertiary}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(f.user_id)} style={styles.removeBtn} testID={`remove-${f.user_id}`}>
                <Ionicons name="close" size={18} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  scroll: { padding: 20, paddingTop: 12 },
  title: { color: "#fff", fontSize: 32, fontWeight: "700", letterSpacing: -0.5, marginBottom: 20 },
  addRow: { flexDirection: "row", gap: 10 },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", borderWidth: 1, borderColor: COLORS.border },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  err: { color: "#F87171", marginTop: 8 },
  hint: { color: COLORS.textTertiary, fontSize: 11, marginTop: 8 },
  inviteRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  inviteBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 16 },
  inviteTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
  sectionHdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTxt: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  closeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(250,204,21,0.10)", borderWidth: 1, borderColor: "rgba(250,204,21,0.28)" },
  closeBadgeTxt: { color: "#FACC15", fontSize: 10, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
  rowClose: { borderColor: "rgba(250,204,21,0.45)", backgroundColor: "rgba(250,204,21,0.05)" },
  closeTag: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(250,204,21,0.15)", borderWidth: 1, borderColor: "rgba(250,204,21,0.35)" },
  closeTagTxt: { color: "#FACC15", fontSize: 9, fontWeight: "700" },
  starBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: COLORS.border },
  starBtnActive: { backgroundColor: "rgba(250,204,21,0.12)", borderColor: "rgba(250,204,21,0.45)" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#000", fontWeight: "800", fontSize: 16 },
  name: { color: "#fff", fontWeight: "600" },
  email: { color: COLORS.textTertiary, fontSize: 12, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillGreen: { backgroundColor: "rgba(52,211,153,0.15)", borderWidth: 1, borderColor: "rgba(52,211,153,0.4)" },
  pillGray: { backgroundColor: "rgba(255,255,255,0.06)" },
  pillTxt: { color: "#fff", fontSize: 10, fontWeight: "600" },
  removeBtn: { padding: 4 },
});
