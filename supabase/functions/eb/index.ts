// Banks via Enable Banking (licensed open-banking provider): Swedbank, SEB, Luminor, Coop and others.
// Read-only: we only ask for balances and transactions, never payments.
// Needs two secrets in Supabase → Edge Functions → Secrets: EB_APP_ID and EB_PRIVATE_KEY (the .pem file's text).
// Answers in the same shapes as the LHV connector, so the site treats every bank the same way.
import { admin, cors, delConn, fail, getConn, json, ownerFrom, randomString, setConn } from "../_shared/util.ts";

const API = "https://api.enablebanking.com";
const APP_ID = Deno.env.get("EB_APP_ID") || "";
const PEM = (Deno.env.get("EB_PRIVATE_KEY") || "").replace(/\\n/g, "\n");

type Acc = { uid: string; iban: string; name: string; currency: string; savings: boolean };
type Sess = { id: string; aspsp: string; country: string; validUntil: string; accounts: Acc[] };
type Conn = { sessions: Sess[] };
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

// ---- signed request to Enable Banking (JWT RS256 with your application's private key) ----
let keyP: Promise<CryptoKey> | null = null;
function der(pem: string): Uint8Array {
  const b = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function pkcs1to8(p1: Uint8Array): Uint8Array {
  const len = (n: number) => n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  const octet = [0x04, ...len(p1.length), ...p1];
  const body = [0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, ...octet];
  return new Uint8Array([0x30, ...len(body.length), ...body]);
}
function key(): Promise<CryptoKey> {
  if (!APP_ID || !PEM) throw err("eb_not_configured", "Enable Banking isn't set up yet: add EB_APP_ID and EB_PRIVATE_KEY in Supabase (see README).");
  if (!keyP) {
    const raw = der(PEM);
    const pk8 = /BEGIN RSA PRIVATE KEY/.test(PEM) ? pkcs1to8(raw) : raw;
    keyP = crypto.subtle.importKey("pkcs8", pk8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  }
  return keyP;
}
const b64u = (u: Uint8Array | string) => btoa(typeof u === "string" ? u : String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function jwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "RS256", kid: APP_ID }));
  const body = b64u(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await key(), new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}
async function eb(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${await jwt()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* not json */ }
  if (!r.ok) {
    const m = (j && (j.message || j.error || j.detail)) || t.slice(0, 200) || `HTTP ${r.status}`;
    if (r.status === 401 || r.status === 403 || /expired|revoked|invalid session|EXPIRED|REVOKED/i.test(String(m))) throw err("eb_reconnect", "Your bank connection has expired. Connect the bank again in Settings.");
    throw err("eb_error", `Bank: ${String(m).slice(0, 200)}`);
  }
  return j;
}

// ---- small helpers ----
const pickBalance = (bs: any[]) => {
  for (const t of ["ITAV", "CLAV", "XPCD", "ITBD", "CLBD", "OPAV", "OPBD"]) { const b = bs.find((x) => x.balance_type === t); if (b) return b; }
  return bs[0];
};
const shape = (t: any) => {
  const dbit = t.credit_debit_indicator === "DBIT";
  const amt = Math.abs(parseFloat(t.transaction_amount?.amount || "0")) * (dbit ? -1 : 1);
  const date = t.booking_date || t.value_date || t.transaction_date || "";
  const desc = (Array.isArray(t.remittance_information) ? t.remittance_information : [t.remittance_information]).filter(Boolean).join(" ");
  const ref = t.entry_reference || t.transaction_id || `${date}|${amt}|${desc}|${t.creditor?.name || ""}|${t.debtor?.name || ""}`;
  return {
    transactionType: { domain: "PMNT" }, settlementDtime: date ? date + "T12:00:00Z" : null, bankReference: ref, description: desc,
    direction: dbit ? "DEBIT" : "CREDIT", amount: amt, currency: t.transaction_amount?.currency || "EUR", card: !!t.merchant_category_code,
    paymentData: { creditor: { name: t.creditor?.name || null, accountNo: t.creditor_account?.iban || null }, debtor: { name: t.debtor?.name || null, accountNo: t.debtor_account?.iban || null } },
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const route = new URL(req.url).pathname.split("/").pop();
  try {
    const user = await ownerFrom(req);
    if (!user) return fail("unauthorized", "Please log in.", 401);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const kvGet = async (k: string) => (await admin.from("kv").select("value").eq("user_id", user.id).eq("key", k).maybeSingle()).data?.value || null;
    const kvSet = (k: string, v: unknown) => admin.from("kv").upsert({ user_id: user.id, key: k, value: v, updated_at: new Date().toISOString() });
    const conn = (await getConn<Conn>(user.id, "eb")) || { sessions: [] };

    if (route === "banks") {
      const country = /^[A-Z]{2}$/.test(body.country) ? body.country : "EE";
      const r = await eb("GET", `/aspsps?country=${country}&psu_type=personal`);
      return json({ banks: (r.aspsps || []).map((a: any) => a.name).sort() });
    }

    if (route === "connect") {
      const aspsp = String(body.aspsp || "Swedbank").slice(0, 80), country = /^[A-Z]{2}$/.test(body.country) ? body.country : "EE";
      const redirect = String(body.redirect_url || "");
      if (!/^https:\/\/[^\s]+$/.test(redirect)) return fail("bad_request", "The site address must start with https://");
      const state = "eb_" + randomString(24);
      await admin.from("oauth_state").insert({ state, user_id: user.id, verifier: JSON.stringify({ aspsp, country }), return_to: redirect });
      const validUntil = new Date(Date.now() + 180 * 864e5).toISOString();
      const r = await eb("POST", "/auth", { access: { valid_until: validUntil, balances: true, transactions: true }, aspsp: { name: aspsp, country }, state, redirect_url: redirect, psu_type: "personal" });
      return json({ url: r.url });
    }

    if (route === "finish") {
      const state = String(body.state || ""), code = String(body.code || "");
      const { data: row } = await admin.from("oauth_state").select("*").eq("state", state).eq("user_id", user.id).maybeSingle();
      if (!row || Date.now() - new Date(row.created_at).getTime() > 30 * 60e3) return fail("bad_state", "That bank login is too old or not yours. Start again from Settings.");
      await admin.from("oauth_state").delete().eq("state", state);
      const { aspsp, country } = JSON.parse(row.verifier);
      const s = await eb("POST", "/sessions", { code });
      const accounts: Acc[] = (s.accounts || []).map((a: any) => ({
        uid: a.uid, iban: a.account_id?.iban || a.uid, name: a.name || a.product || aspsp, currency: a.currency || "EUR",
        savings: a.cash_account_type === "SVGS" || /säästu|kogumis|saving/i.test(`${a.name || ""} ${a.product || ""}`),
      }));
      // one session per bank: replace an older one (and close it at the bank)
      for (const old of conn.sessions.filter((x) => x.aspsp === aspsp)) await eb("DELETE", `/sessions/${old.id}`).catch(() => null);
      conn.sessions = [...conn.sessions.filter((x) => x.aspsp !== aspsp), { id: s.session_id, aspsp, country, validUntil: s.access?.valid_until || "", accounts }];
      await setConn(user.id, "eb", conn);
      await admin.from("kv").delete().eq("user_id", user.id).eq("key", "eb_cache");
      return json({ ok: true, bank: aspsp, accounts: accounts.length });
    }

    if (route === "status") return json({ sessions: conn.sessions.map((s) => ({ aspsp: s.aspsp, validUntil: s.validUntil, accounts: s.accounts.length })) });

    if (route === "disconnect") {
      const which = body.aspsp ? conn.sessions.filter((s) => s.aspsp === body.aspsp) : conn.sessions;
      for (const s of which) await eb("DELETE", `/sessions/${s.id}`).catch(() => null);
      conn.sessions = conn.sessions.filter((s) => !which.includes(s));
      if (conn.sessions.length) await setConn(user.id, "eb", conn); else await delConn(user.id, "eb");
      const txs = (await kvGet("eb_tx")) || {};
      for (const s of which) for (const a of s.accounts) delete txs[a.uid];
      await kvSet("eb_tx", txs);
      await admin.from("kv").delete().eq("user_id", user.id).eq("key", "eb_cache");
      return json({ ok: true });
    }

    if (route === "call") {
      if (!conn.sessions.length) return fail("eb_not_connected", "No bank connected through Enable Banking.", 409);
      const tool = String(body.tool || ""), args = body.args || {};
      if (tool === "get_instrument_balances") return json({ payload: { portfolio: { accounts: [] } } });
      const all = conn.sessions.flatMap((s) => s.accounts.map((a) => ({ ...a, bank: s.aspsp })));
      // Banks allow only a few background reads per day, so keep answers for a few hours
      const cache = (await kvGet("eb_cache")) || {};
      const ck = tool + ":" + (args.iban || "");
      if (!body.refresh && !args.refresh && cache[ck] && Date.now() - cache[ck].at < 4 * 3600e3) return json({ payload: cache[ck].data });

      let data: unknown;
      if (tool === "list_accounts") {
        const accounts = [];
        for (const a of all) {
          const r = await eb("GET", `/accounts/${a.uid}/balances`);
          const b = pickBalance(r.balances || []);
          accounts.push({ iban: a.iban, currency: b?.balance_amount?.currency || a.currency, availableBalance: b ? parseFloat(b.balance_amount.amount) : 0,
            type: "CURRENT", subtype: a.savings ? "SAVINGS" : null, name: `${a.name}`, bank: a.bank });
        }
        data = { success: true, accounts };
      } else if (tool === "get_account_statement") {
        const a = all.find((x) => x.iban === args.iban);
        if (!a) return fail("bad_request", "Unknown account.");
        // keep every transaction we've seen: banks only give long history right after you log in
        const store = (await kvGet("eb_tx")) || {};
        const have: any[] = store[a.uid] || [];
        const lastDate = have.reduce((m, t) => (t.settlementDtime || "") > m ? t.settlementDtime : m, "").slice(0, 10);
        const from = lastDate ? new Date(new Date(lastDate).getTime() - 10 * 864e5).toISOString().slice(0, 10) : String(args.dateFrom || "").slice(0, 10);
        let cont = "", n = 0; const got: any[] = [];
        do {
          const q = new URLSearchParams({ transaction_status: "BOOK" });
          if (from) q.set("date_from", from);
          if (cont) q.set("continuation_key", cont);
          const r = await eb("GET", `/accounts/${a.uid}/transactions?${q}`);
          for (const t of r.transactions || []) got.push(shape(t));
          cont = r.continuation_key || "";
        } while (cont && ++n < 40);
        const byRef = new Map(have.map((t) => [t.bankReference, t]));
        for (const t of got) byRef.set(t.bankReference, t);
        const keepFrom = new Date(Date.now() - 400 * 864e5).toISOString();
        const merged = [...byRef.values()].filter((t) => (t.settlementDtime || "") >= keepFrom).sort((x, y) => (y.settlementDtime || "").localeCompare(x.settlementDtime || ""));
        store[a.uid] = merged; await kvSet("eb_tx", store);
        const dFrom = String(args.dateFrom || "0000"), dTo = String(args.dateTo || "9999") + "T23:59:59Z";
        data = { statement: { iban: a.iban, transactions: merged.filter((t) => (t.settlementDtime || "") >= dFrom && (t.settlementDtime || "") <= dTo) } };
      } else return fail("bad_request", "Unknown tool.");
      cache[ck] = { at: Date.now(), data };
      await kvSet("eb_cache", cache);
      return json({ payload: data });
    }
    return fail("not_found", "Unknown route.", 404);
  } catch (e: any) {
    const code = e?.code || "upstream_error";
    return fail(code, String(e?.message || e).slice(0, 400), code === "eb_reconnect" ? 409 : 502);
  }
});
