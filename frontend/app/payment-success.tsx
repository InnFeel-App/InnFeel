import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import RadialAura from "../src/components/RadialAura";
import { api } from "../src/api";
import { useAuth } from "../src/auth";

export default function PaymentSuccess() {
  const { session_id } = useLocalSearchParams<{ session_id?: string }>();
  const router = useRouter();
  const { refresh } = useAuth();

  useEffect(() => {
    let attempts = 0;
    const poll = async () => {
      if (!session_id) return;
      try {
        const s = await api<{ payment_status: string }>(`/payments/status/${session_id}`);
        if (s.payment_status === "paid") {
          await refresh();
          setTimeout(() => router.replace("/(tabs)/profile"), 800);
          return;
        }
      } catch {}
      if (attempts++ < 8) setTimeout(poll, 2000);
    };
    poll();
  }, [session_id, refresh, router]);

  return (
    <View style={styles.c}>
      <RadialAura color="#FDE047" />
      <Text style={styles.t}>✦ Welcome to Pro</Text>
      <Text style={styles.s}>Finalizing your upgrade…</Text>
      <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: "#050505", alignItems: "center", justifyContent: "center" },
  t: { color: "#fff", fontSize: 28, fontWeight: "700" },
  s: { color: "rgba(255,255,255,0.7)", marginTop: 8 },
});
