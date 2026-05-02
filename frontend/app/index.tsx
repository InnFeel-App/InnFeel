import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/auth";
import RadialAura from "../src/components/RadialAura";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/(tabs)/home");
    else router.replace("/onboarding");
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <RadialAura color="#F472B6" />
      <View style={styles.center}>
        <Text style={styles.logo}>MoodDrop</Text>
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
