import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RadialAura from "../../src/components/RadialAura";
import { COLORS } from "../../src/theme";
import { useI18n } from "../../src/i18n";
import { getTerms } from "../../src/legalContent";

export default function Terms() {
  const router = useRouter();
  const { locale } = useI18n();
  const doc = getTerms(locale);

  // Render markdown-lite: **bold** segments become bold Text spans
  const renderBody = (p: string) => {
    const parts = p.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return <Text key={i} style={styles.bold}>{part.slice(2, -2)}</Text>;
      }
      return <Text key={i}>{part}</Text>;
    });
  };

  return (
    <View style={styles.container} testID="terms-screen">
      <RadialAura color="#FACC15" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Terms</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.h1}>{doc.title}</Text>
          <Text style={styles.meta}>{doc.effective}</Text>
          <Text style={styles.p}>{doc.intro}</Text>

          {doc.sections.map((s, idx) => (
            <View key={idx}>
              <Text style={styles.h2}>{s.h}</Text>
              {s.body.map((p, pi) => <Text key={pi} style={styles.p}>{renderBody(p)}</Text>)}
            </View>
          ))}

          <Text style={styles.h2}>Contact</Text>
          <Text style={styles.p}>
            {doc.contactIntro}{" "}
            <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${doc.contactEmail}`)}>{doc.contactEmail}</Text>.
          </Text>
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
  bold: { fontWeight: "700", color: "#fff" },
  link: { color: "#60A5FA", textDecorationLine: "underline" },
  foot: { color: COLORS.textTertiary, fontSize: 12, textAlign: "center", marginTop: 40 },
});
