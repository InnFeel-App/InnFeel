import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../../src/components/RadialAura";
import { useAuth } from "../../src/auth";
import { api } from "../../src/api";
import { useI18n, currentLocale } from "../../src/i18n";
import { COLORS } from "../../src/theme";

const OTP_LEN = 6;
const CODE_TTL_SEC = 10 * 60; // matches backend VERIF_CODE_TTL_MIN

export default function VerifyEmail() {
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSend?: string }>();
  const { t } = useI18n();
  const { user, refresh, logout } = useAuth();
  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(""));
  const inputs = useRef<Array<TextInput | null>>([]);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [ttl, setTtl] = useState(CODE_TTL_SEC);

  // If already verified, bounce to home
  useEffect(() => {
    if (user?.email_verified_at) router.replace("/(tabs)/home");
  }, [user?.email_verified_at, router]);

  // Countdown for the resend button + overall code expiry
  useEffect(() => {
    const id = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
      setTtl((t) => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // On first render, try to send a fresh code (unless the register flow already triggered it)
  useEffect(() => {
    if (params.skipSend === "1") {
      setCooldown(45);
      return;
    }
    (async () => {
      try {
        const r = await api<{ ok: boolean; sent?: boolean; cooldown_seconds?: number }>(
          "/auth/send-verification",
          { method: "POST", body: { lang: currentLocale() } },
        );
        setCooldown(r.cooldown_seconds || 45);
        if (r.sent) setInfo(t("verify.sent"));
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const code = useMemo(() => digits.join(""), [digits]);

  const handleDigit = (i: number, raw: string) => {
    const only = (raw || "").replace(/\D/g, "");
    if (!only) {
      setDigits((arr) => { const n = [...arr]; n[i] = ""; return n; });
      return;
    }
    if (only.length > 1) {
      // Paste handling — distribute across remaining cells
      const next = [...digits];
      const chars = only.slice(0, OTP_LEN - i).split("");
      for (let k = 0; k < chars.length; k++) next[i + k] = chars[k];
      setDigits(next);
      const jumpTo = Math.min(i + chars.length, OTP_LEN - 1);
      inputs.current[jumpTo]?.focus();
      return;
    }
    const n = [...digits];
    n[i] = only[0];
    setDigits(n);
    if (i < OTP_LEN - 1) inputs.current[i + 1]?.focus();
  };

  const handleKey = (i: number, key: string) => {
    if (key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const submit = async (value?: string) => {
    const v = (value || code).trim();
    if (v.length < OTP_LEN) return;
    Keyboard.dismiss();
    setErr(null);
    setInfo(null);
    setLoading(true);
    try {
      await api("/auth/verify-email", { method: "POST", body: { code: v } });
      setInfo(t("verify.success"));
      await refresh();
      setTimeout(() => router.replace("/(tabs)/home"), 400);
    } catch (e: any) {
      setErr(e?.message || "Code invalid");
      // clear cells on hard failures
      setDigits(Array(OTP_LEN).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when all 6 digits are filled
  useEffect(() => {
    if (code.length === OTP_LEN && !loading) submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const resend = async () => {
    if (cooldown > 0) return;
    setErr(null); setInfo(null);
    try {
      const r = await api<{ ok: boolean; sent?: boolean; cooldown_seconds?: number }>(
        "/auth/send-verification",
        { method: "POST", body: { lang: currentLocale() } },
      );
      if (r.cooldown_seconds) setCooldown(r.cooldown_seconds);
      if (r.sent || r.ok) {
        setInfo(t("verify.sent"));
        setTtl(CODE_TTL_SEC);
        setDigits(Array(OTP_LEN).fill(""));
      }
    } catch (e: any) {
      setErr(e?.message || "Could not resend");
    }
  };

  const skip = () => router.replace("/(tabs)/home");

  const mmss = () => {
    const m = Math.floor(ttl / 60).toString().padStart(1, "0");
    const s = (ttl % 60).toString().padStart(2, "0");
    return { mm: m, ss: s };
  };
  const { mm, ss } = mmss();

  return (
    <View style={styles.container} testID="verify-email-screen">
      <RadialAura color="#A78BFA" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <TouchableOpacity testID="verify-close" onPress={skip} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.iconWrap}>
              <View style={styles.iconCircle}>
                <Ionicons name="mail-outline" size={34} color="#fff" />
              </View>
            </View>

            <Text style={styles.title}>{t("verify.title")}</Text>
            <Text style={styles.subtitle}>
              {t("verify.subtitle", { email: user?.email || "" })}
            </Text>

            <View style={styles.cells}>
              {digits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => { inputs.current[i] = r; }}
                  testID={`otp-${i}`}
                  value={d}
                  onChangeText={(v) => handleDigit(i, v)}
                  onKeyPress={({ nativeEvent }) => handleKey(i, nativeEvent.key)}
                  style={[styles.cell, d ? styles.cellFilled : null]}
                  keyboardType="number-pad"
                  maxLength={OTP_LEN}
                  autoFocus={i === 0}
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  selectionColor="#A78BFA"
                />
              ))}
            </View>

            {ttl > 0 ? (
              <Text style={styles.ttl} testID="verify-ttl">
                {t("verify.expiresIn", { mm, ss })}
              </Text>
            ) : null}

            {info ? <Text style={styles.info}>{info}</Text> : null}
            {err ? <Text style={styles.err} testID="verify-error">{err}</Text> : null}

            <TouchableOpacity
              testID="verify-submit"
              onPress={() => submit()}
              disabled={code.length < OTP_LEN || loading}
              activeOpacity={0.85}
              style={[styles.primaryBtn, (code.length < OTP_LEN || loading) && { opacity: 0.55 }]}
            >
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnTxt}>{t("verify.verify")}</Text>}
            </TouchableOpacity>

            <TouchableOpacity testID="verify-resend" onPress={resend} disabled={cooldown > 0} style={styles.resendBtn}>
              <Text style={[styles.resendTxt, cooldown > 0 && { opacity: 0.5 }]}>
                {cooldown > 0 ? t("verify.resendIn", { sec: cooldown }) : t("verify.resend")}
              </Text>
            </TouchableOpacity>

            <Text style={styles.hint}>{t("verify.hint")}</Text>

            <TouchableOpacity testID="verify-later" onPress={skip} style={styles.laterBtn}>
              <Text style={styles.laterTxt}>{t("verify.later")}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  topBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 18, paddingTop: 6 },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border,
  },
  scroll: { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 12, flexGrow: 1 },
  iconWrap: { alignItems: "center", marginTop: 12, marginBottom: 22 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(167,139,250,0.22)", borderWidth: 1, borderColor: "rgba(167,139,250,0.4)",
  },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", letterSpacing: -0.5, textAlign: "center" },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8, marginBottom: 26, lineHeight: 20 },
  cells: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 14 },
  cell: {
    flex: 1, height: 58, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 24,
    textAlign: "center", fontWeight: "700",
  },
  cellFilled: { borderColor: "#A78BFA", backgroundColor: "rgba(167,139,250,0.10)" },
  ttl: { color: COLORS.textTertiary, textAlign: "center", fontSize: 12, marginTop: 6 },
  info: { color: "#34D399", textAlign: "center", marginTop: 10 },
  err: { color: "#F87171", textAlign: "center", marginTop: 10 },
  primaryBtn: {
    marginTop: 24, backgroundColor: "#fff", borderRadius: 999,
    paddingVertical: 16, alignItems: "center", justifyContent: "center",
  },
  primaryBtnTxt: { color: "#050505", fontWeight: "800", fontSize: 16, letterSpacing: 0.2 },
  resendBtn: { alignItems: "center", paddingVertical: 14 },
  resendTxt: { color: "#A78BFA", fontWeight: "600", fontSize: 14 },
  hint: { color: COLORS.textTertiary, textAlign: "center", fontSize: 12, marginTop: 4, paddingHorizontal: 8 },
  laterBtn: { alignItems: "center", paddingVertical: 18 },
  laterTxt: { color: COLORS.textSecondary, fontSize: 13, textDecorationLine: "underline" },
});
