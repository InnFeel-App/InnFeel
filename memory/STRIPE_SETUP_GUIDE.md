# 💳 Stripe Setup Guide — InnFeel Pro

> Guide complet pour activer les paiements Stripe sur InnFeel.
> Temps total : ~30 min de ton temps + 1-3 jours d'attente vérification Stripe.

---

## 📋 Vue d'ensemble

InnFeel utilise Stripe en **fallback** des achats in-app (RevenueCat) :
- **iOS / Android** : achat IAP via App Store / Play Store → géré par RevenueCat
- **Web / Lien direct / Pays sans IAP** : checkout Stripe → géré par cette config

Tu vendras **2 plans Pro** :
- 🟣 **InnFeel Pro Mensuel** — €4,99/mois
- 🟡 **InnFeel Pro Annuel** — €39,99/an (économie 33%)

---

## 🪜 Étape 1 — Créer le compte Stripe

### 1.1 Inscription
1. Va sur https://dashboard.stripe.com/register
2. Email pro de préférence (`hello@innfeel.app`)
3. Pays : **France** (ou ton pays de résidence fiscale)
4. Vérifier l'email (clic sur le lien reçu)

### 1.2 Activer le compte (compte business)
Dans **Activate your account** :
- **Business type** : `Individual` si auto-entrepreneur, `Company` si société
- **Business details** :
  - Legal name
  - Adresse complète
  - Numéro SIRET (si société) ou NIR (si auto-entrepreneur)
  - Site web : `https://innfeel.app`
  - Description : "Mood-sharing social app — premium subscription for advanced features"
  - MCC (code activité) : **5734** (Computer Software Stores) ou **7372** (Prepackaged Software)
- **Identité** : passeport ou carte d'identité — upload via le portail
- **Compte bancaire** : RIB français (IBAN + BIC) → Stripe verse tes revenus dessus tous les 7 jours par défaut

⏱️ **Vérification Stripe** : 1-3 jours ouvrés. Tu peux continuer ce setup en mode test pendant ce temps.

### 1.3 Activer la 2FA
**Settings → Personal → Two-step authentication** → Authenticator app (Google Auth / 1Password) — obligatoire pour passer en mode live.

---

## 🪜 Étape 2 — Créer les produits Pro

> Reste en **Test mode** (toggle en haut à droite) pour cette étape — on passera en Live à la fin.

### 2.1 Produit "InnFeel Pro"
**Products → + Add product** :
- **Name** : `InnFeel Pro`
- **Description** : `Unlimited friends, custom moods, advanced stats, ad-free experience.`
- **Image** : upload le logo InnFeel (1024x1024 PNG carré)
- **Statement descriptor** : `INNFEEL` (ce qui apparaît sur les relevés de carte)
- **Tax behavior** : `Exclusive` (la TVA s'ajoute au prix affiché)

### 2.2 Prix mensuel
Dans le produit InnFeel Pro → **Add price** :
- **Pricing model** : `Standard pricing`
- **Price** : `4.99 EUR`
- **Billing period** : `Monthly`
- **Lookup key** : `pro_monthly` ⚠️ EXACTEMENT cette valeur (le backend cherche cette clé)
- **Free trial** : 7 jours (optionnel mais recommandé pour conversion)
- Save → **copie le `price_xxxxxxxx`** dans un bloc-notes

### 2.3 Prix annuel
Same product → **Add another price** :
- **Price** : `39.99 EUR`
- **Billing period** : `Yearly`
- **Lookup key** : `pro_yearly`
- **Free trial** : 14 jours (plus long pour annuel justifié)
- Save → copie le second `price_xxxxxxxx`

---

## 🪜 Étape 3 — Configurer les webhooks

Stripe envoie des événements quand un paiement réussit/échoue/annule. Le backend InnFeel écoute déjà ces événements.

### 3.1 Créer l'endpoint
**Developers → Webhooks → + Add endpoint** :
- **Endpoint URL** : `https://api.innfeel.app/api/payments/webhook`
- **Description** : `InnFeel production webhook`
- **Events to send** (sélectionne ces 6) :
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- **API version** : laisse la valeur par défaut (Stripe gère la rétrocompat)

### 3.2 Copier le signing secret
Une fois créé, clique sur l'endpoint → **Signing secret → Reveal** → copie `whsec_xxxxxxxx` dans ton bloc-notes.

⚠️ **Ce secret est unique par environnement** (test vs live). Tu auras 2 webhooks au final : un pour test, un pour live.

---

## 🪜 Étape 4 — Customer Portal (auto-gestion abonnement)

Permet aux users de gérer leur abo eux-mêmes (annuler, mettre à jour la carte, télécharger les factures) sans te contacter.

**Settings → Billing → Customer portal** :
- ✅ Allow customers to update payment methods
- ✅ Allow customers to cancel subscriptions immediately
- ✅ Allow customers to switch plans (mensuel ↔ annuel)
- ✅ Allow customers to update billing addresses
- ❌ Pause subscriptions (à toi de voir, je désactive par défaut)
- **Branding** :
  - Logo : InnFeel
  - Brand color : `#A78BFA` (le violet InnFeel)
  - Privacy policy : `https://innfeel.app/privacy`
  - Terms of service : `https://innfeel.app/terms`

Save.

---

## 🪜 Étape 5 — Tax (TVA)

Stripe Tax calcule + collecte automatiquement la TVA selon le pays de tes users (France 20%, Allemagne 19%, etc.).

**Tax → Get started** :
- Activate Stripe Tax
- Pays d'origine : France
- Tax IDs : déclare ta TVA intra-communautaire si applicable (ex: `FR12345678901`)
- Threshold monitoring : Stripe te prévient quand tu dépasses les seuils EU OSS (€10k/an de ventes étrangères)

📌 Note : si tu es auto-entrepreneur sous le seuil de franchise TVA (€36 800 ou €91 900 selon activité), désactive Stripe Tax et ne collecte pas de TVA. Vérifie avec ton expert-comptable.

---

## 🪜 Étape 6 — Mode Live (production)

Une fois Stripe a vérifié ton identité (email "Account activated") :

### 6.1 Bascule en Live
Toggle **Test mode** → **Live mode** en haut à droite.

### 6.2 Refais les étapes 2 + 3 en Live
⚠️ Les produits/prix/webhooks sont **séparés entre test et live**. Tu dois recréer :
- Le produit + 2 prix `pro_monthly` / `pro_yearly`
- Le webhook `https://api.innfeel.app/api/payments/webhook` avec les 6 events

### 6.3 Récupère les nouvelles clés Live
**Developers → API keys** :
- `pk_live_xxxxxxxxxxxxxxxxxx` (Publishable key — peut être commitée dans le code mobile)
- `sk_live_xxxxxxxxxxxxxxxxxx` (Secret key — ⚠️ JAMAIS dans le code, uniquement dans `.env` backend)

---

## 🎯 Étape 7 — Me transmettre les clés (tu m'envoies, je code)

Quand tu as **les 4 valeurs ci-dessous**, copie-colle-les moi dans le chat :

```
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_MONTHLY=price_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_YEARLY=price_xxxxxxxxxxxxxxxxxxxxxxxx
```

Je m'occupe ensuite de :
- ✅ Câbler les checkout sessions (`POST /api/payments/checkout`)
- ✅ Le webhook handler avec verification de signature (`POST /api/payments/webhook`)
- ✅ Le mapping `price_id → plan` côté backend
- ✅ Le portail client (`POST /api/payments/portal`) pour gérer son abo
- ✅ Le sync abo → flag `is_pro` côté user
- ✅ Les tests E2E avec une carte de test Stripe (`4242 4242 4242 4242`)

---

## 🧪 Cartes de test pour TES tests en mode Live

Stripe accepte ces numéros même en Live mode :
| Numéro | Comportement |
|--------|--------------|
| `4242 4242 4242 4242` | Succès |
| `4000 0025 0000 3155` | 3DS challenge requis |
| `4000 0000 0000 9995` | Decline (insufficient funds) |
| `4000 0000 0000 0341` | Échec après création abo (utile pour tester webhook) |

CVC : n'importe quels 3 chiffres. Date : n'importe quelle date future.

---

## 🆘 Questions fréquentes

**Q : Si je suis auto-entrepreneur, je dois facturer la TVA ?**
R : Non si tu es sous le seuil de franchise TVA. Désactive Stripe Tax. Mention obligatoire sur facture : "TVA non applicable, art. 293 B du CGI".

**Q : Stripe prend combien de commission ?**
R : France/UE : 1,4% + €0,25 par paiement EU réussi (carte). 2,9% + €0,25 hors UE. Aucun frais d'abonnement mensuel.

**Q : Combien de temps avant que je touche l'argent ?**
R : 7 jours par défaut (le premier paiement met 7-14 jours). Tu peux passer en daily payouts après quelques mois.

**Q : Est-ce que je peux faire des codes promo ?**
R : Oui ! **Products → Coupons** — tu peux créer des codes (`LAUNCH50` -50% premier mois, etc.) et les passer dans le checkout.

**Q : Et si un user demande un remboursement ?**
R : Stripe Dashboard → Payments → cliquer sur le paiement → Refund. Possible jusqu'à 180 jours après. Le webhook `charge.refunded` peut être ajouté plus tard si on veut auto-révoquer le Pro.
