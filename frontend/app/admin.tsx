import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

/**
 * Admin Panel — comprehensive user management.
 *
 * Layout
 * ──────
 *  • Top KPI strip (total users · Pro · Zen · DAU · WAU · moods today)
 *  • Search bar + tier filter chips (All · Free · Pro · Zen · Admin)
 *  • Sort selector (Recent · Active · Name · Email)
 *  • Paginated user list (40/page) — tap a row to open the detail sheet
 *  • Detail sheet: identity, plan, stats, audit grants, action buttons
 *
 * Server endpoints used:
 *   GET  /admin/stats/overview
 *   GET  /admin/users/list?q=&tier=&sort=&page=&page_size=
 *   GET  /admin/users/{user_id}
 *   POST /admin/grant-tier  {email|user_id, tier, days, note}
 *   POST /admin/revoke-tier {email|user_id}
 *   POST /admin/reset-quota {user_id}
 *   POST /admin/send-weekly-recap {email}
 *
 * UX notes
 * ────────
 *  • Search is debounced (300 ms) to keep the server polling sane.
 *  • The detail sheet refetches on every open — admins expect "live" data.
 *  • User_id is a one-tap copy with haptic-light confirmation toast.
 *  • Destructive actions (Revoke) require an OS-level confirm dialog.
 */

type UserRow = {
  user_id: string;
  email: string;
  name: string;
  tier: "free" | "pro" | "zen" | "admin";
  is_admin: boolean;
  pro: boolean;
  zen: boolean;
  pro_expires_at: string | null;
  pro_source: string | null;
  created_at: string | null;
  last_active_at: string | null;
  verified: boolean;
  language: string;
  current_streak: number;
};

type StatsOverview = {
  users: { total: number; free: number; pro: number; zen: number; admin: number; verified: number; new_7d: number; new_30d: number; dau: number; wau: number };
  moods: { total: number; today: number; last_7d: number };
  grants: { active: number };
  as_of: string;
};

type UserDetail = UserRow & {
  tier_label: string;
  device_locale?: string;
  timezone?: string;
  push_token_present: boolean;
  friend_code?: string;
  bio?: string;
  avatar_url?: string;
  pro_grant_note?: string;
  pro_granted_by?: string;
  stats: {
    moods_total: number;
    moods_7d: number;
    friends: number;
    current_streak: number;
    longest_streak: number;
    last_mood: { at: string | null; emotion: string | null; intensity: number | null } | null;
    coach_used_today: number;
    coach_used_lifetime: number;
  };
  grants: any[];
  meditation_trials_used: string[];
};

type TierFilter = "all" | "free" | "pro" | "zen" | "admin";
type SortKey = "recent" | "active" | "name" | "email";

// Compact human-readable date — admin doesn't care about milliseconds.
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}
function relAge(iso?: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d === 0) return "today";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  const y = (d / 365).toFixed(1);
  return `${y}y ago`;
}
const TIER_TINT: Record<string, string> = {
  zen:   "#A78BFA",
  pro:   "#22D3EE",
  free:  "#94A3B8",
  admin: "#F472B6",
};

export default function AdminPanel() {
  const router = useRouter();
  const { user, refresh } = useAuth();

  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Grant modal state. Tier picker, days slider via chips, optional note.
  const [grantOpen, setGrantOpen] = useState<null | { user_id: string; email: string; name: string }>(null);
  const [grantTier, setGrantTier] = useState<"pro" | "zen">("pro");
  const [grantDays, setGrantDays] = useState<number>(30);
  const [grantNote, setGrantNote] = useState<string>("");
  const [grantLoading, setGrantLoading] = useState(false);

  const debounceRef = useRef<any>(null);

  // Initial load + reload on filter changes (debounced for typing).
  const fetchUsers = useCallback(async (resetPage = true) => {
    setLoading(true);
    try {
      const usePage = resetPage ? 0 : page;
      const params = new URLSearchParams({
        q: q.trim(),
        tier,
        sort,
        page: String(usePage),
        page_size: "40",
      }).toString();
      const res = await api<{ users: UserRow[]; total: number; has_more: boolean; page: number }>(
        `/admin/users/list?${params}`
      );
      setUsers(res.users || []);
      setTotal(res.total);
      setHasMore(res.has_more);
      setPage(res.page);
    } catch (e: any) {
      Alert.alert("Load failed", e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [q, tier, sort, page]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api<StatsOverview>("/admin/stats/overview");
      setStats(s);
    } catch {}
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Initial users fetch on mount — separate from the debounced filter
  // effect below. Without this, StrictMode's effect double-invoke + the
  // 300ms timer can race in a way that no list ever loads on first paint.
  useEffect(() => {
    fetchUsers(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce text input → fetch on idle. Skips the very first render
  // because `useRef` `firstRender` stays true until after mount.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(true), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, tier, sort]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Pull-to-refresh — refreshes BOTH stats and user list.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchStats(), fetchUsers(true)]);
    setRefreshing(false);
  }, [fetchStats, fetchUsers]);

  const openDetail = useCallback(async (uid: string) => {
    setOpenUserId(uid);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await api<UserDetail>(`/admin/users/${uid}`);
      setDetail(d);
    } catch (e: any) {
      Alert.alert("Load failed", e?.message || String(e));
      setOpenUserId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => { setOpenUserId(null); setDetail(null); };

  const copyId = async (uid: string) => {
    await Clipboard.setStringAsync(uid);
    if (Platform.OS !== "web") Alert.alert("✓ Copied", `${uid}`);
    else Alert.alert("Copied to clipboard");
  };

  const doGrant = async () => {
    if (!grantOpen) return;
    setGrantLoading(true);
    try {
      await api("/admin/grant-tier", {
        method: "POST",
        body: {
          user_id: grantOpen.user_id,
          tier: grantTier,
          days: grantDays,
          note: grantNote || null,
        },
      });
      Alert.alert("✓ Granted", `${grantTier.toUpperCase()} for ${grantDays}d → ${grantOpen.email}`);
      setGrantOpen(null);
      setGrantNote("");
      await Promise.all([fetchStats(), fetchUsers(false)]);
      if (openUserId) await openDetail(openUserId);
    } catch (e: any) {
      Alert.alert("Grant failed", e?.message || String(e));
    } finally {
      setGrantLoading(false);
    }
  };

  const doRevoke = (uid: string, email: string) => {
    Alert.alert(
      "Revoke subscription?",
      `This will remove Pro and Zen flags from ${email} immediately and mark all active grants as revoked.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            try {
              await api("/admin/revoke-tier", {
                method: "POST",
                body: JSON.stringify({ user_id: uid }),
              });
              await Promise.all([fetchStats(), fetchUsers(false)]);
              if (openUserId) await openDetail(openUserId);
            } catch (e: any) {
              Alert.alert("Revoke failed", e?.message || String(e));
            }
          },
        },
      ]
    );
  };

  const doResetQuota = (uid: string, email: string) => {
    Alert.alert(
      "Reset coach quota?",
      `Wipes today's daily counter and the lifetime free-trial counter for ${email}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          onPress: async () => {
            try {
              await api("/admin/reset-quota", {
                method: "POST",
                body: JSON.stringify({ user_id: uid }),
              });
              if (openUserId) await openDetail(openUserId);
              Alert.alert("✓ Quota reset");
            } catch (e: any) {
              Alert.alert("Reset failed", e?.message || String(e));
            }
          },
        },
      ]
    );
  };

  const doWeeklyRecap = async (email: string) => {
    try {
      await api("/admin/send-weekly-recap", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      Alert.alert("✓ Email sent", email);
    } catch (e: any) {
      Alert.alert("Email failed", e?.message || String(e));
    }
  };

  // Block unauthorized access (defence-in-depth — backend enforces too).
  if (user && !user.is_admin) {
    return (
      <SafeAreaView style={styles.gateWrap}>
        <Ionicons name="lock-closed" size={48} color={COLORS.textTertiary} />
        <Text style={styles.gateTxt}>Admin access required</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.gateBtn}>
          <Text style={styles.gateBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="admin-panel">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.textSecondary} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* KPI strip — primary tier counts get bigger numbers; engagement
            metrics live in a sub-row for context. */}
        {stats ? (
          <View style={styles.kpiCard}>
            <View style={styles.kpiRow}>
              <Kpi label="Total" value={stats.users.total} tint="#fff" />
              <Kpi label="Pro"   value={stats.users.pro}   tint={TIER_TINT.pro} />
              <Kpi label="Zen"   value={stats.users.zen}   tint={TIER_TINT.zen} />
              <Kpi label="Admin" value={stats.users.admin} tint={TIER_TINT.admin} />
            </View>
            <View style={styles.kpiSubRow}>
              <KpiSmall label="DAU"        value={stats.users.dau} />
              <KpiSmall label="WAU"        value={stats.users.wau} />
              <KpiSmall label="New 7d"     value={stats.users.new_7d} />
              <KpiSmall label="Verified"   value={stats.users.verified} />
              <KpiSmall label="Auras today" value={stats.moods.today} />
              <KpiSmall label="Active grants" value={stats.grants.active} />
            </View>
          </View>
        ) : null}

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.textTertiary} />
          <TextInput
            testID="admin-search"
            value={q}
            onChangeText={setQ}
            placeholder="Search by email or name…"
            placeholderTextColor={COLORS.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {q ? (
            <TouchableOpacity onPress={() => setQ("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={COLORS.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Tier filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {(["all", "free", "pro", "zen", "admin"] as TierFilter[]).map((k) => (
            <TouchableOpacity
              key={k}
              onPress={() => setTier(k)}
              style={[styles.chip, tier === k && styles.chipActive,
                tier === k && k !== "all" && { borderColor: TIER_TINT[k] + "AA", backgroundColor: TIER_TINT[k] + "22" }]}
            >
              <Text style={[styles.chipTxt, tier === k && { color: "#fff", fontWeight: "800" }]}>
                {k.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Sort selector — small and minimal so it doesn't dominate. */}
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort</Text>
          {(["recent", "active", "name", "email"] as SortKey[]).map((s) => (
            <TouchableOpacity key={s} onPress={() => setSort(s)} style={[styles.sortBtn, sort === s && styles.sortBtnActive]}>
              <Text style={[styles.sortTxt, sort === s && { color: "#fff" }]}>{s}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.totalTxt}>{total} users</Text>
        </View>

        {/* User list */}
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          {users.map((u) => <UserCard key={u.user_id} u={u} onPress={() => openDetail(u.user_id)} />)}
          {loading ? <ActivityIndicator color={COLORS.textTertiary} style={{ marginTop: 12 }} /> : null}
          {!loading && users.length === 0 ? (
            <Text style={styles.empty}>No users match this filter.</Text>
          ) : null}
        </View>

        {hasMore ? (
          <TouchableOpacity
            onPress={async () => { setPage((p) => p + 1); await fetchUsers(false); }}
            style={styles.loadMore}
          >
            <Text style={styles.loadMoreTxt}>Load more</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* User detail sheet */}
      <Modal visible={!!openUserId} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetGrip} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>User detail</Text>
              <TouchableOpacity onPress={closeDetail} hitSlop={8}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {detailLoading || !detail ? (
              <View style={{ padding: 40, alignItems: "center" }}>
                <ActivityIndicator color={COLORS.textTertiary} />
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Identity block */}
                <View style={styles.identityRow}>
                  <View style={[styles.tierBadge, { backgroundColor: TIER_TINT[detail.tier] + "33", borderColor: TIER_TINT[detail.tier] }]}>
                    <Text style={[styles.tierBadgeTxt, { color: TIER_TINT[detail.tier] }]}>{detail.tier.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.identityName}>{detail.name || "—"}</Text>
                    <Text style={styles.identityEmail}>{detail.email}</Text>
                  </View>
                  {detail.verified ? <Ionicons name="checkmark-circle" size={20} color="#34D399" /> : <Ionicons name="alert-circle" size={20} color="#F59E0B" />}
                </View>

                {/* user_id one-tap copy */}
                <TouchableOpacity onPress={() => copyId(detail.user_id)} style={styles.idRow} testID="copy-user-id">
                  <Text style={styles.idLabel}>USER ID</Text>
                  <Text style={styles.idVal}>{detail.user_id}</Text>
                  <Ionicons name="copy" size={16} color={COLORS.textTertiary} />
                </TouchableOpacity>

                {/* Two-column info grid */}
                <View style={styles.infoGrid}>
                  <Info label="Created"      value={fmtDate(detail.created_at) + "  ·  " + relAge(detail.created_at)} />
                  <Info label="Last active"  value={fmtDate(detail.last_active_at) + "  ·  " + relAge(detail.last_active_at)} />
                  <Info label="Language"     value={detail.language || "en"} />
                  <Info label="Friend code"  value={detail.friend_code || "—"} />
                  <Info label="Pro expires"  value={fmtDate(detail.pro_expires_at)} />
                  <Info label="Pro source"   value={detail.pro_source || "—"} />
                  {detail.pro_grant_note ? <Info label="Grant note" value={detail.pro_grant_note} fullWidth /> : null}
                </View>

                {/* Engagement stats */}
                <Text style={styles.sectionLabel}>ENGAGEMENT</Text>
                <View style={styles.statsGrid}>
                  <Stat label="Auras"         value={detail.stats.moods_total} />
                  <Stat label="7d auras"      value={detail.stats.moods_7d} />
                  <Stat label="Streak"        value={detail.stats.current_streak} />
                  <Stat label="Best streak"   value={detail.stats.longest_streak} />
                  <Stat label="Friends"       value={detail.stats.friends} />
                  <Stat label="Coach today"   value={detail.stats.coach_used_today} />
                </View>

                {detail.stats.last_mood ? (
                  <Text style={styles.lastMood}>
                    Last aura: <Text style={{ color: "#fff", fontWeight: "700" }}>{detail.stats.last_mood.emotion}</Text>
                    {detail.stats.last_mood.intensity ? `  ${detail.stats.last_mood.intensity}/10` : ""}
                    {"  ·  "}{fmtDateTime(detail.stats.last_mood.at)}
                  </Text>
                ) : null}

                {/* Meditation trials used (Free only) */}
                {detail.meditation_trials_used.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>MEDITATION TRIALS USED</Text>
                    <View style={styles.trialsRow}>
                      {detail.meditation_trials_used.map((t) => (
                        <View key={t} style={styles.trialPill}><Text style={styles.trialTxt}>{t}</Text></View>
                      ))}
                    </View>
                  </>
                ) : null}

                {/* Audit grants */}
                {detail.grants && detail.grants.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>GRANT HISTORY</Text>
                    {detail.grants.slice(0, 5).map((g, i) => (
                      <View key={g.grant_id || i} style={styles.grantRow}>
                        <View style={[styles.grantPill, { borderColor: TIER_TINT[g.tier || "pro"] + "AA" }]}>
                          <Text style={[styles.grantPillTxt, { color: TIER_TINT[g.tier || "pro"] }]}>
                            {(g.tier || "pro").toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.grantHeading}>{g.days}d  ·  exp {fmtDate(g.expires_at)}</Text>
                          <Text style={styles.grantSub}>
                            {g.revoked ? "Revoked " + fmtDate(g.revoked_at) : "Active"}
                            {g.note ? `  ·  ${g.note}` : ""}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </>
                ) : null}

                {/* Action buttons */}
                <View style={styles.actionsGrid}>
                  <ActionBtn
                    icon="sparkles"
                    label="Grant Pro"
                    tint={TIER_TINT.pro}
                    onPress={() => { setGrantTier("pro"); setGrantOpen({ user_id: detail.user_id, email: detail.email, name: detail.name }); }}
                    disabled={detail.is_admin}
                  />
                  <ActionBtn
                    icon="moon"
                    label="Grant Zen"
                    tint={TIER_TINT.zen}
                    onPress={() => { setGrantTier("zen"); setGrantOpen({ user_id: detail.user_id, email: detail.email, name: detail.name }); }}
                    disabled={detail.is_admin}
                  />
                  <ActionBtn
                    icon="close-circle"
                    label="Revoke"
                    tint="#EF4444"
                    onPress={() => doRevoke(detail.user_id, detail.email)}
                    disabled={detail.is_admin || (!detail.pro && !detail.zen)}
                  />
                  <ActionBtn
                    icon="refresh"
                    label="Reset quota"
                    tint="#F59E0B"
                    onPress={() => doResetQuota(detail.user_id, detail.email)}
                  />
                  <ActionBtn
                    icon="mail"
                    label="Send recap"
                    tint="#22D3EE"
                    onPress={() => doWeeklyRecap(detail.email)}
                  />
                </View>

                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Grant modal */}
      <Modal visible={!!grantOpen} transparent animationType="fade" onRequestClose={() => setGrantOpen(null)}>
        <View style={styles.grantOverlay}>
          <View style={styles.grantCard}>
            <Text style={styles.grantTitle}>Grant {grantTier.toUpperCase()}</Text>
            <Text style={styles.grantSubTitle}>{grantOpen?.email}</Text>

            {/* Tier toggle inside modal — admin can switch even after opening */}
            <View style={styles.tierToggle}>
              {(["pro", "zen"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setGrantTier(t)}
                  style={[styles.tierToggleBtn,
                    grantTier === t && { backgroundColor: TIER_TINT[t] + "22", borderColor: TIER_TINT[t] }]}
                >
                  <Text style={[styles.tierToggleTxt, grantTier === t && { color: TIER_TINT[t] }]}>
                    {t.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.grantField}>Days</Text>
            <View style={styles.daysChips}>
              {[7, 30, 90, 180, 365, 3650].map((d) => (
                <TouchableOpacity
                  key={d}
                  onPress={() => setGrantDays(d)}
                  style={[styles.dayChip, grantDays === d && styles.dayChipActive]}
                >
                  <Text style={[styles.dayChipTxt, grantDays === d && { color: "#fff", fontWeight: "800" }]}>
                    {d === 3650 ? "10y" : `${d}d`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.grantField}>Note (optional)</Text>
            <TextInput
              value={grantNote}
              onChangeText={setGrantNote}
              placeholder="Internal note for audit log"
              placeholderTextColor={COLORS.textTertiary}
              maxLength={200}
              style={styles.noteInput}
            />

            <TouchableOpacity
              onPress={doGrant}
              disabled={grantLoading}
              style={[styles.grantConfirm, { backgroundColor: TIER_TINT[grantTier] }]}
            >
              {grantLoading ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.grantConfirmTxt}>Grant {grantTier.toUpperCase()} for {grantDays}d</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setGrantOpen(null)} disabled={grantLoading}>
              <Text style={styles.grantCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function Kpi({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiVal, { color: tint }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}
function KpiSmall({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.kpiSmall}>
      <Text style={styles.kpiSmallVal}>{value}</Text>
      <Text style={styles.kpiSmallLabel}>{label}</Text>
    </View>
  );
}

function UserCard({ u, onPress }: { u: UserRow; onPress: () => void }) {
  const tint = TIER_TINT[u.tier] || COLORS.textSecondary;
  return (
    <TouchableOpacity onPress={onPress} testID={`user-${u.user_id}`} style={styles.userCard}>
      <View style={[styles.userAvatar, { backgroundColor: tint + "33", borderColor: tint }]}>
        <Text style={[styles.userAvatarTxt, { color: tint }]}>
          {(u.name || u.email || "?").charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={styles.userHeadRow}>
          <Text style={styles.userName} numberOfLines={1}>{u.name || u.email}</Text>
          <View style={[styles.tierMicroBadge, { backgroundColor: tint + "22", borderColor: tint }]}>
            <Text style={[styles.tierMicroTxt, { color: tint }]}>{u.tier.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.userEmail} numberOfLines={1}>{u.email}</Text>
        <Text style={styles.userSub}>
          {relAge(u.created_at)}  ·  {u.current_streak}🔥  ·  {u.language}
          {!u.verified ? "  ·  ⚠ unverified" : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

function Info({ label, value, fullWidth }: { label: string; value: string; fullWidth?: boolean }) {
  return (
    <View style={[styles.infoCell, fullWidth && { width: "100%" }]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoVal} numberOfLines={fullWidth ? 3 : 1}>{value}</Text>
    </View>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function ActionBtn({ icon, label, tint, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; tint: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionBtn, { borderColor: tint + "AA" }, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name={icon} size={18} color={tint} />
      <Text style={[styles.actionTxt, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10 },
  headerBtn: { width: 60, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800", flex: 1, textAlign: "center", letterSpacing: 0.3 },

  // KPI strip
  kpiCard: {
    margin: 16, marginBottom: 8,
    padding: 16, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: COLORS.border,
    gap: 14,
  },
  kpiRow: { flexDirection: "row", justifyContent: "space-around" },
  kpi: { alignItems: "center" },
  kpiVal: { fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  kpiLabel: { color: COLORS.textTertiary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: 2 },
  kpiSubRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center" },
  kpiSmall: { alignItems: "center", minWidth: 70 },
  kpiSmallVal: { color: "#fff", fontSize: 14, fontWeight: "800" },
  kpiSmallLabel: { color: COLORS.textTertiary, fontSize: 9, fontWeight: "700", letterSpacing: 1, marginTop: 2 },

  // Search
  searchWrap: {
    marginHorizontal: 16, marginTop: 14,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, padding: 0 },

  // Filter chips
  chips: { paddingHorizontal: 16, gap: 8, paddingTop: 12, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  chipActive: { backgroundColor: "rgba(255,255,255,0.10)" },
  chipTxt: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },

  // Sort row
  sortRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 6, marginTop: 8, marginBottom: 8 },
  sortLabel: { color: COLORS.textTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginRight: 4 },
  sortBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sortBtnActive: { backgroundColor: "rgba(255,255,255,0.10)" },
  sortTxt: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700" },
  totalTxt: { marginLeft: "auto", color: COLORS.textTertiary, fontSize: 11, fontWeight: "700" },

  // User row
  userCard: {
    flexDirection: "row", alignItems: "center",
    padding: 12, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1, borderColor: COLORS.border,
  },
  userAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  userAvatarTxt: { fontSize: 16, fontWeight: "900" },
  userHeadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  userName: { color: "#fff", fontSize: 14, fontWeight: "700", flex: 1 },
  tierMicroBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  tierMicroTxt: { fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  userEmail: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  userSub: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  empty: { color: COLORS.textTertiary, textAlign: "center", marginTop: 24, fontSize: 13 },
  loadMore: { alignSelf: "center", marginTop: 14, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.06)" },
  loadMoreTxt: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700" },

  // Detail sheet
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.70)", justifyContent: "flex-end" },
  sheetCard: {
    backgroundColor: "#0F172A",
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 18, paddingTop: 12,
    maxHeight: "92%",
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.20)" },
  sheetHeader: { flexDirection: "row", alignItems: "center", marginVertical: 14 },
  sheetTitle: { color: "#fff", fontSize: 18, fontWeight: "900", flex: 1 },

  identityRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1.5 },
  tierBadgeTxt: { fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  identityName: { color: "#fff", fontSize: 18, fontWeight: "800" },
  identityEmail: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },

  idRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 14,
  },
  idLabel: { color: COLORS.textTertiary, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  idVal: { color: "#fff", fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", flex: 1 },

  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  infoCell: { width: "48%", padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: COLORS.border },
  infoLabel: { color: COLORS.textTertiary, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 3 },
  infoVal: { color: "#fff", fontSize: 12, fontWeight: "600" },

  sectionLabel: { color: COLORS.textTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginTop: 4, marginBottom: 8 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  stat: { width: "31%", padding: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  statVal: { color: "#fff", fontSize: 18, fontWeight: "900" },
  statLabel: { color: COLORS.textTertiary, fontSize: 9, fontWeight: "800", letterSpacing: 1, marginTop: 2 },

  lastMood: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 14 },

  trialsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  trialPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(167,139,250,0.18)", borderWidth: 1, borderColor: "rgba(167,139,250,0.5)" },
  trialTxt: { color: "#A78BFA", fontSize: 11, fontWeight: "700" },

  grantRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, marginBottom: 6, backgroundColor: "rgba(255,255,255,0.03)" },
  grantPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  grantPillTxt: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  grantHeading: { color: "#fff", fontSize: 12, fontWeight: "700" },
  grantSub: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },

  // Action grid
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  actionTxt: { fontSize: 12, fontWeight: "800" },

  // Grant modal
  grantOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 },
  grantCard: { width: "100%", maxWidth: 380, backgroundColor: "#0F172A", borderRadius: 24, padding: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  grantTitle: { color: "#fff", fontSize: 22, fontWeight: "900" },
  grantSubTitle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: 14 },
  tierToggle: { flexDirection: "row", gap: 8, marginBottom: 14 },
  tierToggleBtn: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, alignItems: "center" },
  tierToggleTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  grantField: { color: COLORS.textTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  daysChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  dayChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  dayChipActive: { backgroundColor: "#FACC15", borderColor: "#FACC15" },
  dayChipTxt: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700" },
  noteInput: { color: "#fff", fontSize: 14, padding: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: COLORS.border, marginBottom: 14 },
  grantConfirm: { paddingVertical: 14, borderRadius: 14, alignItems: "center", marginBottom: 8 },
  grantConfirmTxt: { color: "#0F172A", fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  grantCancel: { color: COLORS.textSecondary, textAlign: "center", padding: 8, fontSize: 13 },

  // Gate
  gateWrap: { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", gap: 16 },
  gateTxt: { color: COLORS.textSecondary, fontSize: 16 },
  gateBtn: { paddingHorizontal: 20, paddingVertical: 12, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 14 },
  gateBtnTxt: { color: "#fff", fontWeight: "700" },
});
