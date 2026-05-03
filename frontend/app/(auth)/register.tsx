import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../../src/components/RadialAura";
import Button from "../../src/components/Button";
import { useAuth } from "../../src/auth";
import { t } from "../../src/i18n";
import { COLORS } from "../../src/theme";

export default function Register() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!accepted) {
      setErr("Please accept the Terms and Privacy Policy to continue.");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password, { termsAccepted: true });
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message || "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container} testID="register-screen">
      <RadialAura color="#34D399" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.brand}>InnFeel</Text>
            <Text style={styles.title}>{t("auth.createAccount")}</Text>

            <View style={styles.field}>
              <Text style={styles.label}>{t("auth.name")}</Text>
              <TextInput testID="reg-name" value={name} onChangeText={setName} style={styles.input} placeholderTextColor="#555" placeholder="Alex" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t("auth.email")}</Text>
              <TextInput testID="reg-email" value={email} onChangeText={setEmail} style={styles.input}
                autoCapitalize="none" keyboardType="email-address" placeholderTextColor="#555" placeholder="you@innfeel.app" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t("auth.password")}</Text>
              <TextInput testID="reg-password" value={password} onChangeText={setPassword} style={styles.input}
                secureTextEntry placeholderTextColor="#555" placeholder="6+ characters" />
            </View>

            <TouchableOpacity
              testID="reg-accept-terms"
              onPress={() => setAccepted((v) => !v)}
              activeOpacity={0.8}
              style={styles.termsRow}
            >
              <View style={[styles.checkbox, accepted && styles.checkboxActive]}>
                {accepted ? <Ionicons name="checkmark" size={16} color="#050505" /> : null}
              </View>
              <Text style={styles.termsTxt}>
                I agree to the{" "}
                <Text style={styles.termsLink} onPress={() => router.push("/legal/terms")}>Terms of Service</Text>
                {" "}and the{" "}
                <Text style={styles.termsLink} onPress={() => router.push("/legal/privacy")}>Privacy Policy</Text>.
              </Text>
            </TouchableOpacity>

            {err ? <Text style={styles.err} testID="reg-error">{err}</Text> : null}

            <View style={{ marginTop: 20 }}>
              <Button
                testID="reg-submit"
                label={t("auth.continue")}
                onPress={submit}
                loading={loading}
                disabled={!accepted || !name.trim() || !email.trim() || !password}
              />
            </View>
            <TouchableOpacity testID="go-login" onPress={() => router.replace("/(auth)/login")} style={{ marginTop: 18 }}>
              <Text style={styles.switch}>{t("auth.switchToLogin")}</Text>
            </TouchableOpacity>
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
  title: { color: "#fff", fontSize: 36, fontWeight: "700", letterSpacing: -1, marginTop: 8, marginBottom: 28 },
  field: { marginBottom: 14 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  err: { color: "#F87171", marginTop: 8 },
  switch: { color: COLORS.textSecondary, textAlign: "center" },
  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 16, paddingVertical: 4 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: COLORS.border,
    alignItems: "center", justifyContent: "center", marginTop: 2,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  checkboxActive: { backgroundColor: "#34D399", borderColor: "#34D399" },
  termsTxt: { flex: 1, color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  termsLink: { color: "#34D399", textDecorationLine: "underline" },
});
