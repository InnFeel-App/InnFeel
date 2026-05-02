# MoodDrop — PRD

## Idea
A daily social mood-sharing mobile app. Post once a day, unlock friends' moods. Premium emotional visual language inspired by a kaleidoscope of colors mapped to emotions.

## Tagline
Drop your mood. Unlock the others. See your emotional world in color.

## Stack
- Mobile: React Native (Expo Router, SDK 54)
- Backend: FastAPI + MongoDB (Motor)
- Auth: JWT email/password (Bearer + httpOnly cookie)
- Payments: Stripe Checkout via `emergentintegrations` (test keys)
- i18n: Auto-detects device locale (EN populated; FR/ES/IT/DE/PT/AR scaffolded with English fallback + RTL-ready)

## Core loop
1. Notification → Home screen shows "Drop your mood"
2. User selects emotion, word, intensity 1–5 (Pro: 1–10), optional photo, optional note (Pro), privacy
3. After posting, Friends feed unlocks for the day
4. React to friends' moods with lightweight emojis
5. Streak increments; stats update

## Free vs Pro
- Free: 1 drop/day · intensity 1–5 · word + color + photo · 7-day history · weekly stats · 25 friends
- Pro: intensity 1–10 · text/audio notes · unlimited history · 30/90/365 analytics · close friends · insights · no ads

## Implemented screens
Splash, 4-step onboarding, login, register, home (daily drop + locked feed), mood creation, friends, stats dashboard, profile, history, paywall, payment success, settings.

## Emotional palette (10)
calm #60A5FA · joy #FDE047 · love #F472B6 · anger #F87171 · anxiety #FB923C · sadness #818CF8 · focus #2DD4BF · excitement #F97316 · peace #34D399 · nostalgia #A78BFA

## Business enhancement
The daily-once reciprocity rule (post first, unlock feed) is the retention flywheel. Combined with Pro-only "close friends" + exportable mood cards, this drives both D1 retention and organic sharing. Paywall framed around emotional self-knowledge, not utility — higher willingness to pay.

## Non-goals (v1)
- Push notifications (scaffolded, not wired to real push)
- Audio recording (Pro badge visible; upload wired on backend, record UI deferred)
- Google social login (playbook collected; JWT email/password live)
