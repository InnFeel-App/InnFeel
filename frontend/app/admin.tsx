import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

const DAY_PRESETS = [7, 14, 30, 90, 365];

type Grant = {
  grant_id: string;
  granted_to_email: string;
  granted_to_name: string;
  granted_by_email: string;
  days: number;
  expires_at: string;
  note?: string | null;
  created_at: string;
  revoked: boolean;
  is_active: boolean;
  days_remaining: number;
};

export default function AdminPanel() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [days, setDays] = useState<number>(30);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api<{ grants: Grant[] }>("/admin/pro-grants");
      setGrants(r.grants || []);
    } catch (e: any) {
      Alert.alert("Load failed", e.message || "");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (searchQ.trim().length < 2) { setSearchResults([]); return; }
    const id = setTimeout(async () => {
      try {
        const r = await api<{ users: any[] }>(`/admin/users/search?q=${encodeURIComponent(searchQ.trim())}`);
        setSearchResults(r.users || []);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(id);
  }, [searchQ]);

  const grant = async () => {
    if (!email.trim()) { Alert.alert("Missing email", "Enter a user email first."); return; }
    if (!days || days < 1) { Alert.alert("Invalid duration", "Set at least 1 day."); return; }
    setLoading(true);
    try {
      const r = await api<{ user: any; pro_expires_at: string }>("/admin/grant-pro", {
        method: "POST",
        body: { email: email.trim().toLowerCase(), days, note: note.trim() || null },
      });
      Alert.alert(
        "✦ Pro granted",
        `${r.user.name || r.user.email} now has Pro until ${new Date(r.pro_expires_at).toLocaleDateString()}.`,
      );
      setEmail(""); setNote(""); setSearchQ(""); setSearchResults([]);
      await load();
    } catch (e: any) {
      Alert.alert("Grant failed", e.message || "");
    } finally { setLoading(false); }
  };

  const revoke = (targetEmail: string) => {
    Alert.alert("Revoke Pro?", `This will immediately remove Pro from ${targetEmail}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: async () => {
          try {
            await api("/admin/revoke-pro", { method: "POST", body: { email: targetEmail } });
            await load();
          } catch (e: any) {
            Alert.alert("Revoke failed", e.message || "");
          }
        },
      },
    ]);
  };

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (!user?.is_admin) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="lock-closed-outline" size={40} color={COLORS.textTertiary} />
          <Text style={styles.forbidTxt}>Admin access only.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.forbidBtn}>
            <Text style={styles.forbidBtnTxt}>Go back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const activeGrants = grants.filter((g) => g.is_active);
  const pastGrants = grants.filter((g) => !g.is_active);

  return (
    <View style={styles.container} testID="admin-panel">
      <RadialAura color="#FDE047" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile"); }} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Admin</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="sparkles" size={18} color="#FDE047" />
                <Text style={styles.cardTitle}>Gift Pro to a user</Text>
              </View>
              <Text style={styles.cardSub}>Useful for friends, beta testers, or promo campaigns. Pro auto-expires on the chosen date.</Text>

              <Text style={styles.label}>Target user (email)</Text>
              <TextInput
                testID="admin-email"
                value={email}
                onChangeText={(v) => { setEmail(v); setSearchQ(v); }}
                placeholder="name@example.com"
                placeholderTextColor="#555"
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              {searchResults.length > 0 && email.trim() && !searchResults.some((u) => u.email === email.trim().toLowerCase()) ? (
                <View style={styles.suggestBox}>
                  {searchResults.slice(0, 5).map((u) => (
                    <TouchableOpacity
                      key={u.user_id}
                      onPress={() => { setEmail(u.email); setSearchResults([]); setSearchQ(""); }}
                      style={styles.suggestRow}
                      testID={`suggest-${u.user_id}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestName}>{u.name || "(no name)"}</Text>
                        <Text style={styles.suggestEmail}>{u.email}</Text>
                      </View>
                      {u.pro ? (
                        <View style={styles.proMini}>
                          <Ionicons name="sparkles" size={9} color="#FACC15" />
                          <Text style={styles.proMiniTxt}>Pro</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <Text style={styles.label}>Duration</Text>
              <View style={styles.chips}>
                {DAY_PRESETS.map((d) => (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setDays(d)}
                    style={[styles.chip, days === d && styles.chipOn]}
                    testID={`days-${d}`}
                  >
                    <Text style={[styles.chipTxt, days === d && { color: "#000" }]}>
                      {d === 365 ? "1 year" : `${d}d`}
                    </Text>
                  </TouchableOpacity>
                ))}
                <View style={[styles.chip, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
                  <TextInput
                    testID="days-custom"
                    value={String(days)}
                    onChangeText={(v) => setDays(Math.max(1, Math.min(3650, parseInt(v || "0") || 0)))}
                    keyboardType="number-pad"
                    style={styles.chipInput}
                  />
                  <Text style={styles.chipTxt}>days</Text>
                </View>
              </View>
              <Text style={styles.expiresHint}>
                Will expire on {new Date(Date.now() + days * 86400000).toLocaleDateString()}
              </Text>

              <Text style={styles.label}>Note (optional, internal)</Text>
              <TextInput
                testID="admin-note"
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Launch promo · beta tester · friend"
                placeholderTextColor="#555"
                style={styles.input}
                maxLength={200}
              />

              <TouchableOpacity
                onPress={grant}
                disabled={loading}
                style={[styles.cta, loading && { opacity: 0.6 }]}
                testID="admin-grant"
              >
                <Ionicons name="sparkles" size={16} color="#000" />
                <Text style={styles.ctaTxt}>{loading ? "Granting…" : `Grant Pro · ${days} day${days > 1 ? "s" : ""}`}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.section}>Active grants · {activeGrants.length}</Text>
            {activeGrants.length === 0 ? (
              <Text style={styles.empty}>No active grants yet.</Text>
            ) : (
              activeGrants.map((g) => (
                <View key={g.grant_id} style={styles.grantRow} testID={`grant-${g.grant_id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.grantName}>{g.granted_to_name || g.granted_to_email}</Text>
                    <Text style={styles.grantEmail}>{g.granted_to_email}</Text>
                    <View style={styles.grantMeta}>
                      <View style={styles.grantBadge}>
                        <Ionicons name="time-outline" size={10} color="#FACC15" />
                        <Text style={styles.grantBadgeTxt}>{g.days_remaining}d left</Text>
                      </View>
                      <Text style={styles.grantDate}>Until {new Date(g.expires_at).toLocaleDateString()}</Text>
                    </View>
                    {g.note ? <Text style={styles.grantNote}>"{g.note}"</Text> : null}
                  </View>
                  <TouchableOpacity
                    onPress={() => revoke(g.granted_to_email)}
                    style={styles.revokeBtn}
                    testID={`revoke-${g.grant_id}`}
                  >
                    <Text style={styles.revokeTxt}>Revoke</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}

            {pastGrants.length > 0 ? (
              <>
                <Text style={[styles.section, { marginTop: 22 }]}>History · {pastGrants.length}</Text>
                {pastGrants.slice(0, 10).map((g) => (
                  <View key={g.grant_id} style={[styles.grantRow, { opacity: 0.55 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.grantName}>{g.granted_to_name || g.granted_to_email}</Text>
                      <Text style={styles.grantEmail}>{g.granted_to_email}</Text>
                      <Text style={styles.grantDate}>
                        {g.revoked ? "Revoked" : "Expired"} · was {g.days}d
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontWeight: "800", fontSize: 18 },
  card: { padding: 18, borderRadius: 22, borderWidth: 1, borderColor: "rgba(253,224,71,0.25)", backgroundColor: "rgba(253,224,71,0.05)" },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  cardSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 6, marginBottom: 12 },
  label: { color: COLORS.textTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: COLORS.border },
  suggestBox: { marginTop: 8, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, overflow: "hidden" },
  suggestRow: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  suggestName: { color: "#fff", fontWeight: "600", fontSize: 13 },
  suggestEmail: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  proMini: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(250,204,21,0.12)" },
  proMiniTxt: { color: "#FACC15", fontSize: 9, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  chipOn: { backgroundColor: "#FDE047", borderColor: "#FDE047" },
  chipTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
  chipInput: { color: "#fff", minWidth: 36, paddingVertical: 0, fontSize: 12, fontWeight: "700" },
  expiresHint: { color: COLORS.textTertiary, fontSize: 11, marginTop: 8, fontStyle: "italic" },
  cta: { marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FDE047", paddingVertical: 14, borderRadius: 16 },
  ctaTxt: { color: "#000", fontWeight: "800", fontSize: 14 },
  section: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginTop: 24, marginBottom: 10 },
  empty: { color: COLORS.textTertiary, fontSize: 13, fontStyle: "italic" },
  grantRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 8 },
  grantName: { color: "#fff", fontWeight: "700", fontSize: 14 },
  grantEmail: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  grantMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  grantBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(250,204,21,0.12)", borderWidth: 1, borderColor: "rgba(250,204,21,0.3)" },
  grantBadgeTxt: { color: "#FACC15", fontSize: 10, fontWeight: "800" },
  grantDate: { color: COLORS.textTertiary, fontSize: 10 },
  grantNote: { color: COLORS.textSecondary, fontSize: 11, marginTop: 6, fontStyle: "italic" },
  revokeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.08)" },
  revokeTxt: { color: "#FCA5A5", fontSize: 11, fontWeight: "700" },
  forbidTxt: { color: "#fff", fontSize: 18, marginTop: 12 },
  forbidBtn: { marginTop: 20, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: "#fff" },
  forbidBtnTxt: { color: "#000", fontWeight: "700" },
});
