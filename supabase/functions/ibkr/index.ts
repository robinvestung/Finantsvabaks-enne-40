// IBKR via the official Flex Web Service (read-only token you create in IBKR Client Portal).
// The token is stored encrypted; the site only ever receives the parsed numbers.
import { admin, cors, fail, getConn, json, ownerFrom, setConn, delConn } from "../_shared/util.ts";

const FLEX = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
type Cfg = { token: string; queryId: string };

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)) out[m[1]] = m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return out;
}
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}\\s[^>]*?/?>`, "g"))].map((m) => attrs(m[0]));
const n = (v?: string) => { const x = parseFloat(v ?? ""); return isFinite(x) ? x : null; };

async function fetchStatement(cfg: Cfg): Promise<string> {
  const send = await (await fetch(`${FLEX}/SendRequest?t=${encodeURIComponent(cfg.token)}&q=${encodeURIComponent(cfg.queryId)}&v=3`)).text();
  const status = send.match(/<Status>([^<]*)<\/Status>/)?.[1];
  if (status !== "Success") {
    const msg = send.match(/<ErrorMessage>([^<]*)<\/ErrorMessage>/)?.[1] || "IBKR refused the request.";
    throw Object.assign(new Error(msg), { code: "ibkr_error" });
  }
  const ref = send.match(/<ReferenceCode>([^<]*)<\/ReferenceCode>/)?.[1];
  const base = send.match(/<Url>([^<]*)<\/Url>/)?.[1] || `${FLEX}/GetStatement`;
  for (let i = 0; i < 12; i++) {
    const xml = await (await fetch(`${base}?t=${encodeURIComponent(cfg.token)}&q=${ref}&v=3`)).text();
    if (xml.includes("<FlexQueryResponse") || xml.includes("<FlexStatements")) return xml; // note: "<FlexStatementResponse" = not ready / error
    const code = xml.match(/<ErrorCode>(\d+)<\/ErrorCode>/)?.[1];
    if (code && !["1019", "1018"].includes(code)) throw Object.assign(new Error(xml.match(/<ErrorMessage>([^<]*)/)?.[1] || "IBKR error"), { code: "ibkr_error" });
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw Object.assign(new Error("IBKR is still preparing the report. Try again in a minute."), { code: "ibkr_busy" });
}

function parse(xml: string) {
  const info = tags(xml, "AccountInformation")[0] || {};
  const base = (info.currency || "EUR").toUpperCase();
  const fx: Record<string, number> = {};
  const positions = tags(xml, "OpenPosition")
    .filter((p) => !p.levelOfDetail || p.levelOfDetail === "SUMMARY")
    .map((p) => {
      const ccy = (p.currency || base).toUpperCase();
      const rate = n(p.fxRateToBase);
      if (rate && ccy !== base) fx[ccy] = rate;
      return {
        sym: p.symbol, name: p.description || p.symbol, qty: n(p.position), price: n(p.markPrice),
        value: n(p.positionValue), pnl: n(p.fifoPnlUnrealized), avg: n(p.costBasisPrice), ccy, cls: p.assetCategory || "",
      };
    })
    .filter((p) => p.sym && p.value);
  for (const r of tags(xml, "ConversionRate")) if (r.toCurrency === base && n(r.rate)) fx[(r.fromCurrency || "").toUpperCase()] = n(r.rate)!;
  const cashRow = tags(xml, "CashReportCurrency").find((c) => c.currency === "BASE_SUMMARY");
  const navRows = tags(xml, "EquitySummaryByReportDateInBase");
  const nav = navRows[navRows.length - 1];
  const asOf = tags(xml, "FlexStatement")[0]?.toDate || null;
  // Dividends (net of withholding tax) and deposits from the Cash Transactions section, converted to base currency
  const dividends: { date: string; sym: string; kind: "div" | "tax"; amount: number }[] = [];
  let deposits = 0;
  for (const t of tags(xml, "CashTransaction")) {
    if (t.levelOfDetail && t.levelOfDetail !== "DETAIL") continue;
    const type = (t.type || "").toLowerCase();
    const ccy = (t.currency || base).toUpperCase();
    const rate = n(t.fxRateToBase) ?? (ccy === base ? 1 : fx[ccy] ?? null);
    const amt = n(t.amount);
    if (amt == null || rate == null) continue;
    const raw = (t.dateTime || t.reportDate || t.settleDate || "").replace(/[^0-9]/g, "").slice(0, 8);
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : "";
    const isDiv = type.includes("dividend"), isTax = type.includes("withholding");
    if (isDiv || isTax) dividends.push({ date, sym: t.symbol || "", kind: isDiv ? "div" : "tax", amount: Math.round(amt * rate * 100) / 100 });
    else if (type.includes("deposit")) deposits += amt * rate;
  }
  return { currency: base, positions, fx, cash: n(cashRow?.endingCash) ?? n(nav?.cash), netLiq: n(nav?.total), asOf, dividends, deposits: Math.round(deposits * 100) / 100 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const route = new URL(req.url).pathname.split("/").pop();
  try {
    const user = await ownerFrom(req);
    if (!user) return fail("unauthorized", "Please log in.", 401);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (route === "setup") {
      const token = String(body.token || "").trim(), queryId = String(body.queryId || "").trim();
      if (token.length < 8) return fail("bad_request", "That doesn't look like a Flex token.");
      if (!/^\d+$/.test(queryId)) return fail("bad_request", "The Query ID is a number.");
      const data = parse(await fetchStatement({ token, queryId })); // test before saving
      await setConn(user.id, "ibkr", { token, queryId });
      await admin.from("kv").upsert({ user_id: user.id, key: "ibkr_cache", value: { ...data, fetchedAt: Date.now() }, updated_at: new Date().toISOString() });
      return json({ ok: true, data });
    }
    if (route === "disconnect") { await delConn(user.id, "ibkr"); return json({ ok: true }); }
    if (route === "status") return json({ connected: !!(await getConn(user.id, "ibkr")) });

    if (route === "sync") {
      const cfg = await getConn<Cfg>(user.id, "ibkr");
      if (!cfg) return fail("ibkr_not_connected", "Add your IBKR Flex token in Settings.", 409);
      const { data: cached } = await admin.from("kv").select("value").eq("user_id", user.id).eq("key", "ibkr_cache").maybeSingle();
      const c = cached?.value as any;
      // Flex data only changes once a day; reuse a fetch from the last 6 hours unless asked to refresh
      if (c && !body.refresh && Date.now() - (c.fetchedAt || 0) < 6 * 3600e3) return json({ data: c, cached: true });
      try {
        const data = { ...parse(await fetchStatement(cfg)), fetchedAt: Date.now() };
        await admin.from("kv").upsert({ user_id: user.id, key: "ibkr_cache", value: data, updated_at: new Date().toISOString() });
        return json({ data });
      } catch (e) {
        if (c) return json({ data: c, cached: true, warning: String((e as Error).message) });
        throw e;
      }
    }
    return fail("not_found", "Unknown route.", 404);
  } catch (e: any) {
    return fail(e?.code || "upstream_error", String(e?.message || e).slice(0, 400), 502);
  }
});
