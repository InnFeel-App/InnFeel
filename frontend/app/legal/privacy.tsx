import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../../src/components/RadialAura";
import { COLORS } from "../../src/theme";

const EFFECTIVE_DATE = "June 1, 2025";

export default function Privacy() {
  const router = useRouter();
  return (
    <View style={styles.container} testID="privacy-screen">
      <RadialAura color="#A855F7" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Privacy Policy</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.h1}>InnFeel — Privacy Policy</Text>
          <Text style={styles.meta}>Effective date: {EFFECTIVE_DATE}</Text>
          <Text style={styles.p}>
            This Privacy Policy explains what personal data InnFeel (“we”) collects, why we collect it, how we use and share it, and the rights you have. It applies to everyone using the InnFeel app, worldwide, and complies with the EU General Data Protection Regulation (GDPR), the UK GDPR, the California Consumer Privacy Act (CCPA/CPRA), Brazil’s LGPD, Canada’s PIPEDA, and equivalent laws.
          </Text>

          <Text style={styles.h2}>1. Data controller</Text>
          <Text style={styles.p}>InnFeel is the controller of your personal data. Contact: <Text style={styles.link} onPress={() => Linking.openURL("mailto:support@innfeel.app")}>support@innfeel.app</Text>.</Text>

          <Text style={styles.h2}>2. What we collect</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>Account data</Text>: name, email, hashed password, avatar colour or image, creation date.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>Auras &amp; interactions</Text>: emotion, word, intensity, optional photo/video/audio, text note, music track reference, privacy setting, reactions, comments, friendships, messages.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>Device &amp; technical data</Text>: push-notification token, platform (iOS/Android/Web), approximate language/locale, app version, crash diagnostics.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>Subscription data</Text>: subscription status and expiry (from Apple/Google/Stripe/RevenueCat). We do NOT receive or store your full card number; payments are handled by the store or Stripe.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>Usage analytics</Text> (minimal): streaks, aggregated feature usage. We avoid tracking identifiers across apps.</Text>

          <Text style={styles.h2}>3. Why we use it (legal bases under GDPR)</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>To provide the Service</Text> (contract): authenticate you, store your auras, deliver messages, run reciprocity gating, generate stats.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>To personalise wellness insights</Text> (contract): generate a short daily wellness sentence via an AI provider based on your emotion. The AI provider never receives your name, email or identifiers — only the emotion keyword.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>To send notifications</Text> (legitimate interest / consent): daily reminders, reactions, comments, messages, friend activity. You can disable any category in Settings.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>To process payments</Text> (contract): via Apple IAP, Google Play Billing, Stripe and RevenueCat.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>To secure and improve the Service</Text> (legitimate interest, legal obligation): abuse prevention, fraud detection, analytics.</Text>

          <Text style={styles.h2}>4. Who we share data with</Text>
          <Text style={styles.li}>• Your friends: only the data you choose to share (your aura according to its privacy setting, messages, reactions, comments).</Text>
          <Text style={styles.li}>• Service providers (processors): MongoDB Atlas (hosting), Railway/Cloud provider (compute), Expo (push), Apple/Google/Stripe/RevenueCat (payments), AI provider (wellness sentences only), iTunes &amp; Spotify search APIs (music lookup), and Resend/SendGrid (transactional email, if used). Each is contractually bound to process data only on our instructions.</Text>
          <Text style={styles.li}>• Authorities: only when required by valid legal process.</Text>
          <Text style={styles.li}>• <Text style={styles.bold}>We do NOT sell your personal data.</Text></Text>

          <Text style={styles.h2}>5. International transfers</Text>
          <Text style={styles.p}>If data is transferred outside your country (including to the US), we rely on Standard Contractual Clauses (SCCs) and equivalent safeguards to protect your data.</Text>

          <Text style={styles.h2}>6. How long we keep your data</Text>
          <Text style={styles.li}>• Account data: for as long as your account is active.</Text>
          <Text style={styles.li}>• Auras and messages: until you delete them or your account.</Text>
          <Text style={styles.li}>• After account deletion: all personal data is erased, except backups retained up to 30 days and records we must keep by law (e.g. tax records).</Text>

          <Text style={styles.h2}>7. Your rights</Text>
          <Text style={styles.p}>Depending on your country you have the right to: access, rectify, erase, restrict processing, object to processing, port your data, withdraw consent at any time, and lodge a complaint with your data protection authority. California residents also have the right to know, delete, correct, and opt-out of sale/sharing (we don’t sell), plus non-discrimination. To exercise your rights, open Settings → Account (Edit name/email, Download my data, Delete account) or email <Text style={styles.link} onPress={() => Linking.openURL("mailto:support@innfeel.app")}>support@innfeel.app</Text>. We respond within 30 days.</Text>

          <Text style={styles.h2}>8. Security</Text>
          <Text style={styles.p}>We use industry-standard measures: TLS in transit, hashed passwords (bcrypt), limited access, regular updates. No system is 100% secure; please use a strong unique password and enable OS-level security.</Text>

          <Text style={styles.h2}>9. Children</Text>
          <Text style={styles.p}>InnFeel is not directed to children under 13 (or 16 in the EEA/UK where required). We do not knowingly collect data from them. If you believe we have, email support@innfeel.app and we will delete the account.</Text>

          <Text style={styles.h2}>10. Cookies &amp; similar tech</Text>
          <Text style={styles.p}>The mobile app uses essential device storage (secure storage for tokens, AsyncStorage for preferences). We do not use advertising cookies or cross-site trackers.</Text>

          <Text style={styles.h2}>11. Changes</Text>
          <Text style={styles.p}>We will notify material changes in-app. The “Effective date” above reflects the last update.</Text>

          <Text style={styles.h2}>12. Contact &amp; complaints</Text>
          <Text style={styles.p}>Questions or complaints: <Text style={styles.link} onPress={() => Linking.openURL("mailto:support@innfeel.app")}>support@innfeel.app</Text>. EEA users may also contact their local Data Protection Authority.</Text>

          <Text style={styles.foot}>© InnFeel — all rights reserved.</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: COLORS.border },
  title: { color: "#fff", fontSize: 17, fontWeight: "600" },
  scroll: { padding: 20, paddingBottom: 80 },
  h1: { color: "#fff", fontSize: 24, fontWeight: "700" },
  h2: { color: "#fff", fontSize: 17, fontWeight: "700", marginTop: 22, marginBottom: 4 },
  meta: { color: COLORS.textSecondary, marginTop: 6, marginBottom: 14, fontSize: 12 },
  p: { color: "#E5E7EB", fontSize: 14, lineHeight: 22, marginTop: 6 },
  li: { color: "#E5E7EB", fontSize: 14, lineHeight: 22, marginTop: 4, paddingLeft: 6 },
  bold: { fontWeight: "700", color: "#fff" },
  link: { color: "#60A5FA", textDecorationLine: "underline" },
  foot: { color: COLORS.textTertiary, fontSize: 12, textAlign: "center", marginTop: 40 },
});
