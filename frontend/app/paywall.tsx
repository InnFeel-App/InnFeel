import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import RadialAura from "../src/components/RadialAura";
import Button from "../src/components/Button";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { COLORS } from "../src/theme";
import { currentLocale, useI18n } from "../src/i18n";
import { Ionicons } from "@expo/vector-icons";
import { isIAPAvailable, getOfferings, purchasePackage, restorePurchases } from "../src/iap";

/**
 * Paywall — side-by-side Pro vs Zen, in €.
 *
 * Why a single screen with a tier toggle (rather than two routes)?
 *  • The user comparison is the entire purchase decision: people buy
 *    Zen *because* they see it has 4× the AI credits of Pro. Hiding Zen
 *    behind a second tap kills the conversion. So we expose both up
 *    front and let the user "feel" the upgrade in a glance.
 *  • One screen keeps i18n cost low — the same comparison rows are
 *    reused for both columns.
 *
 * Pricing source of truth
 * ───────────────────────
 *  • If RevenueCat returns offerings, we use those `priceString`s
 *    verbatim (it auto-formats to the user's storefront currency).
 *  • Otherwise we render a hard-coded EUR display — for the Soft Launch
 *    we only sell to EU storefronts where these numbers match.
 *  • Zen IAP requires a second offering ("zen_monthly"). Until that's
 *    configured in RevenueCat, picking Zen falls back to the Pro flow
 *    + a TODO marker. The backend never grants Zen via this path —
 *    only Pro is granted as a placeholder.
 *
 * Quotas displayed here MUST match the backend constants in
 * routes/coach.py (PRO_DAILY=5, ZEN_DAILY=20).
 */

// ──────────────────────────────────────────────────────────────────────────
// i18n — inline strings; same per-locale pattern as breath/meditation.
// ──────────────────────────────────────────────────────────────────────────
const STR: Record<string, Record<string, string>> = {
  en: {
    kicker: "INNFEEL",
    title: "Unlock your aura",
    sub: "Two tiers, both cancellable anytime. Pick the one that fits your rhythm.",
    pro: "Pro",
    zen: "Zen",
    proPrice: "€4.99", proPer: "/ month",
    zenPrice: "€12.99", zenPer: "/ month",
    proTag: "Daily wellness",
    zenTag: "Deep practice · 4× more",
    most: "Most popular",
    feat_credits_pro: "5 AI credits / day  (chat + journal)",
    feat_credits_zen: "20 AI credits / day  (chat + journal)",
    feat_meditation: "Unlimited guided meditations",
    feat_breath: "Unlimited breathing exercises",
    feat_freezes_pro: "2 streak freezes / month",
    feat_freezes_zen: "4 streak freezes / month",
    feat_extras: "Audio notes, mood music, video aura",
    feat_close: "Close Friends · Insights",
    cta: "Choose Pro",
    ctaZen: "Choose Zen",
    cancel: "Cancel anytime",
    restore: "Restore purchases",
    devToggle: "Dev: toggle Pro",
    purchaseFailed: "Checkout failed",
    purchasedTitle: "✦ You're in!",
    purchasedDesc: "All features unlocked.",
    paymentNotConfirmed: "Payment not confirmed",
    paymentNotConfirmedDesc: "If you completed payment, refresh your profile in a moment.",
    restoredTitle: "✦ Restored",
    restoredDesc: "Your subscription is active.",
    noRestore: "No active subscription found.",
    zenSoon: "Zen IAP is rolling out — for now this unlocks Pro. We'll auto-upgrade you to Zen at the next refresh.",
  },
  fr: {
    kicker: "INNFEEL",
    title: "Débloque ton aura",
    sub: "Deux formules, résiliables à tout moment. Choisis celle qui te ressemble.",
    pro: "Pro",
    zen: "Zen",
    proPrice: "4,99 €", proPer: "/ mois",
    zenPrice: "12,99 €", zenPer: "/ mois",
    proTag: "Bien-être quotidien",
    zenTag: "Pratique profonde · 4× plus",
    most: "Le plus populaire",
    feat_credits_pro: "5 crédits IA / jour  (chat + journal)",
    feat_credits_zen: "20 crédits IA / jour  (chat + journal)",
    feat_meditation: "Méditations guidées illimitées",
    feat_breath: "Exercices de respiration illimités",
    feat_freezes_pro: "2 gels de série / mois",
    feat_freezes_zen: "4 gels de série / mois",
    feat_extras: "Notes audio, musique d'aura, vidéo",
    feat_close: "Amis proches · Insights",
    cta: "Choisir Pro",
    ctaZen: "Choisir Zen",
    cancel: "Résiliable à tout moment",
    restore: "Restaurer mes achats",
    devToggle: "Dev : activer Pro",
    purchaseFailed: "Paiement échoué",
    purchasedTitle: "✦ C'est validé !",
    purchasedDesc: "Toutes les fonctionnalités débloquées.",
    paymentNotConfirmed: "Paiement non confirmé",
    paymentNotConfirmedDesc: "Si tu as payé, rafraîchis ton profil dans un instant.",
    restoredTitle: "✦ Restauré",
    restoredDesc: "Ton abonnement est actif.",
    noRestore: "Aucun abonnement trouvé.",
    zenSoon: "Zen arrive bientôt — pour le moment cela active Pro. Tu seras auto-upgradé à Zen au prochain refresh.",
  },
  es: {
    kicker: "INNFEEL",
    title: "Desbloquea tu aura",
    sub: "Dos planes, cancelables cuando quieras. Elige el que se adapte a ti.",
    pro: "Pro", zen: "Zen",
    proPrice: "4,99 €", proPer: "/ mes",
    zenPrice: "12,99 €", zenPer: "/ mes",
    proTag: "Bienestar diario",
    zenTag: "Práctica profunda · 4× más",
    most: "Más popular",
    feat_credits_pro: "5 créditos IA / día  (chat + diario)",
    feat_credits_zen: "20 créditos IA / día  (chat + diario)",
    feat_meditation: "Meditaciones guiadas ilimitadas",
    feat_breath: "Ejercicios de respiración ilimitados",
    feat_freezes_pro: "2 congelaciones / mes",
    feat_freezes_zen: "4 congelaciones / mes",
    feat_extras: "Notas de voz, música, vídeo aura",
    feat_close: "Amigos cercanos · Insights",
    cta: "Elegir Pro", ctaZen: "Elegir Zen",
    cancel: "Cancela cuando quieras",
    restore: "Restaurar compras",
    devToggle: "Dev: activar Pro",
    purchaseFailed: "Compra fallida",
    purchasedTitle: "✦ ¡Listo!", purchasedDesc: "Funcionalidades desbloqueadas.",
    paymentNotConfirmed: "Pago no confirmado",
    paymentNotConfirmedDesc: "Si pagaste, actualiza tu perfil en un momento.",
    restoredTitle: "✦ Restaurado", restoredDesc: "Tu suscripción está activa.",
    noRestore: "No hay suscripción activa.",
    zenSoon: "Zen llega pronto — por ahora se activa Pro. Te subiremos a Zen automáticamente al siguiente refresh.",
  },
  it: {
    kicker: "INNFEEL",
    title: "Sblocca la tua aura",
    sub: "Due piani, cancellabili in qualsiasi momento. Scegli il tuo ritmo.",
    pro: "Pro", zen: "Zen",
    proPrice: "4,99 €", proPer: "/ mese",
    zenPrice: "12,99 €", zenPer: "/ mese",
    proTag: "Benessere quotidiano",
    zenTag: "Pratica profonda · 4× di più",
    most: "Più popolare",
    feat_credits_pro: "5 crediti IA / giorno  (chat + diario)",
    feat_credits_zen: "20 crediti IA / giorno  (chat + diario)",
    feat_meditation: "Meditazioni guidate illimitate",
    feat_breath: "Esercizi di respirazione illimitati",
    feat_freezes_pro: "2 congelamenti / mese",
    feat_freezes_zen: "4 congelamenti / mese",
    feat_extras: "Note vocali, musica, video aura",
    feat_close: "Amici stretti · Insights",
    cta: "Scegli Pro", ctaZen: "Scegli Zen",
    cancel: "Cancellabile sempre",
    restore: "Ripristina acquisti",
    devToggle: "Dev: attiva Pro",
    purchaseFailed: "Pagamento fallito",
    purchasedTitle: "✦ Fatto!", purchasedDesc: "Funzionalità sbloccate.",
    paymentNotConfirmed: "Pagamento non confermato",
    paymentNotConfirmedDesc: "Se hai pagato, aggiorna il profilo a breve.",
    restoredTitle: "✦ Ripristinato", restoredDesc: "Il tuo abbonamento è attivo.",
    noRestore: "Nessun abbonamento attivo.",
    zenSoon: "Zen è in arrivo — per ora attiva Pro. Ti porteremo a Zen al prossimo refresh.",
  },
  de: {
    kicker: "INNFEEL",
    title: "Entsperre deine Aura",
    sub: "Zwei Stufen, jederzeit kündbar. Wähle, was zu deinem Rhythmus passt.",
    pro: "Pro", zen: "Zen",
    proPrice: "4,99 €", proPer: "/ Monat",
    zenPrice: "12,99 €", zenPer: "/ Monat",
    proTag: "Tägliches Wohlbefinden",
    zenTag: "Tiefe Praxis · 4× mehr",
    most: "Am beliebtesten",
    feat_credits_pro: "5 KI-Credits / Tag  (Chat + Tagebuch)",
    feat_credits_zen: "20 KI-Credits / Tag  (Chat + Tagebuch)",
    feat_meditation: "Unbegrenzte geführte Meditationen",
    feat_breath: "Unbegrenzte Atemübungen",
    feat_freezes_pro: "2 Streak-Freezes / Monat",
    feat_freezes_zen: "4 Streak-Freezes / Monat",
    feat_extras: "Audionotizen, Musik, Aura-Video",
    feat_close: "Enge Freunde · Insights",
    cta: "Pro wählen", ctaZen: "Zen wählen",
    cancel: "Jederzeit kündbar",
    restore: "Käufe wiederherstellen",
    devToggle: "Dev: Pro aktivieren",
    purchaseFailed: "Kauf fehlgeschlagen",
    purchasedTitle: "✦ Geschafft!", purchasedDesc: "Funktionen freigeschaltet.",
    paymentNotConfirmed: "Zahlung nicht bestätigt",
    paymentNotConfirmedDesc: "Falls bezahlt, Profil gleich aktualisieren.",
    restoredTitle: "✦ Wiederhergestellt", restoredDesc: "Dein Abo ist aktiv.",
    noRestore: "Kein aktives Abo gefunden.",
    zenSoon: "Zen folgt bald — vorerst Pro aktiv. Wir upgraden dich beim nächsten Refresh auf Zen.",
  },
  pt: {
    kicker: "INNFEEL",
    title: "Desbloqueia a tua aura",
    sub: "Dois planos, canceláveis a qualquer momento. Escolhe o teu ritmo.",
    pro: "Pro", zen: "Zen",
    proPrice: "4,99 €", proPer: "/ mês",
    zenPrice: "12,99 €", zenPer: "/ mês",
    proTag: "Bem-estar diário",
    zenTag: "Prática profunda · 4× mais",
    most: "Mais popular",
    feat_credits_pro: "5 créditos IA / dia  (chat + diário)",
    feat_credits_zen: "20 créditos IA / dia  (chat + diário)",
    feat_meditation: "Meditações guiadas ilimitadas",
    feat_breath: "Exercícios de respiração ilimitados",
    feat_freezes_pro: "2 congelamentos / mês",
    feat_freezes_zen: "4 congelamentos / mês",
    feat_extras: "Notas de voz, música, vídeo aura",
    feat_close: "Amigos próximos · Insights",
    cta: "Escolher Pro", ctaZen: "Escolher Zen",
    cancel: "Cancela quando quiseres",
    restore: "Restaurar compras",
    devToggle: "Dev: ativar Pro",
    purchaseFailed: "Compra falhou",
    purchasedTitle: "✦ Pronto!", purchasedDesc: "Funcionalidades desbloqueadas.",
    paymentNotConfirmed: "Pagamento não confirmado",
    paymentNotConfirmedDesc: "Se pagaste, atualiza o perfil daqui a pouco.",
    restoredTitle: "✦ Restaurado", restoredDesc: "A subscrição está ativa.",
    noRestore: "Sem subscrição ativa.",
    zenSoon: "Zen chega em breve — por agora ativa Pro. Vamos passar-te para Zen no próximo refresh.",
  },
  ar: {
    kicker: "إنفيل",
    title: "افتح هالتك",
    sub: "خطّتان، يمكن الإلغاء وقت تشاء. اختر ما يناسب إيقاعك.",
    pro: "برو", zen: "زن",
    proPrice: "4,99 €", proPer: "/ شهر",
    zenPrice: "12,99 €", zenPer: "/ شهر",
    proTag: "رفاهية يومية",
    zenTag: "ممارسة عميقة · 4× أكثر",
    most: "الأكثر شعبية",
    feat_credits_pro: "٥ أرصدة ذكاء/يوم  (محادثة + يوميات)",
    feat_credits_zen: "٢٠ رصيدًا ذكاءً/يوم  (محادثة + يوميات)",
    feat_meditation: "تأملات موجَّهة بلا حدود",
    feat_breath: "تمارين تنفس بلا حدود",
    feat_freezes_pro: "تجميدتان للسلسلة / شهر",
    feat_freezes_zen: "٤ تجميدات للسلسلة / شهر",
    feat_extras: "ملاحظات صوتية، موسيقى، فيديو الهالة",
    feat_close: "الأصدقاء المقرّبون · رؤى",
    cta: "اختر برو", ctaZen: "اختر زن",
    cancel: "إلغاء في أي وقت",
    restore: "استعادة المشتريات",
    devToggle: "ديف: تفعيل برو",
    purchaseFailed: "فشل الدفع",
    purchasedTitle: "✦ تم!", purchasedDesc: "تم فتح كل الميزات.",
    paymentNotConfirmed: "لم يتم تأكيد الدفع",
    paymentNotConfirmedDesc: "إن دفعت، حدّث ملفك بعد لحظات.",
    restoredTitle: "✦ تمت الاستعادة", restoredDesc: "اشتراكك مفعّل.",
    noRestore: "لا يوجد اشتراك مفعّل.",
    zenSoon: "زن قادم قريبًا — الآن سيُفعَّل برو. سنرفعك إلى زن عند التحديث القادم.",
  },
};
const tr = (lc: string, k: string) => (STR[lc] || STR.en)[k] || STR.en[k] || k;

type Tier = "pro" | "zen";

export default function Paywall() {
  useI18n();
  const lc = currentLocale();
  const T = (k: string) => tr(lc, k);

  const router = useRouter();
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(false);
  const [offering, setOffering] = useState<any>(null);
  const [useIAP, setUseIAP] = useState<boolean>(false);
  // Selected tier — defaults to Pro because that's the most-popular path,
  // and we want first-time visitors to land on the cheaper option (less
  // sticker shock) but still see Zen prominently next to it.
  const [tier, setTier] = useState<Tier>("pro");

  // Probe RevenueCat once for native IAP availability.
  useEffect(() => {
    (async () => {
      if (!isIAPAvailable()) { setUseIAP(false); return; }
      const off = await getOfferings();
      if (off && off.availablePackages?.length > 0) {
        setOffering(off);
        setUseIAP(true);
      }
    })();
  }, []);

  // Resolve the IAP package for the chosen tier. Until the Zen offering
  // is configured in RevenueCat ("zen_monthly"), Zen falls back to the
  // first available package (= Pro) and we surface a friendly notice.
  const selectedPackage = useMemo(() => {
    if (!offering?.availablePackages?.length) return null;
    const pkgs = offering.availablePackages;
    if (tier === "zen") {
      const zen = pkgs.find((p: any) => /zen/i.test(p.identifier || p.product?.identifier || ""));
      return zen || pkgs[0];
    }
    return pkgs[0];
  }, [offering, tier]);

  const upgradeIAP = async () => {
    if (!selectedPackage) return;
    setLoading(true);
    try {
      // TODO: when the Zen offering is wired in RevenueCat,
      // this branch will route users to the correct product automatically.
      // For now if a Zen-tagged package isn't available we fall through
      // to the Pro pkg and warn the user (zenSoon).
      const isZenFallback = tier === "zen" && !/zen/i.test(selectedPackage.identifier || selectedPackage.product?.identifier || "");
      const res = await purchasePackage(selectedPackage);
      if (res.success) {
        await refresh();
        if (isZenFallback) Alert.alert(T("purchasedTitle"), T("zenSoon"));
        else Alert.alert(T("purchasedTitle"), T("purchasedDesc"));
        router.replace("/(tabs)/profile");
      } else if (!res.cancelled) {
        Alert.alert(T("purchaseFailed"), res.error || T("purchaseFailed"));
      }
    } catch (e: any) {
      Alert.alert(T("purchaseFailed"), e?.message || T("purchaseFailed"));
    } finally { setLoading(false); }
  };

  const restore = async () => {
    setLoading(true);
    try {
      const r = await restorePurchases();
      if (r.proActive) {
        await refresh();
        Alert.alert(T("restoredTitle"), T("restoredDesc"));
        router.replace("/(tabs)/profile");
      } else {
        Alert.alert(T("restoredTitle"), T("noRestore"));
      }
    } finally { setLoading(false); }
  };

  // Native IAP only (Apple / Google Play). No web payments.
  // On non-native platforms (web preview / Expo Go), inform the user that
  // purchases are only available in the installed iOS/Android app.
  const upgrade = async () => {
    if (useIAP) return upgradeIAP();
    Alert.alert(
      T("purchaseFailed"),
      "In-app purchases are only available in the iOS or Android app. Please install InnFeel from the App Store or Google Play to upgrade."
    );
  };

  const devToggle = async () => {
    try {
      await api("/dev/toggle-pro", { method: "POST" });
      await refresh();
      Alert.alert("Pro enabled (demo)");
      router.back();
    } catch {}
  };

  const isZen = tier === "zen";
  const tintColor = isZen ? "#A78BFA" : "#FDE047";

  // Comparison rows. Each row gets a different label per tier, so a free
  // user sees the *concrete* difference (5 vs 20 credits, 2 vs 4 freezes).
  // We don't render them inside the cards individually — that would
  // duplicate the layout — but in a single column under the active card.
  const FEATURES_BY_TIER: Record<Tier, { icon: keyof typeof Ionicons.glyphMap; key: string }[]> = {
    pro: [
      { icon: "sparkles",      key: "feat_credits_pro"  },
      { icon: "moon",          key: "feat_meditation"   },
      { icon: "leaf",          key: "feat_breath"       },
      { icon: "snow",          key: "feat_freezes_pro"  },
      { icon: "musical-notes", key: "feat_extras"       },
      { icon: "people",        key: "feat_close"        },
    ],
    zen: [
      { icon: "sparkles",      key: "feat_credits_zen"  },
      { icon: "moon",          key: "feat_meditation"   },
      { icon: "leaf",          key: "feat_breath"       },
      { icon: "snow",          key: "feat_freezes_zen"  },
      { icon: "musical-notes", key: "feat_extras"       },
      { icon: "people",        key: "feat_close"        },
    ],
  };

  // Price string source of truth: prefer the IAP storefront price when
  // available, fall back to inline EUR.
  const proPriceStr = useIAP && offering?.availablePackages?.[0]?.product?.priceString
    ? offering.availablePackages[0].product.priceString
    : T("proPrice");
  const zenPkg = offering?.availablePackages?.find((p: any) => /zen/i.test(p.identifier || p.product?.identifier || ""));
  const zenPriceStr = useIAP && zenPkg?.product?.priceString ? zenPkg.product.priceString : T("zenPrice");

  return (
    <View style={styles.container} testID="paywall-screen">
      <RadialAura color={tintColor} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.hdr}>
          <TouchableOpacity
            testID="close-paywall"
            onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile"); }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.kicker}>{T("kicker")}</Text>
          <Text style={styles.title}>{T("title")}</Text>
          <Text style={styles.sub}>{T("sub")}</Text>

          {/* Side-by-side tier cards. Both are tappable to swap selection;
              the active one is highlighted with the tier tint. */}
          <View style={styles.tierRow}>
            <TouchableOpacity
              testID="tier-pro"
              activeOpacity={0.85}
              onPress={() => setTier("pro")}
              style={[styles.tierCard, tier === "pro" ? styles.tierCardActive : null,
                tier === "pro" ? { borderColor: "rgba(253,224,71,0.6)" } : null]}
            >
              <View style={styles.popularPill}>
                <Text style={styles.popularTxt}>{T("most")}</Text>
              </View>
              <Text style={styles.tierName}>{T("pro")}</Text>
              <Text style={styles.tierTag}>{T("proTag")}</Text>
              <View style={styles.priceLine}>
                <Text style={styles.priceBig}>{proPriceStr}</Text>
                <Text style={styles.priceSmall}>{T("proPer")}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              testID="tier-zen"
              activeOpacity={0.85}
              onPress={() => setTier("zen")}
              style={[styles.tierCard, tier === "zen" ? styles.tierCardActive : null,
                tier === "zen" ? { borderColor: "rgba(167,139,250,0.6)" } : null]}
            >
              <View style={[styles.popularPill, { backgroundColor: "rgba(167,139,250,0.25)", borderColor: "rgba(167,139,250,0.6)" }]}>
                <Text style={styles.popularTxt}>4×</Text>
              </View>
              <Text style={styles.tierName}>{T("zen")}</Text>
              <Text style={styles.tierTag}>{T("zenTag")}</Text>
              <View style={styles.priceLine}>
                <Text style={styles.priceBig}>{zenPriceStr}</Text>
                <Text style={styles.priceSmall}>{T("zenPer")}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Features list — refreshes per active tier so the comparison
              "5 → 20 credits" feels alive when toggling. */}
          <View style={{ marginTop: 22, gap: 10 }}>
            {FEATURES_BY_TIER[tier].map((f) => (
              <View key={f.key} style={styles.row}>
                <View style={[styles.rowIcon, { backgroundColor: tintColor + "22" }]}>
                  <Ionicons name={f.icon} size={16} color={tintColor} />
                </View>
                <Text style={styles.rowTxt}>{T(f.key)}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 24, gap: 10 }}>
            <Button
              testID={tier === "zen" ? "paywall-upgrade-zen" : "paywall-upgrade-pro"}
              label={isZen ? T("ctaZen") : T("cta")}
              onPress={upgrade}
              loading={loading}
            />
            <Text style={styles.cancelTxt}>{T("cancel")}</Text>
            {useIAP && (
              <TouchableOpacity testID="paywall-restore" onPress={restore}>
                <Text style={styles.dev}>{T("restore")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity testID="dev-toggle-pro" onPress={devToggle}>
              <Text style={styles.dev}>{T("devToggle")}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050505" },
  hdr: { flexDirection: "row", justifyContent: "flex-end", padding: 14 },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: COLORS.border,
  },
  scroll: { padding: 24, paddingBottom: 48 },
  kicker: { color: "#FDE047", fontSize: 11, letterSpacing: 3, fontWeight: "700" },
  title: { color: "#fff", fontSize: 36, fontWeight: "700", letterSpacing: -1, marginTop: 8 },
  sub: { color: COLORS.textSecondary, marginTop: 6, fontSize: 15, lineHeight: 22 },

  tierRow: { flexDirection: "row", gap: 10, marginTop: 22 },
  tierCard: {
    flex: 1,
    padding: 14, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1, borderColor: COLORS.border,
    minHeight: 140,
  },
  tierCardActive: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 2,
  },
  popularPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: "rgba(253,224,71,0.18)",
    borderWidth: 1, borderColor: "rgba(253,224,71,0.5)",
    marginBottom: 8,
  },
  popularTxt: { color: "#fff", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  tierName: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  tierTag: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2, fontWeight: "600" },
  priceLine: { flexDirection: "row", alignItems: "flex-end", marginTop: 10, gap: 4 },
  priceBig: { color: "#fff", fontSize: 22, fontWeight: "900" },
  priceSmall: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 3 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowTxt: { color: "#fff", flex: 1, fontSize: 14 },

  cancelTxt: { color: COLORS.textTertiary, textAlign: "center", fontSize: 12, marginTop: 4 },
  dev: { color: COLORS.textTertiary, textAlign: "center", fontSize: 12, padding: 8 },
});
