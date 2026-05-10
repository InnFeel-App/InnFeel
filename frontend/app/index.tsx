import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/auth";
import { getToken } from "../src/api";
import RadialAura from "../src/components/RadialAura";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();
  // Guard: if we ever briefly see user=null while a token still exists in
  // SecureStore (e.g. /auth/me hiccuped during a heavy video upload), DO NOT
  // boot the user to /onboarding. Wait for the next refresh instead. This
  // killed the "flash to onboarding after posting a video aura" bug.
  const decided = useRef(false);

  useEffect(() => {
    if (loading || decided.current) return;
    (async () => {
      if (user) {
        decided.current = true;
        router.replace("/(tabs)/home");
        return;
      }
      // No user — but check if a token is still saved. If so, the auth
      // refresh probably just hiccuped; sit tight on the splash for a beat
      // instead of redirecting to onboarding.
      try {
        const tok = await getToken();
        if (tok) {
          // Token exists — we're probably still loading or refreshing. The
          // AuthProvider will eventually emit a real user; this effect will
          // re-run and route correctly. Don't redirect anywhere yet.
          return;
        }
      } catch {
        // SecureStore unavailable — fall through to onboarding redirect.
      }
      decided.current = true;
      router.replace("/onboarding");
    })();
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <RadialAura color="#F472B6" />
      <View style={styles.center}>
        <Text style={styles.logo}>InnFeel</Text>
        <Text style={styles.tag}>your emotional world, in color</Text>
        <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { color: "#fff", fontSize: 44, fontWeight: "700", letterSpacing: -1 },
  tag: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 8 },
});
