// LHV connection: logs in to LHV's own MCP server with your LHV account (OAuth + PKCE),
// keeps the tokens encrypted in the database, and exposes three READ-ONLY tools to the site.
import { admin, cors, delConn, fail, getConn, json, open, ownerFrom, randomString, seal, setConn, sha256b64url, SUPABASE_URL } from "../_shared/util.ts";

const MCP_URL = "https://mcp.lhv.ai/mcp";
const AUTH = "https://auth.lhv.ai/oauth2";
const SCOPE = "accounts:read transactions:read";
const REDIRECT = `${SUPABASE_URL}/functions/v1/lhv/callback`;
const ALLOWED_TOOLS = new Set(["list_accounts", "get_instrument_balances", "get_account_statement"]);

type Tokens = { access: string; refresh?: string; exp: number };
type Client = { client_id: string; client_secret?: string; redirect: string };

async function client(): Promise<Client> {
  const { data } = await admin.from("app_config").select("data").eq("key", "lhv_client").maybeSingle();
  if (data) {
    const c = await open<Client>(data.data);
    if (c.redirect === REDIRECT) return c;
  }
  const r = await fetch(`${AUTH}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "My Money (personal finance site)",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: SCOPE,
    }),
  });
  if (!r.ok) throw new Error(`LHV client registration failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const reg = await r.json();
  const c: Client = { client_id: reg.client_id, client_secret: reg.client_secret, redirect: REDIRECT };
  await admin.from("app_config").upsert({ key: "lhv_client", data: await seal(c), updated_at: new Date().toISOString() });
  return c;
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const c = await client();
  const body = new URLSearchParams({ ...params, client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), resource: MCP_URL });
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw Object.assign(new Error(`LHV token error (${r.status}): ${(await r.text()).slice(0, 300)}`), { code: "lhv_reconnect" });
  const t = await r.json();
  return { access: t.access_token, refresh: t.refresh_token || params.refresh_token, exp: Date.now() + (Number(t.expires_in || 300) - 30) * 1000 };
}

async function validTokens(userId: string, force = false): Promise<Tokens> {
  const t = await getConn<Tokens>(userId, "lhv");
  if (!t) throw Object.assign(new Error("LHV is not connected yet."), { code: "lhv_not_connected" });
  if (!force && t.exp > Date.now()) return t;
  if (!t.refresh) throw Object.assign(new Error("LHV login expired."), { code: "lhv_reconnect" });
  const nt = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh });
  await setConn(userId, "lhv", nt);
  return nt;
}

// ---- minimal MCP (Streamable HTTP) client ----
async function rpc(access: string, sid: string | null, msg: Record<string, unknown>) {
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(sid ? { "Mcp-Session-Id": sid } : {}),
    },
    body: JSON.stringify(msg),
  });
  const newSid = r.headers.get("mcp-session-id") || sid;
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("unauthorized"), { status: 401 });
  if (!("id" in msg)) return { sid: newSid, body: null };
  const text = await r.text();
  if (!r.ok) throw new Error(`LHV server error ${r.status}: ${text.slice(0, 300)}`);
  let body: any = null;
  if ((r.headers.get("content-type") || "").includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try { const o = JSON.parse(line.slice(5).trim()); if (o.id === msg.id) body = o; } catch { /* ignore */ }
    }
  } else body = JSON.parse(text);
  return { sid: newSid, body };
}

async function callTool(access: string, name: string, args: Record<string, unknown>) {
  const init = await rpc(access, null, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "my-money", version: "1.0" } },
  });
  await rpc(access, init.sid, { jsonrpc: "2.0", method: "notifications/initialized" });
  const res = await rpc(access, init.sid, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args || {} } });
  const b = res.body;
  if (!b) throw new Error("LHV did not answer.");
  if (b.error) throw new Error(b.error.message || "LHV error");
  const result = b.result || {};
  if (result.isError) throw new Error((result.content?.[0]?.text || "LHV tool error").slice(0, 300));
  if (result.structuredContent) return result.structuredContent;
  const t = result.content?.find((c: any) => c.type === "text")?.text;
  try { return JSON.parse(t); } catch { return t; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const route = url.pathname.split("/").pop();

  try {
    // Browser comes back here from LHV's login page (no Supabase session header on this request)
    if (route === "callback") {
      const state = url.searchParams.get("state") || "";
      const { data: st } = await admin.from("oauth_state").select("*").eq("state", state).maybeSingle();
      if (st) await admin.from("oauth_state").delete().eq("state", state);
      const back = (st?.return_to as string) || "";
      const go = (q: string) => back ? Response.redirect(back + (back.includes("?") ? "&" : "?") + q, 302) : new Response("Done. You can close this tab.", { headers: { "Content-Type": "text/plain" } });
      if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60e3) return go("lhv=expired");
      if (url.searchParams.get("error")) return go("lhv=declined");
      const code = url.searchParams.get("code");
      if (!code) return go("lhv=error");
      const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: st.verifier });
      await setConn(st.user_id, "lhv", t);
      return go("lhv=connected");
    }

    const user = await ownerFrom(req);
    if (!user) return fail("unauthorized", "Please log in.", 401);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (route === "connect") {
      const returnTo = String(body.return_to || "");
      if (!/^https?:\/\/[^\s]+$/.test(returnTo)) return fail("bad_request", "return_to must be the site URL.");
      const c = await client();
      const verifier = randomString(48), state = randomString(24);
      await admin.from("oauth_state").delete().lt("created_at", new Date(Date.now() - 3600e3).toISOString());
      await admin.from("oauth_state").insert({ state, user_id: user.id, verifier, return_to: returnTo.split("?")[0].split("#")[0] });
      const q = new URLSearchParams({
        response_type: "code", client_id: c.client_id, redirect_uri: REDIRECT, scope: SCOPE, state,
        code_challenge: await sha256b64url(verifier), code_challenge_method: "S256", resource: MCP_URL,
      });
      return json({ url: `${AUTH}/authorize?${q}` });
    }
    if (route === "status") return json({ connected: !!(await getConn(user.id, "lhv")) });
    if (route === "disconnect") { await delConn(user.id, "lhv"); return json({ ok: true }); }

    if (route === "call") {
      const tool = String(body.tool || "");
      if (!ALLOWED_TOOLS.has(tool)) return fail("not_allowed", "Only read-only LHV tools are allowed.", 403);
      let t = await validTokens(user.id);
      try { return json({ payload: await callTool(t.access, tool, body.args || {}) }); }
      catch (e: any) {
        if (e?.status !== 401) throw e;
        t = await validTokens(user.id, true);
        return json({ payload: await callTool(t.access, tool, body.args || {}) });
      }
    }
    return fail("not_found", "Unknown route.", 404);
  } catch (e: any) {
    const code = e?.code || "upstream_error";
    return fail(code, String(e?.message || e).slice(0, 400), code === "lhv_not_connected" || code === "lhv_reconnect" ? 409 : 502);
  }
});
