import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../src/components/RadialAura";
import ScreenHeader from "../src/components/ScreenHeader";
import BackButton from "../src/components/BackButton";
import Button from "../src/components/Button";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";

export default function Account() {
  const router = useRouter();
  const { user, refresh, logout } = useAuth();

  const [name, setName] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [delPw, setDelPw] = useState("");
  const [delConfirm, setDelConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const saveName = async () => {
    if (!name.trim()) { Alert.alert("Invalid name", "Please enter a name."); return; }
    if (name.trim() === user?.name) return;
    setSavingName(true);
    try {
      await api("/account/profile", { method: "PATCH", body: { name: name.trim() } });
      await refresh();
      Alert.alert("✓ Saved", "Your name has been updated.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || "Please try again.");
    } finally {
      setSavingName(false);
    }
  };

  const saveEmail = async () => {
    if (!newEmail || !emailPw) { Alert.alert("Missing fields", "Enter a new email and your password."); return; }
    setSavingEmail(true);
    try {
      await api("/account/email", { method: "POST", body: { new_email: newEmail.trim(), password: emailPw } });
      await refresh();
      setNewEmail(""); setEmailPw("");
      Alert.alert("✓ Email updated", "Your new email is now active.");
    } catch (e: any) {
      Alert.alert("Update failed", e?.message || "Incorrect password or email in use.");
    } finally {
      setSavingEmail(false);
    }
  };

  const exportData = async () => {
    try {
      const data = await api<any>("/account/export");
      Alert.alert(
        "Data export ready",
        `We've prepared a JSON export with ${data.moods?.length || 0} auras, ${data.messages?.length || 0} messages, and your profile. In the next release we'll send this to your email. For now it's logged in-app.`
      );
      // Could use expo-sharing to let them save it; for MVP we just log
      console.log("InnFeel data export:", JSON.stringify(data).slice(0, 200) + "…");
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Please try again.");
    }
  };

  const deleteAccount = async () => {
    if (!delPw) { Alert.alert("Password required", "Enter your password to confirm."); return; }
    if (delConfirm !== "DELETE") { Alert.alert("Confirmation required", 'Type "DELETE" exactly to confirm.'); return; }
    Alert.alert(
      "Delete account permanently?",
      "This will erase your profile, auras, messages, reactions and friendships. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await api("/account", { method: "DELETE", body: { password: delPw, confirm: "DELETE" } });
              await logout();
              Alert.alert("Account deleted", "Your data has been erased. Goodbye ✨");
              router.replace("/onboarding");
            } catch (e: any) {
              Alert.alert("Delete failed", e?.message || "Please try again.");
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container} testID="account-screen">
      <RadialAura color="#A78BFA" />
      <SafeAreaView style={{ flex: 1 }}>
        <ScreenHeader title="Account" leftSlot={<BackButton />} />

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

            {/* Display name */}
            <Text style={styles.sectionTitle}>Display name</Text>
            <View style={styles.card}>
              <TextInput
                testID="account-name-input"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={COLORS.textTertiary}
                style={styles.input}
                autoCapitalize="words"
                maxLength={40}
              />
              <Button
                testID="save-name-btn"
                label="Save name"
                onPress={saveName}
                loading={savingName}
                disabled={!name.trim() || name.trim() === user?.name}
              />
            </View>

            {/* Email */}
            <Text style={styles.sectionTitle}>Email</Text>
            <View style={styles.card}>
              <Text style={styles.currentEmail}>Current: {user?.email}</Text>
              <TextInput
                testID="account-new-email-input"
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="New email"
                placeholderTextColor={COLORS.textTertiary}
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <TextInput
                testID="account-email-password-input"
                value={emailPw}
                onChangeText={setEmailPw}
                placeholder="Your current password"
                placeholderTextColor={COLORS.textTertiary}
                style={styles.input}
                secureTextEntry
              />
              <Button
                testID="save-email-btn"
                label="Update email"
                onPress={saveEmail}
                loading={savingEmail}
                disabled={!newEmail.trim() || !emailPw}
              />
            </View>

            {/* Data export (GDPR) */}
            <Text style={styles.sectionTitle}>Your data</Text>
            <TouchableOpacity style={styles.row} onPress={exportData} testID="export-data-row">
              <View style={[styles.iconBox, { backgroundColor: "rgba(34,211,238,0.15)", borderColor: "rgba(34,211,238,0.35)" }]}>
                <Ionicons name="download-outline" size={18} color="#22D3EE" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Download my data</Text>
                <Text style={styles.rowSub}>GDPR export — profile, auras, messages (JSON)</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.row} onPress={() => router.push("/legal/privacy")} testID="privacy-link">
              <View style={[styles.iconBox, { backgroundColor: "rgba(168,85,247,0.15)", borderColor: "rgba(168,85,247,0.35)" }]}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#A855F7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Privacy Policy</Text>
                <Text style={styles.rowSub}>How we handle your data</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.row} onPress={() => router.push("/legal/terms")} testID="terms-link">
              <View style={[styles.iconBox, { backgroundColor: "rgba(250,204,21,0.15)", borderColor: "rgba(250,204,21,0.35)" }]}>
                <Ionicons name="document-text-outline" size={18} color="#FACC15" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Terms of Service</Text>
                <Text style={styles.rowSub}>Your agreement with InnFeel</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/* Danger zone */}
            <Text style={[styles.sectionTitle, { color: "#EF4444", marginTop: 28 }]}>Danger zone</Text>
            <View style={[styles.card, { borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.05)" }]}>
              <Text style={styles.dangerText}>
                Deleting your account is permanent. All your auras, messages, reactions and friendships will be erased. If you have an active paid subscription, remember to cancel it separately in your App Store or Play Store account — deleting your InnFeel account will NOT cancel or refund your subscription.
              </Text>
              <TextInput
                testID="delete-password-input"
                value={delPw}
                onChangeText={setDelPw}
                placeholder="Your password"
                placeholderTextColor={COLORS.textTertiary}
                style={styles.input}
                secureTextEntry
              />
              <TextInput
                testID="delete-confirm-input"
                value={delConfirm}
                onChangeText={setDelConfirm}
                placeholder='Type "DELETE" to confirm'
                placeholderTextColor={COLORS.textTertiary}
                style={styles.input}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                testID="delete-account-btn"
                onPress={deleteAccount}
                disabled={deleting || !delPw || delConfirm !== "DELETE"}
                style={[styles.deleteBtn, (deleting || !delPw || delConfirm !== "DELETE") && { opacity: 0.5 }]}
              >
                <Text style={styles.deleteBtnTxt}>{deleting ? "Deleting…" : "Delete my account forever"}</Text>
              </TouchableOpacity>
            </View>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontSize: 18, fontWeight: "600" },
  scroll: { padding: 20, paddingBottom: 80 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, marginTop: 6 },
  card: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 18, gap: 10 },
  currentEmail: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 4 },
  input: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: COLORS.border, color: "#fff", padding: 12, borderRadius: 14, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10 },
  iconBox: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  dangerText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  deleteBtn: { backgroundColor: "#EF4444", padding: 14, borderRadius: 14, alignItems: "center" },
  deleteBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
