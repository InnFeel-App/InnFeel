import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RadialAura from "../src/components/RadialAura";
import Button from "../src/components/Button";
import { t } from "../src/i18n";

const { width } = Dimensions.get("window");

const SLIDES = [
  { color: "#F472B6", title: "onboarding.1.title", body: "onboarding.1.body" },
  { color: "#60A5FA", title: "onboarding.2.title", body: "onboarding.2.body" },
  { color: "#FDE047", title: "onboarding.3.title", body: "onboarding.3.body" },
  { color: "#A78BFA", title: "onboarding.4.title", body: "onboarding.4.body" },
];

export default function Onboarding() {
  const [i, setI] = useState(0);
  const router = useRouter();
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  return (
    <View style={styles.container} testID="onboarding-screen">
      <RadialAura color={slide.color} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.header}>
          <Image
            source={require("../assets/images/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <TouchableOpacity testID="onboarding-skip" onPress={() => router.replace("/(auth)/login")}>
            <Text style={styles.skip}>{t("cta.skip")}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.dots}>
            {SLIDES.map((_, j) => (
              <View key={j} style={[styles.dot, j === i && styles.dotActive]} />
            ))}
          </View>
          <Text style={styles.title}>{t(slide.title)}</Text>
          <Text style={styles.body}>{t(slide.body)}</Text>
        </View>

        <View style={styles.footer}>
          <Button
            testID="onboarding-next"
            label={last ? t("cta.getStarted") : t("cta.next")}
            onPress={() => (last ? router.replace("/(auth)/login") : setI(i + 1))}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  header: { flexDirection: "row", justifyContent: "space-between", padding: 16, alignItems: "center" },
  logo: { width: 70, height: 70, borderRadius: 14 },
  skip: { color: "rgba(255,255,255,0.55)", fontSize: 14 },
  content: { flex: 1, paddingHorizontal: 28, justifyContent: "center" },
  dots: { flexDirection: "row", gap: 6, marginBottom: 32 },
  dot: { width: 24, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" },
  dotActive: { backgroundColor: "#fff", width: 32 },
  title: { color: "#fff", fontSize: 40, fontWeight: "700", letterSpacing: -1, lineHeight: 46 },
  body: { color: "rgba(255,255,255,0.7)", fontSize: 17, lineHeight: 24, marginTop: 16 },
  footer: { padding: 24 },
});
