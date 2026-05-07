import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api";
import { COLORS } from "../theme";
import { currentLocale, useI18n } from "../i18n";

/**
 * StreakFreezeCard — streak-freeze wallet + bundle upsell.
 *
 * Lives on the Stats page just below the streak counter.
 *
 * Visibility rules
 * ────────────────
 *  • Always shown if the user has any freeze available (monthly or bundle),
 *    if yesterday is freezable, or if they're Pro/Zen with non-zero quota.
 *  • Bundle upsell button is shown ONLY when the server marks
 *    `bundle.eligible` (streak ≥ 7 AND not already purchased this month).
 *
 * Localization strategy
 * ─────────────────────
 * Inline 7-locale strings (same pattern as /breath and /meditation) so the
 * card is self-contained and ships a consistent voice in every language.
 * We resubscribe to `useI18n()` so the card re-renders when the user
 * switches language from Profile → Settings.
 *
 * Payment integration
 * ───────────────────
 * The backend `/streak/bundle/purchase` endpoint is currently a
 * placeholder — it grants the freezes without verifying a real payment
 * receipt. Real IAP (RevenueCat / Stripe) will be wired in once the user
 * finishes `/app/memory/STRIPE_SETUP_GUIDE.md`. The client flow here is
 * production-ready: only one call-site needs to swap from a direct POST
 * to "IAP checkout → verify receipt → POST" later.
 */

type FreezeStatus = {
  plan: "free" | "pro" | "zen" | string;
  quota: number;
  used_this_month: number;
  monthly_remaining: number;
  bundle_remaining: number;
  remaining: number;
  can_freeze_yesterday: boolean;
  yesterday_key: string;
  current_streak: number;
  bundle: {
    eligible: boolean;
    min_streak: number;
    freezes: number;
    price_eur: number;
    purchased_this_month: boolean;
  };
};

// ──────────────────────────────────────────────────────────────────────────
// i18n — inline strings (7 locales). Keep phrases short so they fit mobile
// layouts; pluralisation handled via two variants where it matters.
// ──────────────────────────────────────────────────────────────────────────
const STR: Record<string, Record<string, string>> = {
  en: {
    title: "Streak freeze",
    planFree: "Free", planPro: "Pro", planZen: "Zen",
    subMonthly: "{m}/{q} monthly",
    subBundle: " · +{b} bundle",
    subBundleOnly: "{b} bundle freeze",
    subBundleOnlyPlural: "{b} bundle freezes",
    subNone: "No freezes — upgrade to Pro or grab a bundle",
    saveStreak: "Save my streak (yesterday)",
    savedTitle: "Streak saved ❄️",
    savedDesc: "Yesterday is now bridged. Your streak is {n} day{s} strong.",
    saveFailedTitle: "Couldn't apply freeze",
    saveFailedDesc: "Try again later.",
    bundleBtn: "+{n} freezes · €{p}",
    purchasedThisMonth: "✓ Bundle purchased this month",
    bundleLockedCountdown: "Bundle unlocks at a {min}-day streak (you're at {cur})",
    modalTitle: "+{n} streak freezes",
    modalDesc: "Add a safety net to your streak. Use them any time you miss a day — they don't expire and stack with your monthly quota.",
    benefitNoExpire: "Never expire — use them whenever",
    benefitStack: "Stack on top of your monthly freezes",
    benefitOneTime: "One-time purchase, no subscription",
    priceOneTime: "one-time · 1 bundle/month",
    buyNow: "Buy now",
    maybeLater: "Maybe later",
    purchaseFailedTitle: "Purchase failed",
    purchaseFailedDesc: "Try again later.",
    grantedTitle: "Freezes added ❄️",
    grantedDesc: "+{g} freezes are now in your wallet. You have {r} bundle freeze{s} available.",
  },
  fr: {
    title: "Gel de série",
    planFree: "Gratuit", planPro: "Pro", planZen: "Zen",
    subMonthly: "{m}/{q} ce mois",
    subBundle: " · +{b} pack",
    subBundleOnly: "{b} gel en pack",
    subBundleOnlyPlural: "{b} gels en pack",
    subNone: "Aucun gel — passe Pro ou prends un pack",
    saveStreak: "Sauver ma série (hier)",
    savedTitle: "Série sauvée ❄️",
    savedDesc: "Hier est comblé. Ta série tient à {n} jour{s}.",
    saveFailedTitle: "Gel impossible",
    saveFailedDesc: "Réessaie plus tard.",
    bundleBtn: "+{n} gels · {p} €",
    purchasedThisMonth: "✓ Pack déjà acheté ce mois",
    bundleLockedCountdown: "Le pack se débloque à {min} jours de série (tu en as {cur})",
    modalTitle: "+{n} gels de série",
    modalDesc: "Ajoute un filet de sécurité à ta série. Utilise-les si tu rates un jour — ils n'expirent pas et s'ajoutent à ton quota mensuel.",
    benefitNoExpire: "N'expirent jamais — utilise-les quand tu veux",
    benefitStack: "S'ajoutent à tes gels mensuels",
    benefitOneTime: "Achat unique, pas d'abonnement",
    priceOneTime: "paiement unique · 1 pack/mois",
    buyNow: "Acheter",
    maybeLater: "Plus tard",
    purchaseFailedTitle: "Achat échoué",
    purchaseFailedDesc: "Réessaie plus tard.",
    grantedTitle: "Gels ajoutés ❄️",
    grantedDesc: "+{g} gels sont dans ton portefeuille. Il te reste {r} gel{s} en pack.",
  },
  es: {
    title: "Congelar racha",
    planFree: "Gratis", planPro: "Pro", planZen: "Zen",
    subMonthly: "{m}/{q} mensuales",
    subBundle: " · +{b} pack",
    subBundleOnly: "{b} congelación en pack",
    subBundleOnlyPlural: "{b} congelaciones en pack",
    subNone: "Sin congelaciones — hazte Pro o compra un pack",
    saveStreak: "Salvar mi racha (ayer)",
    savedTitle: "Racha salvada ❄️",
    savedDesc: "Ayer está cubierto. Tu racha está en {n} día{s}.",
    saveFailedTitle: "No se pudo congelar",
    saveFailedDesc: "Inténtalo de nuevo.",
    bundleBtn: "+{n} congelaciones · {p} €",
    purchasedThisMonth: "✓ Pack comprado este mes",
    bundleLockedCountdown: "El pack se desbloquea a los {min} días (llevas {cur})",
    modalTitle: "+{n} congelaciones de racha",
    modalDesc: "Añade una red de seguridad a tu racha. Úsalas cuando falles un día — no caducan y se suman a tu cuota mensual.",
    benefitNoExpire: "No caducan — úsalas cuando quieras",
    benefitStack: "Se suman a tus congelaciones mensuales",
    benefitOneTime: "Compra única, sin suscripción",
    priceOneTime: "pago único · 1 pack/mes",
    buyNow: "Comprar",
    maybeLater: "Quizás más tarde",
    purchaseFailedTitle: "Compra fallida",
    purchaseFailedDesc: "Inténtalo de nuevo.",
    grantedTitle: "Congelaciones añadidas ❄️",
    grantedDesc: "+{g} congelaciones están en tu cartera. Te quedan {r} en el pack.",
  },
  it: {
    title: "Congelamento della serie",
    planFree: "Gratis", planPro: "Pro", planZen: "Zen",
    subMonthly: "{m}/{q} al mese",
    subBundle: " · +{b} pacchetto",
    subBundleOnly: "{b} congelamento pacchetto",
    subBundleOnlyPlural: "{b} congelamenti pacchetto",
    subNone: "Nessun congelamento — passa a Pro o prendi un pacchetto",
    saveStreak: "Salva la mia serie (ieri)",
    savedTitle: "Serie salvata ❄️",
    savedDesc: "Ieri è coperto. La tua serie è a {n} giorn{s}.",
    saveFailedTitle: "Congelamento non riuscito",
    saveFailedDesc: "Riprova più tardi.",
    bundleBtn: "+{n} congelamenti · {p} €",
    purchasedThisMonth: "✓ Pacchetto già acquistato questo mese",
    bundleLockedCountdown: "Il pacchetto si sblocca a {min} giorni (sei a {cur})",
    modalTitle: "+{n} congelamenti",
    modalDesc: "Aggiungi una rete di sicurezza alla serie. Usali quando salti un giorno — non scadono e si sommano alla quota mensile.",
    benefitNoExpire: "Non scadono — usali quando vuoi",
    benefitStack: "Si sommano ai tuoi congelamenti mensili",
    benefitOneTime: "Acquisto unico, nessun abbonamento",
    priceOneTime: "pagamento unico · 1 pacchetto/mese",
    buyNow: "Compra",
    maybeLater: "Forse più tardi",
    purchaseFailedTitle: "Acquisto fallito",
    purchaseFailedDesc: "Riprova più tardi.",
    grantedTitle: "Congelamenti aggiunti ❄️",
    grantedDesc: "+{g} congelamenti sono nel tuo portafoglio. Ne hai {r} nel pacchetto.",
  },
  de: {
    title: "Serien-Einfrierung",
    planFree: "Gratis", planPro: "Pro", planZen: "Zen",
    subMonthly: "{m}/{q} monatlich",
    subBundle: " · +{b} Paket",
    subBundleOnly: "{b} Paket-Einfrierung",
    subBundleOnlyPlural: "{b} Paket-Einfrierungen",
    subNone: "Keine Einfrierungen — werde Pro oder kaufe ein Paket",
    saveStreak: "Meine Serie retten (gestern)",
    savedTitle: "Serie gerettet ❄️",
    savedDesc: "Gestern überbrückt. Deine Serie steht bei {n} Tag{s}.",
    saveFailedTitle: "Einfrieren fehlgeschlagen",
    saveFailedDesc: "Versuch es später.",
    bundleBtn: "+{n} Einfrierungen · {p} €",
    purchasedThisMonth: "✓ Paket bereits diesen Monat gekauft",
    bundleLockedCountdown: "Paket entsperrt bei {min} Tagen (du bist bei {cur})",
    modalTitle: "+{n} Serien-Einfrierungen",
    modalDesc: "Füge deiner Serie ein Sicherheitsnetz hinzu. Setze sie ein, wenn du einen Tag verpasst — sie verfallen nicht und addieren sich zum monatlichen Kontingent.",
    benefitNoExpire: "Verfallen nie — benutze sie jederzeit",
    benefitStack: "Addieren sich zu deinen monatlichen Einfrierungen",
    benefitOneTime: "Einmalkauf, kein Abo",
    priceOneTime: "Einmalzahlung · 1 Paket/Monat",
    buyNow: "Kaufen",
    maybeLater: "Später",
    purchaseFailedTitle: "Kauf fehlgeschlagen",
    purchaseFailedDesc: "Versuch es später.",
    grantedTitle: "Einfrierungen hinzugefügt ❄️",
    grantedDesc: "+{g} Einfrierungen sind in deiner Wallet. Du hast noch {r} Paket-Einfrierung{s}.",
  },
  pt: {
    title: "Congelamento de série",
    planFree: "Grátis", planPro: "Pro", planZen: "Zen",
    subMonthly: "{m}/{q} mensais",
    subBundle: " · +{b} pacote",
    subBundleOnly: "{b} congelamento de pacote",
    subBundleOnlyPlural: "{b} congelamentos de pacote",
    subNone: "Sem congelamentos — sobe para Pro ou compra um pacote",
    saveStreak: "Salvar a minha série (ontem)",
    savedTitle: "Série salva ❄️",
    savedDesc: "Ontem está coberto. A tua série está em {n} dia{s}.",
    saveFailedTitle: "Não foi possível congelar",
    saveFailedDesc: "Tenta novamente.",
    bundleBtn: "+{n} congelamentos · {p} €",
    purchasedThisMonth: "✓ Pacote já comprado este mês",
    bundleLockedCountdown: "O pacote abre aos {min} dias (estás em {cur})",
    modalTitle: "+{n} congelamentos de série",
    modalDesc: "Adiciona uma rede de segurança à tua série. Usa-os quando falhares um dia — não expiram e somam-se à quota mensal.",
    benefitNoExpire: "Não expiram — usa-os quando quiseres",
    benefitStack: "Somam-se aos teus congelamentos mensais",
    benefitOneTime: "Compra única, sem assinatura",
    priceOneTime: "pagamento único · 1 pacote/mês",
    buyNow: "Comprar",
    maybeLater: "Talvez depois",
    purchaseFailedTitle: "Compra falhou",
    purchaseFailedDesc: "Tenta novamente.",
    grantedTitle: "Congelamentos adicionados ❄️",
    grantedDesc: "+{g} congelamentos estão na tua carteira. Ainda tens {r} no pacote.",
  },
  ar: {
    title: "تجميد السلسلة",
    planFree: "مجاني", planPro: "برو", planZen: "زن",
    subMonthly: "{m}/{q} شهريًا",
    subBundle: " · +{b} حزمة",
    subBundleOnly: "{b} تجميد من الحزمة",
    subBundleOnlyPlural: "{b} تجميدات من الحزمة",
    subNone: "لا توجد تجميدات — ترقّ إلى برو أو احصل على حزمة",
    saveStreak: "أنقذ سلسلتي (أمس)",
    savedTitle: "تم إنقاذ السلسلة ❄️",
    savedDesc: "تم تجسير يوم أمس. سلسلتك الآن {n} يوم.",
    saveFailedTitle: "تعذّر التجميد",
    saveFailedDesc: "حاول مجددًا لاحقًا.",
    bundleBtn: "+{n} تجميدات · {p} €",
    purchasedThisMonth: "✓ تم شراء الحزمة هذا الشهر",
    bundleLockedCountdown: "تُفتح الحزمة عند سلسلة {min} يومًا (أنت عند {cur})",
    modalTitle: "+{n} تجميدات سلسلة",
    modalDesc: "أضف شبكة أمان لسلسلتك. استخدمها إذا فاتك يوم — لا تنتهي صلاحيتها وتُضاف إلى حصتك الشهرية.",
    benefitNoExpire: "لا تنتهي — استخدمها متى تريد",
    benefitStack: "تُضاف فوق تجميداتك الشهرية",
    benefitOneTime: "شراء لمرة واحدة، بلا اشتراك",
    priceOneTime: "دفعة واحدة · حزمة واحدة/شهر",
    buyNow: "اشترِ الآن",
    maybeLater: "ربما لاحقًا",
    purchaseFailedTitle: "فشل الشراء",
    purchaseFailedDesc: "حاول مجددًا لاحقًا.",
    grantedTitle: "تمت إضافة التجميدات ❄️",
    grantedDesc: "+{g} تجميدات أُضيفت إلى محفظتك. لديك {r} من الحزمة.",
  },
};

/** Mini template renderer: replaces `{key}` with values[key]. */
const fmt = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = values[k];
    return v === undefined ? "" : String(v);
  });

const tr = (lc: string, key: string) => (STR[lc] || STR.en)[key] || STR.en[key] || key;

export default function StreakFreezeCard({ onChange }: { onChange?: () => void }) {
  // Re-render on locale change so switching languages in Settings repaints
  // this card without reloading the Stats tab.
  useI18n();
  const lc = currentLocale();
  const T = useCallback((k: string) => tr(lc, k), [lc]);

  const [data, setData] = useState<FreezeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<FreezeStatus>("/streak/freeze-status");
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const useFreeze = useCallback(async () => {
    if (!data?.can_freeze_yesterday || acting) return;
    setActing(true);
    try {
      const res: any = await api("/streak/freeze", { method: "POST" });
      // `{s}` is a bare plural marker — e.g. "1 day" vs "3 days". We expand
      // it inline rather than via a full plural library since the UI copy is
      // short and the difference is always just the trailing "s" (or empty
      // string in Arabic/etc. where the template doesn't use it).
      const s = res.streak === 1 ? "" : "s";
      Alert.alert(
        T("savedTitle"),
        fmt(T("savedDesc"), { n: res.streak, s }),
      );
      await load();
      onChange?.();
    } catch (e: any) {
      Alert.alert(T("saveFailedTitle"), e?.message || T("saveFailedDesc"));
    } finally {
      setActing(false);
    }
  }, [data, acting, load, onChange, T]);

  const purchaseBundle = useCallback(async () => {
    if (acting) return;
    setActing(true);
    try {
      // NOTE: When RevenueCat / Stripe IAP is wired in, replace this single
      // API call with: iap.purchaseProduct("streak_freeze_bundle") →
      // verify receipt server-side → only THEN POST /bundle/purchase.
      const res: any = await api("/streak/bundle/purchase", { method: "POST" });
      setBundleOpen(false);
      const s = res.bundle_remaining === 1 ? "" : "s";
      Alert.alert(
        T("grantedTitle"),
        fmt(T("grantedDesc"), { g: res.freezes_granted, r: res.bundle_remaining, s }),
      );
      await load();
      onChange?.();
    } catch (e: any) {
      Alert.alert(T("purchaseFailedTitle"), e?.message || T("purchaseFailedDesc"));
    } finally {
      setActing(false);
    }
  }, [acting, load, onChange, T]);

  // Plan-tint derived once per render — drives the pill colour + card border.
  const planMeta = useMemo(() => {
    if (!data) return { tint: "#94A3B8", label: T("planFree") };
    if (data.plan === "zen") return { tint: "#A78BFA", label: T("planZen") };
    if (data.plan === "pro") return { tint: "#22D3EE", label: T("planPro") };
    return { tint: "#94A3B8", label: T("planFree") };
  }, [data, T]);

  if (loading && !data) return null;
  if (!data) return null;

  const hasAnyFreezes = data.remaining > 0;
  const showBundleOnly = data.bundle.eligible;
  const isPaid = data.plan === "pro" || data.plan === "zen";
  if (!hasAnyFreezes && !data.can_freeze_yesterday && !showBundleOnly && !isPaid) {
    return null;
  }

  // Price formatting: French uses comma-decimal ("1,99"), English dot-
  // decimal ("1.99"). A simple per-locale switch keeps this from feeling
  // localized-but-weird.
  const priceStr = (() => {
    const fixed = data.bundle.price_eur.toFixed(2);
    const useComma = ["fr", "es", "it", "de", "pt"].includes(lc);
    return useComma ? fixed.replace(".", ",") : fixed;
  })();

  return (
    <>
      <View style={[styles.card, { borderColor: planMeta.tint + "55" }]} testID="streak-freeze-card">
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <Ionicons name="snow" size={16} color="#7DD3FC" />
            <Text style={styles.title}>{T("title")}</Text>
            <View style={[styles.planBadge, { backgroundColor: planMeta.tint + "22", borderColor: planMeta.tint + "55" }]}>
              <Text style={[styles.planTxt, { color: planMeta.tint }]}>{planMeta.label}</Text>
            </View>
          </View>
          <Text style={styles.remaining}>
            {data.remaining}
            <Text style={styles.remainingSuffix}>
              {data.quota > 0 ? ` / ${data.quota + data.bundle_remaining}` : ""}
            </Text>
          </Text>
        </View>

        <View style={styles.subRow}>
          {data.quota > 0 ? (
            <Text style={styles.sub}>
              {fmt(T("subMonthly"), { m: data.monthly_remaining, q: data.quota })}
              {data.bundle_remaining > 0 ? fmt(T("subBundle"), { b: data.bundle_remaining }) : ""}
            </Text>
          ) : data.bundle_remaining > 0 ? (
            <Text style={styles.sub}>
              {fmt(
                data.bundle_remaining === 1 ? T("subBundleOnly") : T("subBundleOnlyPlural"),
                { b: data.bundle_remaining }
              )}
            </Text>
          ) : (
            <Text style={styles.sub}>{T("subNone")}</Text>
          )}
        </View>

        {data.can_freeze_yesterday ? (
          <TouchableOpacity
            testID="use-freeze-btn"
            onPress={useFreeze}
            disabled={acting}
            style={[styles.actionBtn, { backgroundColor: "#0EA5E9" }]}
          >
            {acting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="snow" size={16} color="#fff" />
                <Text style={styles.actionTxt}>{T("saveStreak")}</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}

        {data.bundle.eligible ? (
          <TouchableOpacity
            testID="open-bundle-btn"
            onPress={() => setBundleOpen(true)}
            style={[styles.bundleBtn, { borderColor: "#A78BFA66" }]}
          >
            <Ionicons name="gift" size={14} color="#A78BFA" />
            <Text style={styles.bundleBtnTxt}>
              {fmt(T("bundleBtn"), { n: data.bundle.freezes, p: priceStr })}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#A78BFA" />
          </TouchableOpacity>
        ) : data.bundle.purchased_this_month ? (
          <Text style={styles.locked}>{T("purchasedThisMonth")}</Text>
        ) : data.current_streak < data.bundle.min_streak ? (
          <Text style={styles.locked}>
            {fmt(T("bundleLockedCountdown"), {
              min: data.bundle.min_streak,
              cur: data.current_streak,
            })}
          </Text>
        ) : null}
      </View>

      {/* Bundle confirmation modal — richer than before: shows 3 benefits so
          the user understands WHY the bundle is worth it before tapping Buy. */}
      <Modal visible={bundleOpen} transparent animationType="fade" onRequestClose={() => setBundleOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="snow" size={32} color="#7DD3FC" />
            </View>
            <Text style={styles.modalTitle}>
              {fmt(T("modalTitle"), { n: data.bundle.freezes })}
            </Text>
            <Text style={styles.modalDesc}>{T("modalDesc")}</Text>

            {/* Benefits bullets — soft separator from the long description,
                each bullet calls out a specific advantage so the offer feels
                concrete rather than vague. */}
            <View style={styles.benefits}>
              {[
                { icon: "infinite" as const, text: T("benefitNoExpire") },
                { icon: "layers" as const,   text: T("benefitStack")   },
                { icon: "pricetag" as const, text: T("benefitOneTime") },
              ].map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <View style={styles.benefitIconWrap}>
                    <Ionicons name={b.icon} size={14} color="#A78BFA" />
                  </View>
                  <Text style={styles.benefitTxt}>{b.text}</Text>
                </View>
              ))}
            </View>

            <View style={styles.priceRow}>
              <Text style={styles.priceTxt}>€{priceStr}</Text>
              <Text style={styles.priceSub}>{T("priceOneTime")}</Text>
            </View>

            <TouchableOpacity
              testID="confirm-bundle-btn"
              style={[styles.modalCta, { backgroundColor: "#A78BFA" }]}
              onPress={purchaseBundle}
              disabled={acting}
            >
              {acting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalCtaTxt}>{T("buyNow")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setBundleOpen(false)} style={styles.modalCancel} disabled={acting}>
              <Text style={styles.modalCancelTxt}>{T("maybeLater")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: "rgba(125,211,252,0.06)",
    gap: 10,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleWrap: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  title: { color: "#fff", fontSize: 14, fontWeight: "700", letterSpacing: 0.3 },
  planBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  planTxt: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  remaining: { color: "#7DD3FC", fontSize: 28, fontWeight: "700" },
  remainingSuffix: { color: COLORS.textTertiary, fontSize: 13, fontWeight: "500" },
  subRow: {},
  sub: { color: COLORS.textSecondary, fontSize: 12 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  actionTxt: { color: "#fff", fontSize: 14, fontWeight: "700" },
  bundleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "rgba(167,139,250,0.08)",
    marginTop: 4,
  },
  bundleBtnTxt: { color: "#A78BFA", fontSize: 13, fontWeight: "700" },
  locked: { color: COLORS.textTertiary, fontSize: 11, textAlign: "center", marginTop: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#0F172A",
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: "#A78BFA33",
    alignItems: "center",
    gap: 12,
  },
  modalIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(125,211,252,0.15)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  modalDesc: { color: COLORS.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 18 },
  benefits: { width: "100%", gap: 10, marginTop: 6 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  benefitIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(167,139,250,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  benefitTxt: { color: "#fff", fontSize: 13, flex: 1, fontWeight: "500" },
  priceRow: { alignItems: "center", marginVertical: 8 },
  priceTxt: { color: "#fff", fontSize: 36, fontWeight: "800" },
  priceSub: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  modalCta: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 8,
  },
  modalCtaTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  modalCancel: { paddingVertical: 8 },
  modalCancelTxt: { color: COLORS.textSecondary, fontSize: 13 },
});
