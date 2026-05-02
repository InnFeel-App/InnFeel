import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Web fallback uses localStorage; native uses SecureStore (bundled in Expo Go).
// This avoids @react-native-async-storage/async-storage which is not always shipped.

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try { (globalThis as any).localStorage?.setItem(key, value); } catch {}
    return;
  }
  try { await SecureStore.setItemAsync(key, value); } catch {}
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return (globalThis as any).localStorage?.getItem(key) || null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try { (globalThis as any).localStorage?.removeItem(key); } catch {}
    return;
  }
  try { await SecureStore.deleteItemAsync(key); } catch {}
}
