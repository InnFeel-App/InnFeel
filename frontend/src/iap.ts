/**
 * RevenueCat IAP wrapper (iOS + Android native builds).
 *
 * Critical: this module SAFELY degrades on:
 *  - Web (no IAP at all — falls back to Stripe)
 *  - Expo Go (native module absent — returns null)
 *  - Missing API keys (returns null without throwing)
 *
 * Consumers should treat a null return as "not available" and fall back to Stripe.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "./api";

let PurchasesModule: any = null;
let initialized = false;
let unavailable = false; // set to true if we detect Expo Go / web / no key

const IOS_KEY   = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || "";
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || "";

function isExpoGo(): boolean {
  // Expo Go's appOwnership is "expo"; standalone/EAS builds are "standalone" or null.
  return (Constants as any)?.appOwnership === "expo";
}

/** Lazy require so we never throw at JS parse time when the native module is absent. */
function requirePurchases(): any | null {
  if (PurchasesModule) return PurchasesModule;
  if (unavailable) return null;
  try {
    // Only attempt on native platforms
    if (Platform.OS === "web") { unavailable = true; return null; }
    if (isExpoGo()) { unavailable = true; return null; }
    const mod = require("react-native-purchases");
    PurchasesModule = mod?.default || mod;
    return PurchasesModule;
  } catch {
    unavailable = true;
    return null;
  }
}

/**
 * Initialise the RevenueCat SDK with the appropriate API key.
 * Safe to call repeatedly — only configures once.
 * Returns true if ready to use, false if unavailable.
 */
export async function initIAP(appUserId?: string): Promise<boolean> {
  if (initialized) return true;
  const P = requirePurchases();
  if (!P) return false;

  const key = Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY;
  if (!key) { unavailable = true; return false; }

  try {
    await P.configure({ apiKey: key, appUserID: appUserId || null });
    initialized = true;
    return true;
  } catch {
    unavailable = true;
    return false;
  }
}

/** Returns true when native IAP (RevenueCat) is available on this device/build. */
export function isIAPAvailable(): boolean {
  if (unavailable) return false;
  if (Platform.OS === "web") return false;
  if (isExpoGo()) return false;
  return !!(Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY);
}

/** Fetch the current offering (packages available for purchase). */
export async function getOfferings(): Promise<any | null> {
  const P = requirePurchases();
  if (!P || !initialized) return null;
  try {
    const off = await P.getOfferings();
    return off?.current || null;
  } catch {
    return null;
  }
}

/** Attempt to purchase a package. Returns {success, proActive} or {cancelled}. */
export async function purchasePackage(pkg: any): Promise<{ success: boolean; cancelled?: boolean; proActive?: boolean; error?: string }> {
  const P = requirePurchases();
  if (!P) return { success: false, error: "IAP unavailable" };
  try {
    const res = await P.purchasePackage(pkg);
    const proActive = !!res?.customerInfo?.entitlements?.active?.pro;
    // Ask backend to sync via RevenueCat REST so server has latest truth.
    try { await api("/iap/sync", { method: "POST" }); } catch {}
    return { success: true, proActive };
  } catch (e: any) {
    if (e?.userCancelled) return { success: false, cancelled: true };
    return { success: false, error: e?.message || "Purchase failed" };
  }
}

/** Restore prior purchases (for re-install, new device, etc.). */
export async function restorePurchases(): Promise<{ proActive: boolean }> {
  const P = requirePurchases();
  if (!P) return { proActive: false };
  try {
    const info = await P.restorePurchases();
    const proActive = !!info?.entitlements?.active?.pro;
    try { await api("/iap/sync", { method: "POST" }); } catch {}
    return { proActive };
  } catch {
    return { proActive: false };
  }
}

/** Identify the user to RevenueCat (use after login). */
export async function identifyIAP(appUserId: string): Promise<void> {
  const P = requirePurchases();
  if (!P || !initialized) return;
  try {
    await P.logIn(appUserId);
  } catch {}
}

export async function logoutIAP(): Promise<void> {
  const P = requirePurchases();
  if (!P || !initialized) return;
  try { await P.logOut(); } catch {}
}
