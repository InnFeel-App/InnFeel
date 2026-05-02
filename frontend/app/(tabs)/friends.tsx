import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import RadialAura from "../../src/components/RadialAura";
import Button from "../../src/components/Button";
import { api } from "../../src/api";
import { COLORS } from "../../src/theme";
import { t } from "../../src/i18n";
import { Ionicons } from "@expo/vector-icons";

export default function Friends() {
  const [friends, setFriends] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

          <View style={{ height: 20 }} />
          {friends.length === 0 ? (
            <Text style={styles.empty}>No friends yet. Add someone by email to start sharing moods.</Text>
          ) : friends.map((f) => (
            <View key={f.user_id} style={styles.row} testID={`friend-${f.user_id}`}>
              <View style={[styles.avatar, { backgroundColor: f.avatar_color || "#A78BFA" }]}>
                <Text style={styles.avatarTxt}>{(f.name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{f.name}</Text>
                <Text style={styles.email}>{f.email}</Text>
              </View>
              <View style={[styles.statusPill, f.dropped_today ? styles.pillGreen : styles.pillGray]}>
                <Text style={styles.pillTxt}>{f.dropped_today ? t("friends.dropped") : t("friends.notDropped")}</Text>
              </View>
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
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
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
