// Minimal i18n scaffold — structured for 7 languages (EN active; others stubbed)
import { useMemo } from "react";
import * as Localization from "expo-localization";

type Dict = Record<string, string>;

const en: Dict = {
  "app.name": "InnFeel",
  "app.tagline": "Share your aura. Unlock the others.",
  "onboarding.1.title": "One aura a day",
  "onboarding.1.body": "Share how you feel in 20 seconds. Just once a day.",
  "onboarding.2.title": "Share to unlock",
  "onboarding.2.body": "See your friends' auras only after you share yours.",
  "onboarding.3.title": "Your emotional world",
  "onboarding.3.body": "See your feelings over time in vivid color.",
  "onboarding.4.title": "Go Pro",
  "onboarding.4.body": "Unlock deeper insights, audio notes and close friends.",
  "cta.getStarted": "Get Started",
  "cta.next": "Next",
  "cta.skip": "Skip",
  "auth.login": "Log in",
  "auth.signup": "Sign up",
  "auth.welcomeBack": "Welcome back",
  "auth.createAccount": "Create your account",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.name": "Your name",
  "auth.continue": "Continue",
  "auth.switchToSignup": "New here? Create an account",
  "auth.switchToLogin": "Already have an account? Log in",
  "home.dropToday": "What is your aura today?",
  "home.dropCTA": "Share your aura",
  "home.feedLocked": "Share your aura to unlock your friends",
  "home.streak": "day streak",
  "home.friendsFeed": "Today from your friends",
  "home.noFriendsYet": "Add friends to see their auras here",
  "create.pickEmotion": "Pick an emotion",
  "create.word": "A word",
  "create.intensity": "Intensity",
  "create.photo": "Add a photo (optional)",
  "create.text": "Add a note",
  "create.audio": "Audio note",
  "create.privacy": "Visibility",
  "create.privacy.friends": "All friends",
  "create.privacy.close": "Close friends",
  "create.privacy.private": "Only me",
  "create.post": "Share it",
  "create.posted": "Aura shared",
  "stats.title": "Your emotional world",
  "stats.thisWeek": "This week",
  "stats.dominant": "Dominant aura",
  "stats.drops": "auras",
  "stats.byDay": "By day of week",
  "stats.distribution": "Aura distribution",
  "stats.insights": "Insights",
  "stats.proLock": "Unlock deeper insights with Pro",
  "friends.title": "Friends",
  "friends.add": "Add friend",
  "friends.addByEmail": "Add by email",
  "friends.dropped": "Shared today",
  "friends.notDropped": "Not yet",
  "friends.remove": "Remove",
  "history.title": "History",
  "history.empty": "No auras yet. Your first one will appear here.",
  "history.proLock": "Older than 7 days? Pro unlocks unlimited history.",
  "profile.title": "Profile",
  "profile.logout": "Log out",
  "profile.settings": "Settings",
  "profile.goPro": "Go Pro",
  "profile.youArePro": "You're Pro",
  "paywall.title": "InnFeel Pro",
  "paywall.subtitle": "Your emotional world, in full color.",
  "paywall.f1": "Unlimited aura history",
  "paywall.f2": "Advanced analytics & insights",
  "paywall.f3": "Audio, text & photo + word combos",
  "paywall.f4": "Custom labels & intensity 1–10",
  "paywall.f5": "Close friends circle",
  "paywall.f6": "Export beautiful aura cards",
  "paywall.cta": "Upgrade — $4.99/mo",
  "paywall.devToggle": "Try Pro (demo toggle)",
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.notifications": "Daily reminder",
  "settings.privacy": "Default visibility",
  "tab.home": "Home",
  "tab.friends": "Friends",
  "tab.stats": "Stats",
  "tab.profile": "Me",
  "common.loading": "Loading…",
  "common.cancel": "Cancel",
};

// Other languages: stubbed as fallback to English (structure preserved)
const LOCALES: Record<string, Dict> = { en, fr: {}, es: {}, it: {}, de: {}, pt: {}, ar: {} };

export function t(key: string): string {
  const locale = (Localization.getLocales?.()[0]?.languageCode || "en").toLowerCase();
  const dict = LOCALES[locale] || {};
  return dict[key] || en[key] || key;
}

export function useI18n() {
  return useMemo(() => ({ t }), []);
}

export function isRTL(): boolean {
  return (Localization.getLocales?.()[0]?.textDirection === "rtl") || false;
}
