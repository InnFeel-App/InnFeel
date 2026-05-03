import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import RadialAura from "../src/components/RadialAura";
import Button from "../src/components/Button";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";
import { t } from "../src/i18n";
import { Ionicons } from "@expo/vector-icons";
import { isIAPAvailable, getOfferings, purchasePackage, restorePurchases } from "../src/iap";

const BENEFITS = [
  { icon: "infinite", key: "paywall.f1" },
  { icon: "analytics", key: "paywall.f2" },
  { icon: "musical-notes", key: "paywall.f3" },
  { icon: "color-palette", key: "paywall.f4" },
  { icon: "heart", key: "paywall.f5" },
  { icon: "sparkles", key: "paywall.f6" },
] as const;

export default function Paywall() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(false);
  const [offering, setOffering] = useState<any>(null);
  const [useIAP, setUseIAP] = useState<boolean>(false);

  // On mount, probe RevenueCat to see if native IAP is available on this build.
  useEffect(() => {
    (async () => {
      if (!isIAPAvailable()) { setUseIAP(false); return; }
      const off = await getOfferings();
      if (off && off.availablePackages?.length > 0) {
        setOffering(off);
        setUseIAP(true);
      }
    })();
  }, []);

  // Native IAP purchase (iOS/Android EAS build only)
  const upgradeIAP = async () => {
    if (!offering) return;
    const pkg = offering.availablePackages[0]; // take the first (usually monthly)
    setLoading(true);
    try {
      const res = await purchasePackage(pkg);
      if (res.success) {
        await refresh();
        Alert.alert("✦ You're Pro!", "All features unlocked.");
        router.replace("/(tabs)/profile");
      } else if (res.cancelled) {
        // user cancelled — no-op
      } else {
        Alert.alert("Purchase failed", res.error || "Please try again.");
      }
    } catch (e: any) {
      Alert.alert("Purchase failed", e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    setLoading(true);
    try {
      const r = await restorePurchases();
      if (r.proActive) {
        await refresh();
        Alert.alert("✦ Restored", "Your Pro subscription is active.");
        router.replace("/(tabs)/profile");
      } else {
        Alert.alert("No purchases", "No active subscription found for this account.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Stripe web fallback (web / Expo Go / missing RevenueCat keys)
  const upgrade = async () => {
    if (useIAP) return upgradeIAP();
    setLoading(true);
    try {
      const origin = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const res = await api<{ url: string; session_id: string }>("/payments/checkout", { method: "POST", body: { origin_url: origin } });
      // Fire-and-forget: open the Stripe checkout in a browser session
      await WebBrowser.openBrowserAsync(res.url);
      // After user returns, poll for up to 20s to detect paid state
      let paid = false;
      for (let i = 0; i < 10; i++) {
        try {
          const s = await api<{ payment_status: string }>(`/payments/status/${res.session_id}`);
          if (s.payment_status === "paid") { paid = true; break; }
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (paid) {
        await refresh();
        Alert.alert("✦ You're Pro!", "All features unlocked.");
        router.replace("/(tabs)/profile");
      } else {
        Alert.alert(
          "Payment not confirmed",
          "If you completed payment, pull to refresh your profile in a moment. Otherwise try again.",
        );
      }
    } catch (e: any) {
      const msg = e?.message || "Please try again.";
      // Friendlier hint if the common Stripe test-mode error is hit
      const nice = msg.includes("Not Found") || msg.includes("details not found")
        ? "Payment provider returned an error. Please try again in a few seconds."
        : msg;
      Alert.alert("Checkout failed", nice);
    } finally { setLoading(false); }
  };

  const devToggle = async () => {
    try { await api("/dev/toggle-pro", { method: "POST" }); await refresh(); Alert.alert("Pro enabled (demo)"); router.back(); } catch {}
  };

  return (
    <View style={styles.container} testID="paywall-screen">
      <RadialAura color="#FDE047" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity testID="close-paywall" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile"); }} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.kicker}>INNFEEL</Text>
          <Text style={styles.title}>{t("paywall.title")}</Text>
          <Text style={styles.sub}>{t("paywall.subtitle")}</Text>

          {useIAP && offering?.availablePackages?.[0] ? (
            <View style={styles.priceCard}>
              <Text style={styles.price}>
                {offering.availablePackages[0].product.priceString} <Text style={styles.per}>/ {offering.availablePackages[0].packageType?.toLowerCase() || "month"}</Text>
              </Text>
              <Text style={styles.priceSub}>Cancel anytime · via {Platform.OS === "ios" ? "App Store" : "Google Play"}</Text>
            </View>
          ) : (
            <View style={styles.priceCard}>
              <Text style={styles.price}>$4.99 <Text style={styles.per}>/ month</Text></Text>
              <Text style={styles.priceSub}>Cancel anytime</Text>
            </View>
          )}

          <View style={{ gap: 12, marginTop: 20 }}>
            {BENEFITS.map((b) => (
              <View key={b.key} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name={b.icon as any} size={16} color="#FDE047" />
                </View>
                <Text style={styles.rowTxt}>{t(b.key)}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 24, gap: 10 }}>
            <Button testID="paywall-upgrade" label={t("paywall.cta")} onPress={upgrade} loading={loading} />
            {useIAP && (
              <TouchableOpacity testID="paywall-restore" onPress={restore}>
                <Text style={styles.dev}>Restore purchases</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity testID="dev-toggle-pro" onPress={devToggle}>
              <Text style={styles.dev}>{t("paywall.devToggle")}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", justifyContent: "flex-end", padding: 14 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  scroll: { padding: 24 },
  kicker: { color: "#FDE047", fontSize: 11, letterSpacing: 3, fontWeight: "700" },
  title: { color: "#fff", fontSize: 42, fontWeight: "700", letterSpacing: -1, marginTop: 8 },
  sub: { color: COLORS.textSecondary, marginTop: 6, fontSize: 16 },
  priceCard: { marginTop: 22, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: "rgba(253,224,71,0.3)", backgroundColor: "rgba(253,224,71,0.06)" },
  price: { color: "#fff", fontSize: 34, fontWeight: "700" },
  per: { color: COLORS.textSecondary, fontSize: 14, fontWeight: "500" },
  priceSub: { color: COLORS.textSecondary, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(253,224,71,0.12)", alignItems: "center", justifyContent: "center" },
  rowTxt: { color: "#fff", flex: 1, fontSize: 14 },
  dev: { color: COLORS.textTertiary, textAlign: "center", fontSize: 12, padding: 8 },
});
