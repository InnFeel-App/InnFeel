import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../../src/components/RadialAura";
import { COLORS } from "../../src/theme";

const EFFECTIVE_DATE = "June 1, 2025";

export default function Terms() {
  const router = useRouter();
  return (
    <View style={styles.container} testID="terms-screen">
      <RadialAura color="#FACC15" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Terms of Service</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.h1}>InnFeel — Terms of Service</Text>
          <Text style={styles.meta}>Effective date: {EFFECTIVE_DATE}</Text>
          <Text style={styles.p}>
            These Terms of Service (“Terms”) govern your access to and use of the InnFeel mobile application and related services (the “Service”), operated by InnFeel (“we”, “us”, “our”). By creating an account or using InnFeel, you agree to these Terms. If you do not agree, do not use the Service.
          </Text>

          <Text style={styles.h2}>1. Who may use InnFeel</Text>
          <Text style={styles.p}>You must be at least 13 years old (16 in the EEA/UK where required by local law) and able to form a binding contract. By using the Service you represent and warrant that you meet these requirements.</Text>

          <Text style={styles.h2}>2. Your account</Text>
          <Text style={styles.p}>You are responsible for keeping your credentials confidential and for all activity under your account. You must provide accurate information and promptly update it if it changes. Notify us at support@innfeel.app of any unauthorised use.</Text>

          <Text style={styles.h2}>3. User content</Text>
          <Text style={styles.p}>You retain ownership of the auras, photos, videos, text, audio notes and other content you submit (“User Content”). By submitting User Content you grant us a worldwide, non-exclusive, royalty-free, sub-licensable licence to host, store, reproduce, display, adapt (for formats, sizing, compression, and moderation) and distribute it solely to operate, improve and secure the Service. This licence terminates when you delete the content or your account, except for: (a) backups retained for up to 30 days for disaster recovery, (b) content already shared with friends or downloaded by them, and (c) where retention is required by law.</Text>
          <Text style={styles.p}>You are solely responsible for your User Content and confirm you own or have all rights necessary to submit it. You must not post anything unlawful, defamatory, harassing, sexually explicit involving minors, infringing, hateful, or that violates any third party’s rights. We may remove content and suspend accounts in our sole discretion to enforce these Terms or applicable law.</Text>

          <Text style={styles.h2}>4. Acceptable use</Text>
          <Text style={styles.p}>You must not: reverse-engineer or scrape the Service; circumvent security, rate limits or reciprocity rules; impersonate any person; use the Service to spam, harass, or collect personal information about others; introduce malware; or use the Service for any commercial resale without our written permission.</Text>

          <Text style={styles.h2}>5. Subscriptions, billing and no-refund policy</Text>
          <Text style={styles.p}>InnFeel offers a free tier and a paid “Pro” subscription. Pro subscriptions are billed on a recurring basis (monthly or annual) via the Apple App Store, Google Play, Stripe or any other authorised payment provider, at the price shown in-app at the time of purchase (taxes excluded unless stated). Subscriptions renew automatically at the end of each billing period unless cancelled before renewal.</Text>
          <Text style={styles.p}><Text style={styles.bold}>No refunds.</Text> Except where required by mandatory applicable law, <Text style={styles.bold}>all payments are final and non-refundable, including for any billing period already started, unused time, or accidental renewals</Text>. We do not pro-rate cancellations. Free-trial periods (if offered) convert into paid subscriptions automatically unless cancelled before the trial ends.</Text>
          <Text style={styles.p}><Text style={styles.bold}>You are responsible for cancelling your subscription</Text> directly with the billing provider you originally used:</Text>
          <Text style={styles.li}>• Apple users: Settings → [your name] → Subscriptions → InnFeel.</Text>
          <Text style={styles.li}>• Google users: Play Store → Menu → Payments &amp; subscriptions → Subscriptions.</Text>
          <Text style={styles.li}>• Stripe users: use the customer portal link we send by email, or contact support@innfeel.app.</Text>
          <Text style={styles.p}>Deleting your InnFeel account does <Text style={styles.bold}>not</Text> cancel a subscription billed by Apple, Google or Stripe — you must cancel it with the provider separately. If you forget to cancel, we cannot and will not issue refunds for periods already paid.</Text>
          <Text style={styles.p}>EU/UK right of withdrawal: when you purchase digital content that begins immediately upon confirmation, by tapping “Subscribe” you expressly request immediate performance and acknowledge you waive your 14-day right of withdrawal under applicable law, to the extent permitted.</Text>

          <Text style={styles.h2}>6. Changes to the Service and pricing</Text>
          <Text style={styles.p}>We may add, modify or remove features and change pricing at any time. Price changes apply from the next renewal cycle and will be notified in advance where required by law or app-store policy.</Text>

          <Text style={styles.h2}>7. Termination</Text>
          <Text style={styles.p}>You may stop using the Service and delete your account at any time from Settings → Account. We may suspend or terminate access to the Service immediately, without notice or liability, if you breach these Terms, create risk or legal exposure, or for lawful business reasons. Upon termination your licence to use the Service ends.</Text>

          <Text style={styles.h2}>8. Disclaimers</Text>
          <Text style={styles.p}>InnFeel is provided “AS IS” and “AS AVAILABLE”. To the maximum extent permitted by law, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, non-infringement and accuracy. InnFeel is a self-reflection and social product; it is <Text style={styles.bold}>not a medical device</Text> and does not provide medical, psychological or therapeutic advice, diagnosis or treatment. If you are experiencing a crisis, contact local emergency services or a qualified professional immediately.</Text>

          <Text style={styles.h2}>9. Limitation of liability</Text>
          <Text style={styles.p}>To the maximum extent permitted by law, we and our affiliates, officers, employees and agents will not be liable for any indirect, incidental, special, consequential or punitive damages, loss of profits, data, goodwill or other intangible losses arising from or related to your use of the Service. Our aggregate liability for any claims arising from the Service is limited to the greater of (a) the amount you paid us in the 12 months before the event giving rise to the claim, or (b) USD 50. Some jurisdictions do not allow certain limitations; in those the foregoing may not apply in full.</Text>

          <Text style={styles.h2}>10. Indemnification</Text>
          <Text style={styles.p}>You agree to defend, indemnify and hold us harmless from claims, liabilities, damages and expenses (including reasonable legal fees) arising from your User Content, your use of the Service, or your violation of these Terms or any law.</Text>

          <Text style={styles.h2}>11. Third-party services</Text>
          <Text style={styles.p}>The Service integrates third parties (e.g. Apple/Google IAP, Stripe, RevenueCat, Apple Music search, Spotify, Expo Push, AI providers). Their terms and privacy policies apply to their portions of the Service. We are not responsible for third-party services.</Text>

          <Text style={styles.h2}>12. Governing law and disputes</Text>
          <Text style={styles.p}>These Terms are governed by the laws of the country of our principal place of business, without regard to conflicts of law. Where you are a consumer protected by mandatory local law, that law still applies. Any dispute will first be addressed by good-faith negotiation with support@innfeel.app. Failing resolution within 30 days, disputes will be submitted to the competent courts of our jurisdiction, except where exclusive jurisdiction is granted to your local courts by consumer law.</Text>

          <Text style={styles.h2}>13. Apple and Google additional terms</Text>
          <Text style={styles.p}>If you downloaded the app from the Apple App Store, you acknowledge that these Terms are between you and us, not Apple, and Apple is not responsible for the app or its content. Apple is a third-party beneficiary of these Terms and may enforce them against you. Similar provisions apply for Google Play.</Text>

          <Text style={styles.h2}>14. Changes to these Terms</Text>
          <Text style={styles.p}>We may update these Terms from time to time. Material changes will be notified in-app or by email. Continued use of the Service after the effective date of new Terms constitutes acceptance.</Text>

          <Text style={styles.h2}>15. Contact</Text>
          <Text style={styles.p}>Questions? Email <Text style={styles.link} onPress={() => Linking.openURL("mailto:support@innfeel.app")}>support@innfeel.app</Text>.</Text>

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
