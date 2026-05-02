import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RadialAura from "../../src/components/RadialAura";
import Button from "../../src/components/Button";
import { useAuth } from "../../src/auth";
import { t } from "../../src/i18n";
import { COLORS } from "../../src/theme";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container} testID="login-screen">
      <RadialAura color="#818CF8" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.brand}>MoodDrop</Text>
            <Text style={styles.title}>{t("auth.welcomeBack")}</Text>
            <Text style={styles.sub}>{t("app.tagline")}</Text>

            <View style={styles.field}>
              <Text style={styles.label}>{t("auth.email")}</Text>
              <TextInput
                testID="login-email"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholderTextColor="#555"
                placeholder="you@mooddrop.app"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t("auth.password")}</Text>
              <TextInput
                testID="login-password"
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry
                placeholderTextColor="#555"
                placeholder="••••••••"
              />
            </View>

            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

            <View style={{ marginTop: 20 }}>
              <Button testID="login-submit" label={t("auth.continue")} onPress={submit} loading={loading} />
            </View>

            <TouchableOpacity testID="go-register" onPress={() => router.push("/(auth)/register")} style={{ marginTop: 18 }}>
              <Text style={styles.switch}>{t("auth.switchToSignup")}</Text>
            </TouchableOpacity>

            <View style={styles.hintBox}>
              <Text style={styles.hintTitle}>Demo account</Text>
              <Text style={styles.hint}>admin@mooddrop.app / admin123</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  scroll: { padding: 24, flexGrow: 1, justifyContent: "center" },
  brand: { color: "#fff", fontSize: 16, fontWeight: "600", opacity: 0.7 },
  title: { color: "#fff", fontSize: 36, fontWeight: "700", letterSpacing: -1, marginTop: 8 },
  sub: { color: COLORS.textSecondary, marginTop: 6, marginBottom: 28 },
  field: { marginBottom: 14 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    color: "#fff",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  err: { color: "#F87171", marginTop: 8 },
  switch: { color: COLORS.textSecondary, textAlign: "center" },
  hintBox: { marginTop: 32, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)" },
  hintTitle: { color: "#fff", fontSize: 12, fontWeight: "600", marginBottom: 4 },
  hint: { color: COLORS.textSecondary, fontSize: 13 },
});
