import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function fail(code: string, message: string, status = 400): Response {
  return json({ error: { code, message } }, status);
}

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Returns the signed-in user if they are the site owner, else null. */
export async function ownerFrom(req: Request): Promise<{ id: string; email?: string } | null> {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: row } = await admin.from("owner").select("id").eq("id", data.user.id).maybeSingle();
  return row ? { id: data.user.id, email: data.user.email } : null;
}

// ---- encryption for stored bank tokens (AES-GCM, key derived from the project's service key) ----
let keyPromise: Promise<CryptoKey> | null = null;
function key(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("my-money-token-key:" + SERVICE_KEY));
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    })();
  }
  return keyPromise;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(obj: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(obj))));
  return b64(iv) + "." + b64(ct);
}
export async function open<T = any>(s: string): Promise<T> {
  const [iv, ct] = s.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function getConn<T = any>(userId: string, provider: string): Promise<T | null> {
  const { data } = await admin.from("connections").select("data").eq("user_id", userId).eq("provider", provider).maybeSingle();
  return data ? await open<T>(data.data) : null;
}
export async function setConn(userId: string, provider: string, value: unknown) {
  const { error } = await admin.from("connections").upsert({ user_id: userId, provider, data: await seal(value), updated_at: new Date().toISOString() });
  if (error) throw error;
}
export async function delConn(userId: string, provider: string) {
  await admin.from("connections").delete().eq("user_id", userId).eq("provider", provider);
}

export function randomString(n = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return b64(a).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sha256b64url(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return b64(d).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
