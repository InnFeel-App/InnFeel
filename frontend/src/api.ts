import { setItem, getItem, removeItem } from "./storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const TOKEN_KEY = "innfeel_access_token";

export async function saveToken(token: string) {
  await setItem(TOKEN_KEY, token);
}
export async function clearToken() {
  await removeItem(TOKEN_KEY);
}
export async function getToken(): Promise<string | null> {
  return getItem(TOKEN_KEY);
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any } = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg =
      (data && (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
