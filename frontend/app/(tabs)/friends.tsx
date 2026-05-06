import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl, Animated, Easing, Share, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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
  // Stable, share-safe invite code per user. Replaces the previous practice
  // of pasting the user's email into WhatsApp/SMS messages — protects user
  // privacy (other people won't see the email) and lets the recipient be
  // added with a single tap on the deep link.
  const [myCode, setMyCode] = useState<string | null>(null);

  const closeCount = friends.filter((f) => f.is_close).length;

  // Universal link → opens https://innfeel.app/add/{code} which redirects to
  // the app via App/Universal Links (or innfeel://add/{code} if the user is
  // already on a device with the app installed).
  const inviteLink = myCode ? `https://innfeel.app/add/${myCode}` : "https://innfeel.app";
  const inviteText = myCode
    ? `Hey! I'm on InnFeel — we share our aura once a day in color. Tap to add me: ${inviteLink} ✦`
    : `Hey! I'm on InnFeel — we share our aura once a day in color. Join me: https://innfeel.app ✦`;

  const shareInvite = async () => {
    try { await Share.share({ message: inviteText }); } catch {}
  };

  // ── Animations for the share-code button ───────────────────────────────
  // - Glow pulse: outer ring breathes between 60% and 100% opacity (1.6 s)
  // - Shimmer:   gradient sweeps the pill horizontally (3.5 s loop)
  // - Press:     subtle scale-down for tactile feedback
  const glowPulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(glowPulse, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    ).start();
    Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 3500, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, [glowPulse, shimmer]);
  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.95] });
  const glowScale = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.06] });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-220, 220] });

  const load = useCallback(async () => {
    try { const r = await api<any>("/friends"); setFriends(r.friends || []); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Lazily fetch the invite code once (the backend creates one on demand).
  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ code: string }>("/friends/my-code");
        if (r?.code) setMyCode(r.code);
      } catch {}
    })();
  }, []);

  const add = async () => {
    setErr(null);
    const raw = email.trim();
    if (!raw) return;
    try {
      // Smart input: if it doesn't look like an email it's almost certainly
      // an invite code → call /friends/add-by-code instead. Codes are also
      // upper-cased for the user since the backend stores them uppercase.
      const looksLikeEmail = /@/.test(raw);
      if (looksLikeEmail) {
        await api("/friends/add", { method: "POST", body: { email: raw.toLowerCase() } });
      } else {
        await api("/friends/add-by-code", { method: "POST", body: { code: raw.toUpperCase() } });
      }
      setEmail("");
      await load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = (friend_id: string) => {
    Alert.alert("Remove friend?", "They will no longer see your auras.", [
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
              placeholder="Add by code or email"
              placeholderTextColor="#555"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity testID="add-friend-btn" onPress={add} style={styles.addBtn}>
              <Ionicons name="add" size={22} color="#000" />
            </TouchableOpacity>
          </View>
          {err ? <Text style={styles.err}>{err}</Text> : null}

          {/* Privacy-safe share-my-code hero button.
              Replaces the previous WhatsApp + Generic share buttons AND the
              tiny code pill — one big, glowing CTA that opens the OS share
              sheet (which already shows WhatsApp, SMS, Mail, AirDrop, etc.). */}
          {myCode ? (
            <View style={styles.shareWrap}>
              {/* Pulsing glow halo behind the pill — pure visual flourish. */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.shareGlow,
                  { opacity: glowOpacity, transform: [{ scale: glowScale }] },
                ]}
              >
                <LinearGradient
                  colors={["#A78BFA", "#F472B6", "#FACC15", "#34D399"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <Pressable
                testID="my-invite-code"
                accessibilityRole="button"
                accessibilityLabel={`Share your invite code ${myCode}`}
                onPress={shareInvite}
                onPressIn={() => Animated.spring(press, { toValue: 0.97, useNativeDriver: true }).start()}
                onPressOut={() => Animated.spring(press, { toValue: 1, friction: 4, useNativeDriver: true }).start()}
              >
                <Animated.View style={{ transform: [{ scale: press }] }}>
                  <LinearGradient
                    colors={["#1B1331", "#2A1846", "#1B1331"]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.shareBtn}
                  >
                    {/* Diagonal shimmer streak that sweeps across the pill. */}
                    <Animated.View
                      pointerEvents="none"
                      style={[styles.shareShimmer, { transform: [{ translateX: shimmerX }] }]}
                    >
                      <LinearGradient
                        colors={["transparent", "rgba(255,255,255,0.18)", "transparent"]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </Animated.View>
                    <View style={styles.shareInner}>
                      <View style={styles.shareIconChip}>
                        <Ionicons name="share-outline" size={20} color="#0E0A1F" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.shareKicker}>Share your code</Text>
                        <Text style={styles.shareCode} numberOfLines={1}>
                          {myCode}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.5)" />
                    </View>
                  </LinearGradient>
                </Animated.View>
              </Pressable>
              <Text style={styles.shareHint}>Tap to invite — opens your share sheet ✦</Text>
            </View>
          ) : null}

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
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{f.name}</Text>
                {typeof f.streak === "number" && f.streak > 0 ? (
                  <Text style={styles.streakTxt}>{f.streak}🔥</Text>
                ) : null}
              </View>
              <View style={[styles.statusPill, f.dropped_today ? styles.pillGreen : styles.pillGray]}>
                <Ionicons
                  name={f.dropped_today ? "checkmark-circle" : "ellipse-outline"}
                  size={11}
                  color={f.dropped_today ? "#22C55E" : COLORS.textTertiary}
                />
                <Text style={styles.pillTxt}>{f.dropped_today ? "Posted" : "Waiting"}</Text>
              </View>
              <TouchableOpacity
                onPress={() => toggleClose(f.user_id, !!f.is_close)}
                style={[styles.starBtn, f.is_close && styles.starBtnActive]}
                testID={`toggle-close-${f.user_id}`}
                disabled={togglingId === f.user_id}
                hitSlop={6}
              >
                <Ionicons
                  name={f.is_close ? "star" : "star-outline"}
                  size={16}
                  color={f.is_close ? "#FACC15" : COLORS.textTertiary}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(f.user_id)} style={styles.removeBtn} testID={`remove-${f.user_id}`} hitSlop={6}>
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
  // ── Share-my-code hero button ─────────────────────────────────────────
  // Big, animated, halo-glowing pill that opens the OS share sheet.
  // Replaces the old "WhatsApp" + "More" buttons + tiny pill trio.
  shareWrap: { marginTop: 18, alignItems: "center" },
  shareGlow: {
    position: "absolute",
    top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 28,
    overflow: "hidden",
  },
  shareBtn: {
    width: "100%",
    minHeight: 76,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  shareShimmer: {
    position: "absolute",
    top: 0, bottom: 0,
    width: 140,
  },
  shareInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  shareIconChip: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FACC15",
  },
  shareKicker: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  shareCode: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 4,
  },
  shareHint: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 10,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  // Legacy styles (codePill / inviteBtn) kept in case future code references
  // them, but are no longer rendered anywhere.
  codePill: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: "rgba(250,204,21,0.10)",
    borderWidth: 1, borderColor: "rgba(250,204,21,0.35)",
  },
  codePillLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  codePillValue: { color: "#FACC15", fontSize: 14, fontWeight: "800", letterSpacing: 2 },
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
  name: { color: "#fff", fontWeight: "600", flexShrink: 1 },
  email: { color: COLORS.textTertiary, fontSize: 12, marginTop: 2 },
  streakTxt: { color: "#FB923C", fontSize: 12, fontWeight: "700", marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, flexShrink: 0 },
  pillGreen: { backgroundColor: "rgba(52,211,153,0.15)", borderWidth: 1, borderColor: "rgba(52,211,153,0.4)" },
  pillGray: { backgroundColor: "rgba(255,255,255,0.06)" },
  pillTxt: { color: "#fff", fontSize: 10, fontWeight: "600" },
  removeBtn: { padding: 4 },
});
