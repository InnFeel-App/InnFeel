import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Share, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

type Match = {
  user_id: string; email: string; name: string; avatar_color?: string; avatar_b64?: string; is_friend: boolean;
};

export default function ContactsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<"granted" | "denied" | "unknown">("unknown");
  const [matches, setMatches] = useState<Match[]>([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") { setPermission("denied"); setLoading(false); return; }
      setPermission("granted");
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Emails] });
      // Flatten all emails (a contact may have several)
      const emails = new Set<string>();
      for (const c of data || []) {
        for (const e of (c.emails || [])) {
          const addr = (e?.email || "").trim().toLowerCase();
          if (addr && addr.includes("@")) emails.add(addr);
        }
      }
      setTotalScanned(emails.size);
      if (emails.size === 0) { setMatches([]); setLoading(false); return; }
      const resp = await api<{ matches: Match[] }>("/friends/match-contacts", {
        method: "POST",
        body: { emails: Array.from(emails) },
      });
      setMatches(resp.matches || []);
    } catch (e: any) {
      Alert.alert("Contacts error", e?.message || "Could not read contacts.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const addFriend = async (m: Match) => {
    if (m.is_friend) return;
    setAdding(m.user_id);
    try {
      await api("/friends/add", { method: "POST", body: { email: m.email } });
      setMatches((prev) => prev.map((x) => x.user_id === m.user_id ? { ...x, is_friend: true } : x));
    } catch (e: any) {
      Alert.alert("Add failed", e?.message || "Try again.");
    } finally { setAdding(null); }
  };

  const inviteMessage = `Hey! I'm on InnFeel — we share our aura once a day in color. Join me: https://innfeel.app ✦${user?.email ? ` (add me: ${user.email})` : ""}`;
  const invite = async () => { try { await Share.share({ message: inviteMessage }); } catch {} };

  return (
    <View style={styles.container} testID="contacts-screen">
      <RadialAura color="#8B5CF6" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/friends"))} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>From contacts</Text>
          <TouchableOpacity onPress={scan} style={styles.back}>
            <Ionicons name="refresh" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.loadingTxt}>Looking for friends already on InnFeel…</Text>
          </View>
        ) : permission === "denied" ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="people-circle-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyTitle}>Contacts access needed</Text>
            <Text style={styles.emptyBody}>We only use your contacts to find which of your friends already have InnFeel. Your contacts are never stored or shared.</Text>
            <TouchableOpacity style={styles.ctaBtn} onPress={scan}>
              <Text style={styles.ctaBtnTxt}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : matches.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="search-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyTitle}>None of your contacts are on InnFeel yet</Text>
            <Text style={styles.emptyBody}>We scanned {totalScanned} contact{totalScanned === 1 ? "" : "s"} with emails. Invite someone to get started.</Text>
            <TouchableOpacity style={styles.ctaBtn} onPress={invite}>
              <Ionicons name="share-outline" size={16} color="#000" />
              <Text style={styles.ctaBtnTxt}>Invite friends</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={matches}
            keyExtractor={(m) => m.user_id}
            contentContainerStyle={{ padding: 16 }}
            ListHeaderComponent={
              <Text style={styles.resultHdr}>
                {matches.length} of your contact{matches.length === 1 ? "" : "s"} {matches.length === 1 ? "is" : "are"} on InnFeel
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row} testID={`contact-${item.user_id}`}>
                <View style={[styles.avatar, { backgroundColor: item.avatar_color || "#A78BFA" }]}>
                  {item.avatar_b64 ? (
                    <Image source={{ uri: `data:image/jpeg;base64,${item.avatar_b64}` }} style={{ width: 44, height: 44 }} />
                  ) : (
                    <Text style={styles.avatarTxt}>{(item.name || item.email || "?").slice(0, 1).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.name || item.email.split("@")[0]}</Text>
                  <Text style={styles.rowEmail}>{item.email}</Text>
                </View>
                {item.is_friend ? (
                  <View style={[styles.addBtn, styles.addedBtn]}>
                    <Ionicons name="checkmark" size={16} color="#34D399" />
                    <Text style={styles.addedTxt}>Friend</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID={`add-${item.user_id}`}
                    onPress={() => addFriend(item)}
                    disabled={adding === item.user_id}
                    style={styles.addBtn}
                  >
                    <Ionicons name="add" size={16} color="#000" />
                    <Text style={styles.addTxt}>{adding === item.user_id ? "…" : "Add"}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            ListFooterComponent={
              <TouchableOpacity style={[styles.ctaBtn, { alignSelf: "center", marginTop: 20 }]} onPress={invite}>
                <Ionicons name="share-outline" size={16} color="#000" />
                <Text style={styles.ctaBtnTxt}>Invite more friends</Text>
              </TouchableOpacity>
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontSize: 18, fontWeight: "600" },
  loadingTxt: { color: COLORS.textSecondary, marginTop: 14, fontSize: 13 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "600", textAlign: "center", marginTop: 6 },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center", marginBottom: 10 },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14 },
  ctaBtnTxt: { color: "#000", fontWeight: "700", fontSize: 14 },
  resultHdr: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700", marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 8 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarTxt: { color: "#000", fontWeight: "800", fontSize: 16 },
  rowName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowEmail: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  addTxt: { color: "#000", fontWeight: "700", fontSize: 13 },
  addedBtn: { backgroundColor: "rgba(52,211,153,0.1)", borderWidth: 1, borderColor: "rgba(52,211,153,0.4)" },
  addedTxt: { color: "#34D399", fontWeight: "700", fontSize: 13 },
});
