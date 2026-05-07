# InnFeel Backend — Railway Deployment Guide

This document is the single source of truth for deploying the FastAPI backend
to Railway with MongoDB Atlas as the database. Follow it top-to-bottom on a
clean signup and you'll have `https://api.innfeel.app` live in ~45 minutes.

---

## 0. Architecture After Deploy

```
┌─────────────────────┐        ┌──────────────────────────┐        ┌─────────────────┐
│  Expo Mobile App    │  ──►   │  Railway (FastAPI 24/7)  │  ──►   │ MongoDB Atlas   │
│  (iOS / Android)    │        │  api.innfeel.app         │        │  M0 free tier   │
└─────────────────────┘        └──────────────────────────┘        └─────────────────┘
                                          │
                                          ├─► Cloudflare R2 (media)
                                          ├─► Emergent LLM Key (Claude/GPT)
                                          ├─► Resend (emails)
                                          ├─► Edge TTS (voices, no key)
                                          └─► Stripe / RevenueCat (payments)
```

---

## 1. MongoDB Atlas — Free M0 Cluster

1. Go to **https://cloud.mongodb.com** → "Sign up" with `support@innfeel.app`.
2. Once in, click **"Build a Database"** → choose the **M0 FREE** plan.
3. **Provider**: AWS · **Region**: closest to your users (e.g. `eu-west-3` Paris,
   `us-east-1` Virginia). Cluster name: `innfeel-prod`.
4. **Security → Quickstart**:
   - Create a DB user. Username: `innfeel`. Auto-generate a strong password
     and **save it somewhere safe** (you'll need it once for the connection
     string and never again).
   - Network Access → "Add IP Address" → click **"Allow access from anywhere"**
     (`0.0.0.0/0`). Required because Railway egresses from rotating IPs.
5. **Connect → Drivers → Python**. Copy the SRV connection string. Looks like:
   ```
   mongodb+srv://innfeel:<password>@innfeel-prod.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Replace `<password>` with the password you saved.
6. **Save this string** — you'll paste it into Railway as `MONGO_URL`.

### Optional but recommended
- Atlas → Database → "..." → **Backup** → enable continuous backups (free on M0).
- Atlas → Project Settings → Alerts → enable email alerts to `support@innfeel.app`.

---

## 2. GitHub — Push Code From Emergent

1. Sign up at **https://github.com** with `support@innfeel.app`.
2. Pick the username **`InnFeel-App`** (or `innfeel-app` if the capitalised
   one is taken — GitHub is case-insensitive).
3. Verify your email.
4. Back in your Emergent chat, click the **"Save to GitHub"** button (top
   right). Authorise GitHub, then create a new repo named **`innfeel`** under
   the `InnFeel-App` account. Push.
5. Confirm the repo is at `https://github.com/InnFeel-App/innfeel`.

> The `.gitignore` we shipped already excludes `backend/.env` and
> `frontend/.env`, so secrets stay out of GitHub.

---

## 3. Railway — Deploy the Backend

1. Go to **https://railway.app** → **"Login with GitHub"**. Authorise.
2. **Start a new project** → "Deploy from GitHub repo" → select
   `InnFeel-App/innfeel`.
3. Railway will detect the repo. After "Add variables", set:
   - **Root directory**: `backend`
4. **Variables → Raw editor** — paste the block below, replacing every
   placeholder with your real values (copy the source values from
   `/app/backend/.env`):

   ```
   MONGO_URL=mongodb+srv://innfeel:<password>@innfeel-prod.xxxxx.mongodb.net
   DB_NAME=innfeel_prod
   JWT_SECRET=<generate-with-openssl-rand-hex-32>
   EMERGENT_LLM_KEY=sk-emergent-9D26eE3272eC0781bB
   STRIPE_API_KEY=sk_test_emergent
   SPOTIFY_CLIENT_ID=6e5511e275e64835bc524d4f6d86292b
   SPOTIFY_CLIENT_SECRET=bdddaea0373c44bcb65df6c1462e1c2c
   RESEND_API_KEY=re_5YbemFVF_ExSGVWSHYqCrBSxstF6Z31Ho
   EMAIL_FROM=InnFeel <noreply@innfeel.app>
   R2_ACCOUNT_ID=cbe8e823dcd4a86364ef8ea350fb1bd4
   R2_ACCESS_KEY_ID=c083b0479b2cb9fb18d9b6f6e1b980ba
   R2_SECRET_ACCESS_KEY=eae1a7ff90bf5fe7a2ed1243b6baeca108e1dfa2c8d27349a9726636c76da7f7
   R2_BUCKET=innfeel-media
   R2_ENDPOINT_URL=https://cbe8e823dcd4a86364ef8ea350fb1bd4.r2.cloudflarestorage.com
   R2_PRESIGN_TTL_SECONDS=86400
   R2_PUBLIC_BASE_URL=https://cdn.innfeel.app
   CORS_ORIGINS=https://innfeel.app,https://www.innfeel.app,https://app.innfeel.app
   ```

5. Click **"Deploy"**. Railway uses the included `Procfile`+`railway.json`
   so the start command is automatic:
   ```
   uvicorn server:app --host 0.0.0.0 --port $PORT --workers 2
   ```
   Health check: `GET /api/health`. Build typically takes ~3 minutes.
6. Once green, Railway gives you a temporary URL like
   `innfeel-backend-production.up.railway.app`. **Test it**:
   ```bash
   curl https://<railway-url>/api/health     # {"ok":true,"db":true}
   curl https://<railway-url>/docs            # Swagger UI
   ```
7. Logs: Railway → your service → "Deployments" → "View Logs".

---

## 4. Custom Domain — Cloudflare → Railway

Since your DNS is on Cloudflare, the setup is **5 minutes total** with no
nameserver changes.

### 4a. Tell Railway about the domain
1. Railway → your service → **Settings → Domains** → "Custom Domain".
2. Enter `api.innfeel.app` and click **Add**.
3. Railway shows you a **CNAME target** like:
   `xxxx.up.railway.app`. Copy it.

### 4b. Add the CNAME on Cloudflare
1. Cloudflare → `innfeel.app` zone → **DNS → Records → Add record**.
2. Fill in:
   - Type: **CNAME**
   - Name: **api**
   - Target: `<the railway target you copied>`
   - Proxy status: **DNS only** (grey cloud ☁️ — orange proxy breaks
     Railway's TLS)
   - TTL: Auto
3. Save.

### 4c. Wait for SSL
- Railway auto-provisions a Let's Encrypt cert in 1–5 minutes.
- Once done, the domain shows a green check in Railway.
- Test: `curl https://api.innfeel.app/api/health` → `{"ok":true,"db":true}`.

---

## 5. Cutover — Update Mobile App

The agent will edit `/app/frontend/.env`:
```
EXPO_PUBLIC_BACKEND_URL=https://api.innfeel.app
```
Then restart Expo + smoke-test all flows (login, post mood, friends,
coach chat, meditation, paywall).

---

## 6. Decommission Old Emergent Backend

Wait **at least 7 days** with stable Railway traffic before turning off the
Emergent backend. Until then it costs nothing extra to keep both running.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Railway build fails on `pip install` | Stale `requirements.txt` | Re-run `pip freeze > requirements.txt` locally and re-push |
| `500 internal` on every request | `MONGO_URL` typo | Check the SRV string + URL-encode the password |
| `503` from Railway | Health check failing | Hit `/api/health` directly — usually DB unreachable |
| `CORS` error in Expo | Origin not allowed | Add the origin to `CORS_ORIGINS` env var, redeploy |
| `Application failed to respond` | Bound wrong port | We bind to `$PORT`; never hardcode 8001 in production |

---

Last updated: pre-launch v1.0
