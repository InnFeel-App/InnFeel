/**
 * Global error boundary — prevents white-screen crashes on uncaught render errors.
 * When something throws during render, displays a friendly recovery UI with two
 * options: "Try again" (re-mounts) and "Reset & re-login" (clears persisted auth).
 *
 * Wrap your root tree with this in `app/_layout.tsx`:
 *   <ErrorBoundary><App /></ErrorBoundary>
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KNOWN_KEYS = [
  "innfeel_access_token",
  "innfeel_refresh_token",
  "innfeel_locale",
  "innfeel_iap_user",
];

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in JS console for Metro/Expo Go debugging
    console.error("[ErrorBoundary] uncaught:", error?.message, "\n", error?.stack, "\n", info?.componentStack);
  }

  retry = () => {
    this.setState({ hasError: false, error: null });
  };

  hardReset = async () => {
    try {
      // Clear known persisted keys (token, locale, IAP cache).
      if (Platform.OS === "web") {
        try {
          for (const k of KNOWN_KEYS) (globalThis as any).localStorage?.removeItem(k);
        } catch {}
      } else {
        for (const k of KNOWN_KEYS) {
          try { await SecureStore.deleteItemAsync(k); } catch {}
        }
      }
    } catch {}
    // Force a full reload of the JS bundle
    try {
      // @ts-ignore — Expo Updates may not be installed; safe optional reload
      const Updates = require("expo-updates");
      await Updates.reloadAsync?.();
    } catch {}
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || "Unknown error";
      return (
        <View style={styles.container} testID="error-boundary">
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.emoji}>✦</Text>
            <Text style={styles.title}>Quelque chose s'est mal passé</Text>
            <Text style={styles.subtitle}>
              Une erreur a été interceptée pour éviter de figer l'écran. Tu peux ré-essayer
              ou réinitialiser l'app si le problème persiste.
            </Text>
            <View style={styles.errBox}>
              <Text style={styles.errLabel}>Détails techniques</Text>
              <Text style={styles.errText} numberOfLines={5}>{msg}</Text>
            </View>
            <TouchableOpacity testID="error-retry" onPress={this.retry} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryTxt}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="error-reset" onPress={this.hardReset} style={styles.btnSecondary}>
              <Text style={styles.btnSecondaryTxt}>Reset & re-login</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 28 },
  emoji: { fontSize: 56, color: "#A78BFA", textAlign: "center", marginBottom: 12 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", textAlign: "center", letterSpacing: -0.4 },
  subtitle: { color: "#9CA3AF", fontSize: 14, textAlign: "center", marginTop: 12, marginBottom: 22, lineHeight: 21 },
  errBox: {
    backgroundColor: "rgba(248,113,113,0.08)", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(248,113,113,0.25)",
    padding: 14, marginBottom: 22,
  },
  errLabel: { color: "#F87171", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  errText: { color: "#FCA5A5", fontSize: 12, fontFamily: "Menlo" },
  btnPrimary: {
    backgroundColor: "#fff", borderRadius: 999, paddingVertical: 16, alignItems: "center", marginBottom: 10,
  },
  btnPrimaryTxt: { color: "#050505", fontSize: 16, fontWeight: "800", letterSpacing: 0.2 },
  btnSecondary: {
    paddingVertical: 14, alignItems: "center",
    borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  btnSecondaryTxt: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
