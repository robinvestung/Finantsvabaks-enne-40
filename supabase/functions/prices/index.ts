// Daily price history (1 year) + current price for your holdings, from Yahoo Finance's public chart data.
// Only ticker symbols are sent out: no amounts, names of accounts or anything personal.
import { admin, cors, fail, json, ownerFrom } from "../_shared/util.ts";

type Item = { key: string; sym: string; ccy: string; name?: string; price?: number | null };
type Series = { ticker: string; proxy: boolean; ccy: string; live: number | null; liveAt: number | null; prevClose: number | null; closes: [string, number][]; at: number };

const SUFFIX: Record<string, string[]> = {
  EUR: [".DE", ".AS", ".MI", ".PA", ".HE", ".IR", ".BR", ".MC", ".VI", ".LS"],
  SEK: [".ST"], NOK: [".OL"], DKK: [".CO"], CHF: [".SW"], CAD: [".TO"], AUD: [".AX"], HKD: [".HK"], JPY: [".T"], PLN: [".WA"],
};

function candidates(it: Item): { t: string; proxy: boolean }[] {
  const s = it.sym.trim().toUpperCase(), c = it.ccy.toUpperCase(), out: { t: string; proxy: boolean }[] = [];
  const add = (t: string, proxy = false) => { if (!out.some((o) => o.t === t)) out.push({ t, proxy }); };
  if (/BITCOIN|COINXBE|\bXBT\b/i.test(`${it.name || ""} ${s}`)) add("BTC-" + (c === "USD" ? "USD" : "EUR"), true);
  if (/ETHEREUM|COINETH/i.test(`${it.name || ""} ${s}`)) add("ETH-" + (c === "USD" ? "USD" : "EUR"), true);
  if (c === "USD") add(s.replace(/[ .]/g, "-"));
  if (c === "GBP") add(it.sym.trim().replace(/l$/, "").toUpperCase().replace(/\.$/, "") + ".L");
  if (c === "SEK") { const m = s.match(/^(.+?)([AB])$/); if (m) add(`${m[1]}-${m[2]}.ST`); }
  if (c === "EUR") { if (/1T$/.test(s)) add(s + ".TL"); if (/1L$/.test(s)) add(s + ".VS"); if (/1R$/.test(s)) add(s + ".RG"); }
  for (const x of SUFFIX[c] || []) add(s + x);
  add(s);
  return out;
}

const day = (ts: number, off: number) => new Date((ts + off) * 1000).toISOString().slice(0, 10);

async function chart(ticker: string): Promise<Omit<Series, "proxy" | "at"> | null> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  const res = (await r.json().catch(() => null))?.chart?.result?.[0];
  if (!res?.meta) return null;
  let ccy = String(res.meta.currency || "").toUpperCase();
  let scale = 1;
  if (res.meta.currency === "GBp" || res.meta.currency === "ZAc" || res.meta.currency === "ILA") { scale = 0.01; ccy = res.meta.currency === "GBp" ? "GBP" : res.meta.currency === "ZAc" ? "ZAR" : "ILS"; }
  const off = Number(res.meta.gmtoffset) || 0;
  const ts: number[] = res.timestamp || [];
  const cl: (number | null)[] = res.indicators?.quote?.[0]?.close || [];
  const closes: [string, number][] = [];
  ts.forEach((t, i) => { const v = cl[i]; if (v != null && isFinite(v)) { const d = day(t, off); if (closes.length && closes[closes.length - 1][0] === d) closes[closes.length - 1][1] = v * scale; else closes.push([d, v * scale]); } });
  const live = res.meta.regularMarketPrice != null ? Number(res.meta.regularMarketPrice) * scale : null;
  const liveAt = Number(res.meta.regularMarketTime) || null;
  const mDay = liveAt ? day(liveAt, off) : null;
  let prevClose: number | null = null;
  for (const [d, v] of closes) if (!mDay || d < mDay) prevClose = v;
  if (mDay && closes.length && closes[closes.length - 1][0] < mDay && live != null) closes.push([mDay, live]);
  return { ticker, ccy, live, liveAt, prevClose, closes };
}

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await ownerFrom(req);
    if (!user) return fail("unauthorized", "Please log in.", 401);
    const body = await req.json().catch(() => ({}));
    const items: Item[] = (Array.isArray(body.items) ? body.items : []).slice(0, 80)
      .filter((x: any) => x && typeof x.sym === "string" && typeof x.ccy === "string" && /^[A-Za-z0-9 .\-]{1,20}$/.test(x.sym) && /^[A-Za-z]{3}$/.test(x.ccy))
      .map((x: any) => ({ key: String(x.key).slice(0, 60), sym: x.sym, ccy: x.ccy, name: String(x.name || "").slice(0, 80), price: Number(x.price) || null }));

    const kvGet = async (key: string) => (await admin.from("kv").select("value").eq("user_id", user.id).eq("key", key).maybeSingle()).data?.value || {};
    const kvSet = (key: string, value: unknown) => admin.from("kv").upsert({ user_id: user.id, key, value, updated_at: new Date().toISOString() });
    const map: Record<string, { t: string | null; proxy?: boolean; at: number }> = await kvGet("tickers");
    const overrides: Record<string, string> = ((await kvGet("settings")) as any).tickers || {};
    const cache: Record<string, Series> = await kvGet("prices_cache");
    const fresh = (t: string) => cache[t] && Date.now() - cache[t].at < (body.refresh ? 60e3 : 10 * 60e3);

    const results = await pool(items, 6, async (it) => {
      const ov = overrides[it.key] || overrides[it.sym];
      let known = ov ? { t: ov, proxy: false, at: Date.now() } : map[it.key];
      if (known && known.t === null && Date.now() - known.at < 7 * 864e5) return { key: it.key, series: null };
      if (known?.t) {
        if (fresh(known.t)) return { key: it.key, series: cache[known.t] };
        const s = await chart(known.t);
        if (s) { cache[known.t] = { ...s, proxy: !!known.proxy, at: Date.now() }; return { key: it.key, series: cache[known.t] }; }
      }
      // find the right ticker: same currency, and close to the price your broker reports
      for (const c of candidates(it)) {
        const s = await chart(c.t).catch(() => null);
        if (!s || s.ccy !== it.ccy.toUpperCase() || s.live == null) continue;
        if (!c.proxy && it.price && Math.abs(s.live / it.price - 1) > 0.25) continue;
        map[it.key] = { t: c.t, proxy: c.proxy, at: Date.now() };
        cache[c.t] = { ...s, proxy: c.proxy, at: Date.now() };
        return { key: it.key, series: cache[c.t] };
      }
      map[it.key] = { t: null, at: Date.now() };
      return { key: it.key, series: null };
    });
    // keep the cache small: only tickers still in use
    const used = new Set(results.map((r) => r.series?.ticker).filter(Boolean) as string[]);
    for (const t of Object.keys(cache)) if (!used.has(t)) delete cache[t];
    await kvSet("tickers", map);
    await kvSet("prices_cache", cache);
    return json({ items: Object.fromEntries(results.map((r) => [r.key, r.series])) });
  } catch (e: any) {
    return fail(e?.code || "upstream_error", String(e?.message || e).slice(0, 400), 502);
  }
});
