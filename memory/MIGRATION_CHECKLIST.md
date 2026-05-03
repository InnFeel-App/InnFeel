# InnFeel — Migration test → production checklist

À exécuter AVANT la soumission Apple App Store / Google Play Store.

## 1. Domain / DNS
- [ ] Domaine `innfeel.app` (ou `.com`) acheté
- [ ] DNS pointant vers backend (Railway/Render/Fly)
- [ ] SSL/HTTPS actif (Let's Encrypt auto via Cloudflare)
- [ ] Email `support@innfeel.app` et `noreply@innfeel.app` opérationnels (iCloud+/Zoho/Migadu)

## 2. Backend hosting (Railway/Render/Fly)
- [ ] Variables d'environnement production :
  - [ ] `MONGO_URL` → MongoDB Atlas (pas la locale)
  - [ ] `DB_NAME` = `innfeel_prod`
  - [ ] `JWT_SECRET` → **nouveau secret fort** (≠ dev)
  - [ ] `STRIPE_API_KEY` → clé LIVE (sk_live_...)
  - [ ] `EMERGENT_LLM_KEY` → clé universelle
  - [ ] `REVENUECAT_API_KEY` (REST Secret Key)
  - [ ] `REVENUECAT_WEBHOOK_AUTH` (shared secret)
  - [ ] `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`
- [ ] `EXPO_BACKEND_URL` = `https://api.innfeel.app`
- [ ] Backend bindé sur `0.0.0.0:8001` (ou port fourni par hébergeur)
- [ ] MongoDB Atlas : IP allowlist incluant l'IP sortante de Railway

## 3. Paiements
### Stripe
- [ ] Produit "InnFeel Pro Monthly" créé sur Stripe dashboard (mode LIVE)
- [ ] Prix $4.99/month récurrent
- [ ] Webhook Stripe → `https://api.innfeel.app/api/payments/webhook` avec secret

### RevenueCat
- [ ] Compte RevenueCat créé (https://app.revenuecat.com)
- [ ] Apps iOS + Android créées (avec Bundle ID `app.innfeel` ou similaire)
- [ ] Apple App Store Connect lié (App Store Shared Secret + In-App Purchase Key)
- [ ] Google Play Service Account lié (JSON credentials)
- [ ] Stripe lié (API key LIVE) pour unifier Stripe + IAP dans RevenueCat
- [ ] Entitlement `pro` créé
- [ ] Offerings + packages (monthly + annual) attachés à des produits Apple/Google/Stripe
- [ ] Webhook `https://api.innfeel.app/api/iap/webhook` configuré avec Authorization header
- [ ] API keys publiques copiées dans `/app/frontend/.env` (`EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`)

## 4. Apple App Store
- [ ] Compte **Apple Developer Program** payé (99 $/an)
- [ ] App créée dans App Store Connect (Bundle ID `app.innfeel`)
- [ ] In-App Purchase products créés : `innfeel_pro_monthly`, `innfeel_pro_annual`
- [ ] Métadonnées App Store remplies (description FR+EN, captures d'écran, icône, rating)
- [ ] **Privacy labels** (obligatoire) : données collectées, à quoi elles servent
- [ ] **Privacy Policy URL** : `https://innfeel.app/privacy` (page web miroir)
- [ ] **Terms of Use URL (EULA)** : `https://innfeel.app/terms`
- [ ] App Review info : comptes de test `hello@innfeel.app` + `luna@innfeel.app`
- [ ] TestFlight build uploadé via EAS Build
- [ ] Permissions iOS déclarées dans `app.json` avec messages courts et explicites

## 5. Google Play Store
- [ ] Compte **Google Play Console** payé (25 $ à vie)
- [ ] App créée (applicationId `app.innfeel`)
- [ ] Subscriptions créées avec SKU et prix
- [ ] **Data Safety form** rempli (équivalent privacy labels)
- [ ] Privacy Policy URL même URL que Apple
- [ ] Content rating questionnaire rempli
- [ ] Permissions Android déclarées dans `app.json`
- [ ] AAB uploadé via EAS Build

## 6. EAS Build Setup
- [ ] Compte Expo (gratuit ou EAS 29 $/mois)
- [ ] `eas.json` configuré avec profils `development`, `preview`, `production`
- [ ] `projectId` dans `app.json.expo.extra.eas.projectId`
- [ ] Certificats iOS générés via `eas credentials`
- [ ] Google Service Account key ajoutée dans EAS
- [ ] First build : `eas build --platform all --profile production`

## 7. Push notifications
- [ ] iOS : APNS key générée dans Apple Developer + uploadée dans EAS
- [ ] Android : FCM server key (via Firebase project)
- [ ] Tester que les push server-side arrivent depuis un device physique (pas Expo Go)

## 8. Emails transactionnels
- [ ] Compte **Resend** (gratuit 3000 emails/mois) créé
- [ ] Domaine `innfeel.app` vérifié dans Resend (SPF + DKIM + DMARC)
- [ ] API key Resend ajoutée dans `/app/backend/.env` (`RESEND_API_KEY`)
- [ ] Endpoints email (welcome, password reset) câblés à Resend

## 9. Monitoring / analytics (optionnel)
- [ ] Sentry pour crashs backend + frontend (gratuit jusqu'à 5k erreurs/mois)
- [ ] PostHog ou Mixpanel pour analytics produit (gratuit)

## 10. Sécurité
- [ ] Rotation de `JWT_SECRET` effectuée (différent de dev)
- [ ] Mots de passe admin changés : `hello@innfeel.app` ≠ `admin123`
- [ ] Seed scripts désactivés en production
- [ ] Dev-only endpoints supprimés ou gated : `/dev/toggle-pro`, `/admin/grant-pro` accessible uniquement aux admins réels
- [ ] Rate limiting backend (fastapi-limiter) sur endpoints auth

## 11. Légal
- [ ] Pages web statiques `innfeel.app/terms` et `innfeel.app/privacy` (cohérentes avec l'in-app)
- [ ] Email `support@innfeel.app` qui route vers ta vraie boîte
- [ ] DPO/contact GDPR mentionné sur Privacy (obligatoire UE)
- [ ] Si tu collectes des emails marketing : double opt-in (GDPR)

## 12. App config finale
- [ ] Version bump `1.0.0` dans `app.json`
- [ ] Icons `1024x1024` finales
- [ ] Splash screen final
- [ ] `expo.ios.bundleIdentifier` + `expo.android.package` = `app.innfeel`
- [ ] Deeplinks/universal links configurés si partage externe (innfeel://)

---
**Rappel**: NE JAMAIS uploader de build "staging" avec des clés dev. Chaque build de prod = `EAS_PROFILE=production`.
