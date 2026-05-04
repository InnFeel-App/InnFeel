import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api";
import { COLORS } from "../theme";

/**
 * StreakFreezeCard — surfaces the user's monthly streak-freeze quota and the bundle
 * upsell. Lives on the Stats page right under the streak counter.
 *
 * Visibility:
 *  • Always shown if the user has any freeze (monthly OR bundle), or if yesterday is
 *    freezable, or if they're Pro/Zen with a non-zero quota.
 *  • Bundle button shown only when the server marks `bundle.eligible` (streak ≥ 7
 *    AND not already purchased this month).
 */

type FreezeStatus = {
  plan: "free" | "pro" | "zen" | string;
  quota: number;
  used_this_month: number;
  monthly_remaining: number;
  bundle_remaining: number;
  remaining: number;
  can_freeze_yesterday: boolean;
  yesterday_key: string;
  current_streak: number;
  bundle: {
    eligible: boolean;
    min_streak: number;
    freezes: number;
    price_eur: number;
    purchased_this_month: boolean;
  };
};

export default function StreakFreezeCard({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<FreezeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<FreezeStatus>("/streak/freeze-status");
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const useFreeze = useCallback(async () => {
    if (!data?.can_freeze_yesterday || acting) return;
    setActing(true);
    try {
      const res: any = await api("/streak/freeze", { method: "POST" });
      Alert.alert(
        "Streak saved ❄️",
        `Yesterday is now bridged. Your streak is ${res.streak} day${res.streak === 1 ? "" : "s"} strong.`,
      );
      await load();
      onChange?.();
    } catch (e: any) {
      Alert.alert("Couldn't apply freeze", e?.message || "Try again later.");
    } finally {
      setActing(false);
    }
  }, [data, acting, load, onChange]);

  const purchaseBundle = useCallback(async () => {
    if (acting) return;
    setActing(true);
    try {
      const res: any = await api("/streak/bundle/purchase", { method: "POST" });
      setBundleOpen(false);
      Alert.alert(
        "Freezes added ❄️",
        `+${res.freezes_granted} freezes are now in your wallet. You have ${res.bundle_remaining} bundle freezes available.`,
      );
      await load();
      onChange?.();
    } catch (e: any) {
      Alert.alert("Purchase failed", e?.message || "Try again later.");
    } finally {
      setActing(false);
    }
  }, [acting, load, onChange]);

  if (loading && !data) {
    return null; // silent first load — nothing to show
  }
  if (!data) return null;

  // Hide entirely for free users with nothing relevant to show.
  const hasAnyFreezes = data.remaining > 0;
  const showBundleOnly = data.bundle.eligible;
  const isPaid = data.plan === "pro" || data.plan === "zen";
  if (!hasAnyFreezes && !data.can_freeze_yesterday && !showBundleOnly && !isPaid) {
    return null;
  }

  const planTint = data.plan === "zen" ? "#A78BFA" : data.plan === "pro" ? "#22D3EE" : "#94A3B8";
  const planLabel = data.plan === "zen" ? "Zen" : data.plan === "pro" ? "Pro" : "Free";

  return (
    <>
      <View style={[styles.card, { borderColor: planTint + "55" }]} testID="streak-freeze-card">
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <Ionicons name="snow" size={16} color="#7DD3FC" />
            <Text style={styles.title}>Streak freeze</Text>
            <View style={[styles.planBadge, { backgroundColor: planTint + "22", borderColor: planTint + "55" }]}>
              <Text style={[styles.planTxt, { color: planTint }]}>{planLabel}</Text>
            </View>
          </View>
          <Text style={styles.remaining}>
            {data.remaining}
            <Text style={styles.remainingSuffix}>
              {data.quota > 0 ? ` / ${data.quota + data.bundle_remaining}` : ""}
            </Text>
          </Text>
        </View>

        <View style={styles.subRow}>
          {data.quota > 0 ? (
            <Text style={styles.sub}>
              {data.monthly_remaining}/{data.quota} monthly
              {data.bundle_remaining > 0 ? ` · +${data.bundle_remaining} bundle` : ""}
            </Text>
          ) : data.bundle_remaining > 0 ? (
            <Text style={styles.sub}>{data.bundle_remaining} bundle freeze{data.bundle_remaining === 1 ? "" : "s"}</Text>
          ) : (
            <Text style={styles.sub}>No freezes — upgrade to Pro or grab a bundle</Text>
          )}
        </View>

        {data.can_freeze_yesterday ? (
          <TouchableOpacity
            testID="use-freeze-btn"
            onPress={useFreeze}
            disabled={acting}
            style={[styles.actionBtn, { backgroundColor: "#0EA5E9" }]}
          >
            {acting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="snow" size={16} color="#fff" />
                <Text style={styles.actionTxt}>Save my streak (yesterday)</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}

        {data.bundle.eligible ? (
          <TouchableOpacity
            testID="open-bundle-btn"
            onPress={() => setBundleOpen(true)}
            style={[styles.bundleBtn, { borderColor: "#A78BFA66" }]}
          >
            <Ionicons name="gift" size={14} color="#A78BFA" />
            <Text style={styles.bundleBtnTxt}>
              +{data.bundle.freezes} freezes · €{data.bundle.price_eur.toFixed(2)}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#A78BFA" />
          </TouchableOpacity>
        ) : data.bundle.purchased_this_month ? (
          <Text style={styles.locked}>✓ Bundle purchased this month</Text>
        ) : data.current_streak < data.bundle.min_streak ? (
          <Text style={styles.locked}>
            Bundle unlocks at a {data.bundle.min_streak}-day streak (you're at {data.current_streak})
          </Text>
        ) : null}
      </View>

      {/* Bundle confirmation modal */}
      <Modal visible={bundleOpen} transparent animationType="fade" onRequestClose={() => setBundleOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="snow" size={32} color="#7DD3FC" />
            </View>
            <Text style={styles.modalTitle}>+{data.bundle.freezes} streak freezes</Text>
            <Text style={styles.modalDesc}>
              Add a safety net to your streak. Use these any time you miss a day — they
              don't expire and stack with your monthly quota.
            </Text>
            <View style={styles.priceRow}>
              <Text style={styles.priceTxt}>€{data.bundle.price_eur.toFixed(2)}</Text>
              <Text style={styles.priceSub}>one-time · 1 bundle/month</Text>
            </View>

            <TouchableOpacity
              testID="confirm-bundle-btn"
              style={[styles.modalCta, { backgroundColor: "#A78BFA" }]}
              onPress={purchaseBundle}
              disabled={acting}
            >
              {acting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalCtaTxt}>Buy now</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setBundleOpen(false)} style={styles.modalCancel} disabled={acting}>
              <Text style={styles.modalCancelTxt}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: "rgba(125,211,252,0.06)",
    gap: 10,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleWrap: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  title: { color: "#fff", fontSize: 14, fontWeight: "700", letterSpacing: 0.3 },
  planBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  planTxt: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  remaining: { color: "#7DD3FC", fontSize: 28, fontWeight: "700" },
  remainingSuffix: { color: COLORS.textTertiary, fontSize: 13, fontWeight: "500" },
  subRow: {},
  sub: { color: COLORS.textSecondary, fontSize: 12 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  actionTxt: { color: "#fff", fontSize: 14, fontWeight: "700" },
  bundleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "rgba(167,139,250,0.08)",
    marginTop: 4,
  },
  bundleBtnTxt: { color: "#A78BFA", fontSize: 13, fontWeight: "700" },
  locked: { color: COLORS.textTertiary, fontSize: 11, textAlign: "center", marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#0F172A",
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: "#A78BFA33",
    alignItems: "center",
    gap: 12,
  },
  modalIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(125,211,252,0.15)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  modalDesc: { color: COLORS.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 18 },
  priceRow: { alignItems: "center", marginVertical: 8 },
  priceTxt: { color: "#fff", fontSize: 36, fontWeight: "800" },
  priceSub: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  modalCta: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 8,
  },
  modalCtaTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  modalCancel: { paddingVertical: 8 },
  modalCancelTxt: { color: COLORS.textSecondary, fontSize: 13 },
});
