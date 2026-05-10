# InnFeel — Landing Page

Static website for **innfeel.app**. Includes:

- `index.html` — Marketing landing page with hero, features, manifesto.
- `privacy.html` — Privacy Policy (GDPR + CCPA compliant). **Required by Apple for App Store / TestFlight External submissions.**
- `terms.html` — Terms of Service.

## URLs once deployed

- `https://innfeel.app` — Landing
- `https://innfeel.app/privacy` (or `/privacy.html`) — **Use this URL in App Store Connect**
- `https://innfeel.app/terms` — Terms

---

## 🚀 Deploy to Cloudflare Pages (recommended, FREE, ~3 min)

You already use Cloudflare for DNS (`api.innfeel.app`, `cdn.innfeel.app`), so adding Pages is the smoothest path.

### Steps

1. Go to **https://dash.cloudflare.com/** → your account
2. Sidebar → **Workers & Pages** → **Create application** → tab **Pages** → **Upload assets**
3. **Project name** : `innfeel-landing`
4. **Production branch** : leave default
5. Drag-and-drop the **entire `/app/landing/` folder contents** (3 HTML files) OR zip the folder and upload
6. Click **Deploy site** → ~30 sec
7. Cloudflare gives you a URL like `https://innfeel-landing.pages.dev`
8. **Custom domain** → **Add custom domain** → `innfeel.app`
9. Cloudflare detects the existing DNS zone → click **Activate domain**
10. Wait ~30 seconds for DNS propagation
11. ✅ `https://innfeel.app` is live

### Alternative: GitHub-based deploy
If you prefer auto-deploy on every push:
1. Create a new GitHub repo: `InnFeel-App/innfeel-landing`
2. Push the `/app/landing/` contents to it
3. In Cloudflare Pages → **Connect to Git** → select that repo
4. Build command : *(leave empty)* — pure static
5. Build output directory : `/`
6. Deploy → every push auto-rebuilds

---

## 📋 What to do AFTER deploy

### 1. App Store Connect — set Privacy Policy URL
Go to **App Store Connect → InnFeel → App Privacy → Privacy Policy URL** :
```
https://innfeel.app/privacy
```

### 2. TestFlight External Group
Same Privacy Policy URL field is required when you create your External Tester group.

### 3. Update TestFlight CTA in `index.html`
Once you have your TestFlight Public Link (after Beta App Review approval), edit the line:
```html
<a class="btn btn-primary" href="https://testflight.apple.com/" id="testflight-cta">Join the iOS Beta</a>
```
Replace the URL with your real TestFlight join link (`https://testflight.apple.com/join/XXXXXXX`).

---

## 🎨 Customization tips

- Add an OG image at `/og.png` (1200×630 px, displayed when sharing the link on social)
- Add `/favicon.png` (32×32 png) to remove the broken icon warning
- Translate the page (you can host `/fr/index.html`, `/es/index.html`, etc.)

---

## 📝 Email addresses to set up

The legal pages mention these — make sure they exist (Resend or Cloudflare Email Routing):

- `hello@innfeel.app` — General inquiries
- `support@innfeel.app` — User support  
- `privacy@innfeel.app` — GDPR/CCPA requests (legally required)
- `feedback@innfeel.app` — Beta feedback (optional)

In Cloudflare → Email → Email Routing, you can forward all of these to your real personal inbox in 2 minutes.
