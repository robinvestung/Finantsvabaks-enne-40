// My Money app. Refuse to run inside someone else's frame (clickjacking protection).
if (window.top !== window.self) { document.documentElement.style.display = "none"; throw new Error("framed"); }
(() => {
"use strict";
// ---------- helpers ----------
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : String(k));
  return e;
};
const EUR = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EUR2 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = v => (v == null || !isFinite(v)) ? "—" : EUR.format(v);
const fmt2 = v => (v == null || !isFinite(v)) ? "—" : EUR2.format(v);
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%";
const signed = v => (v == null || !isFinite(v)) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + EUR.format(Math.abs(v));
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "";
const amt = (text, extra = "") => el("span", { class: "amt " + extra }, text);
const today = () => new Date().toISOString().slice(0, 10);
const ym = d => d.slice(0, 7);
const monthName = k => { const [y, m] = k.split("-"); return new Date(+y, +m - 1, 1).toLocaleString("en-GB", { month: "short", year: "numeric" }); };
const addMonths = (k, n) => { const [y, m] = k.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
const num = v => {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") { const n = parseFloat(v.replace(/[\s,]/g, "").replace(/[^\d.\-eE]/g, "")); return isFinite(n) ? n : null; }
  if (typeof v === "object") { for (const k of ["amount", "value", "val"]) if (k in v) return num(v[k]); }
  return null;
};
const nkey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
const COLORS = ["#3f72b8", "#d06b2a", "#14907a", "#c08a1e", "#c4568a", "#2e8b3a", "#8e62c2", "#c24a45"];
const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", 2600); };

// ---------- backend: your own Supabase project ----------
const CFG = window.MYMONEY_CONFIG || {};
const sb = (window.supabase && CFG.supabaseUrl) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;
let SESSION = null;
async function fn(name, route, body) {
  const r = await fetch(`${CFG.supabaseUrl}/functions/v1/${name}/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CFG.supabaseKey, ...(SESSION ? { Authorization: "Bearer " + SESSION.access_token } : {}) },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw (j.error || { code: "http_" + r.status, message: "Server error " + r.status });
  return j;
}
const Store = {
  mode: "cloud",
  async init() { },
  async get(key) {
    if (!sb || !SESSION) return null;
    const { data, error } = await sb.from("kv").select("value").eq("key", key).maybeSingle();
    if (error) { toast("Couldn't load your saved data."); return null; }
    return data ? data.value : null;
  },
  async set(key, val) {
    if (!sb || !SESSION || S.demo) return false;
    const { error } = await sb.from("kv").upsert({ user_id: SESSION.user.id, key, value: val, updated_at: new Date().toISOString() });
    if (error) { toast("Couldn't save: " + error.message); return false; }
    return true;
  }
};
// LHV goes through your server function, which only allows three read-only tools
const LHVAPI = { callTool: async (server, tool, input) => fn("lhv", "call", { tool, args: input || {} }) };

// ---------- state ----------
const DEFAULT_RULES = [
  ["RIMI", "Groceries"], ["PRISMA", "Groceries"], ["SELVER", "Groceries"], ["MAXIMA", "Groceries"], ["LIDL", "Groceries"], ["COOP", "Groceries"], ["GROSSI", "Groceries"], ["MEGAMARKET", "Groceries"],
  ["WOLT", "Eating out"], ["BOLT FOOD", "Eating out"], ["RESTO", "Eating out"], ["KOHVIK", "Eating out"], ["CAFE", "Eating out"], ["MCDONALD", "Eating out"], ["HESBURGER", "Eating out"], ["BURGER", "Eating out"], ["PIZZA", "Eating out"],
  ["BOLT", "Transport"], ["UBER", "Transport"], ["CIRCLE K", "Transport"], ["NESTE", "Transport"], ["ALEXELA", "Transport"], ["OLEREX", "Transport"], ["ELRON", "Transport"], ["PARK", "Transport"], ["TALLINK", "Travel"], ["RYANAIR", "Travel"], ["AIRBALTIC", "Travel"], ["BOOKING", "Travel"], ["AIRBNB", "Travel"],
  ["SPOTIFY", "Subscriptions"], ["NETFLIX", "Subscriptions"], ["APPLE.COM", "Subscriptions"], ["GOOGLE", "Subscriptions"], ["YOUTUBE", "Subscriptions"], ["OPENAI", "Subscriptions"], ["ANTHROPIC", "Subscriptions"], ["CLAUDE.AI", "Subscriptions"], ["ADOBE", "Subscriptions"],
  ["PLAYTOMIC", "Sport"], ["MYFITNESS", "Sport"], ["GYM", "Sport"], ["PADEL", "Sport"], ["DECATHLON", "Sport"],
  ["TELIA", "Bills"], ["ELISA", "Bills"], ["TELE2", "Bills"], ["EESTI ENERGIA", "Bills"], ["ELEKTRILEVI", "Bills"], ["ENEFIT", "Bills"], ["KINDLUSTUS", "Bills"], ["IF P&C", "Bills"], ["ERGO", "Bills"], ["ÜÜR", "Home"], ["IKEA", "Home"], ["BAUHOF", "Home"], ["K-RAUTA", "Home"],
  ["AMAZON", "Shopping"], ["TEMU", "Shopping"], ["ZALANDO", "Shopping"], ["KAUBAMAJA", "Shopping"], ["H&M", "Shopping"], ["APOTEEK", "Health"], ["APTEEK", "Health"],
  ["INTERACTIVE BROKERS", "Investing"], ["IBKR", "Investing"], ["LIGHTYEAR", "Investing"], ["LHV PENSION", "Investing"], ["TULEVA", "Investing"],
  ["PALK", "Salary"], ["SALARY", "Salary"], ["TÖÖTASU", "Salary"]
];
const NON_SPEND = new Set(["Own transfer", "Investing", "Excluded"]);
const DEFAULT_SETTINGS = () => ({
  v: 1, assets: [], debts: [], manualPositions: [], fx: [], ibkrAccount: "",
  rules: DEFAULT_RULES.map(([match, category]) => ({ match, category })),
  excludedIbans: [], plan: {}, backfill: [], salaryNextMonth: false
});
const S = {
  settings: DEFAULT_SETTINGS(), history: { points: [] },
  lhv: { status: "idle", server: null, accounts: [], portfolio: null, tx: [], error: null, fetchedAt: null },
  ibkr: { status: "idle", positions: [], cash: null, netLiq: null, currency: null, error: null, raw: null, fetchedAt: null },
  demo: false, mcp: null,
};

// ---------- connectors ----------
const LHV_SERVERS = ["lhv"];
const IBKR_SERVER = "IBKR";
const ERR_TEXT = {
  lhv_not_connected: () => `Not connected yet. Click "Connect LHV" and log in with Smart-ID / Mobile-ID.`,
  lhv_reconnect: () => `Your LHV login has expired. Click "Connect LHV" to log in again.`,
  ibkr_not_connected: () => `Add your IBKR Flex token and Query ID in Settings.`,
  ibkr_busy: () => `IBKR is still preparing the report. Try again in a minute.`,
  unauthorized: () => `Please log in again.`,
  needs_reauth: s => `Reconnect ${s} in claude.ai Settings → Connectors.`,
  server_not_connected: s => `Add the ${s} connector in claude.ai Settings → Connectors.`,
  selection_required: s => `You have more than one ${s} connector. Choose one when claude.ai asks.`,
  not_in_manifest: s => `${s} is turned off for this page. You can allow it again from the page's connector settings.`,
  blocked_by_policy: s => `Your organization blocks ${s} here.`,
  approval_required: s => `${s} needs your approval.`,
  not_granted: () => `Live connections aren't available in this view. Open the page on claude.ai.`,
  capability_disabled: () => `Live connections aren't available in this view.`,
};
const errMsg = (e, s) => (ERR_TEXT[e && e.code] || (() => (e && e.message) ? `${s}: ${String(e.message).slice(0, 160)}` : `${s} didn't answer.`))(s);

async function call(server, tool, input, opts = {}) {
  const run = () => LHVAPI.callTool(server, tool, input);
  try { const r = await run(); return r.payload !== undefined ? r.payload : r; }
  catch (e) {
    if (e && e.retryable) { await new Promise(r => setTimeout(r, (e.retryAfterMs || 800) + Math.random() * 500)); const r = await run(); return r.payload !== undefined ? r.payload : r; }
    throw e;
  }
}

async function loadLHV(refresh) {
  const L = S.lhv; L.status = "loading"; L.error = null; renderChips();
  let lastErr = null;
  const candidates = L.server ? [L.server] : LHV_SERVERS;
  for (const server of candidates) {
    try {
      const acc = await call(server, "list_accounts", undefined, { refresh });
      if (acc && acc.success === false) throw { code: "tool_error", message: (acc.error && (acc.error.message || JSON.stringify(acc.error))) || "LHV error" };
      L.server = server;
      L.accounts = (acc && acc.accounts) || [];
      break;
    } catch (e) { lastErr = e; if (!(e && (e.code === "server_not_connected" || e.code === "not_in_manifest" || e.code === "capability_disabled"))) break; }
  }
  if (!L.server) { L.status = "error"; L.error = lastErr && lastErr.code === "server_not_connected" ? { code: "server_not_connected" } : lastErr; renderChips(); return; }
  try {
    const pf = await call(L.server, "get_instrument_balances", { isSettled: false }, { refresh });
    L.portfolio = pf && pf.portfolio || null;
  } catch (e) { L.portfolioError = e; }
  L.status = "ok"; L.fetchedAt = Date.now(); renderChips(); renderAll();
  // statements for spending (12 months) — current accounts only
  try {
    const from = addMonths(ym(today()), -12) + "-01";
    const ibans = L.accounts.filter(a => a.type !== "GROWTH").map(a => a.iban);
    const own = new Set(L.accounts.map(a => a.iban));
    const owners = new Set();
    for (const a of (L.portfolio && L.portfolio.accounts) || []) { own.add(a.iban); if (a.ownerName) owners.add(normName(a.ownerName)); }
    own.owners = owners;
    const all = [];
    await Promise.all(ibans.map(async iban => {
      try {
        const st = await call(L.server, "get_account_statement", { iban, dateFrom: from, dateTo: today(), limit: 5000 }, { refresh });
        const txs = (st && st.statement && st.statement.transactions) || [];
        for (const t of txs) all.push(normTx(t, iban, own));
      } catch (e) { L.txError = e; }
    }));
    all.sort((a, b) => b.date.localeCompare(a.date));
    L.tx = all;
  } catch (e) { L.txError = e; }
  renderAll();
}

function normTx(t, iban, own) {
  const desc = String(t.description || "");
  const pd = t.paymentData || {};
  const cp = t.direction === "DEBIT" ? pd.creditor : pd.debtor;
  const cpAcc = cp && cp.accountNo;
  let merchant = "";
  const m = desc.match(/^\(\.\.\d+\)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.*?)(?:\\|$)/);
  if (m) merchant = m[1].replace(/\s+(?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/, "").trim();
  else if (cp && cp.name) merchant = cp.name;
  else merchant = desc.slice(0, 40);
  const internal = !!(cpAcc && own.has(cpAcc)) || !!(cp && cp.name && own.owners && own.owners.has(normName(cp.name)));
  const dom = t.transactionType && t.transactionType.domain;
  const ccy = t.currency || "EUR";
  const raw = num(t.amount) || 0;
  const rate = ccy === "EUR" ? 1 : lhvFx(ccy);
  return {
    id: String(t.bankReference || "") + ":" + iban,
    date: localDate(t.settlementDtime), amount: rate == null ? 0 : raw * rate, rawAmount: raw, currency: ccy, noFx: rate == null,
    desc, merchant: merchant || "—", iban, internal, cpAcc: cpAcc || null, cpName: (cp && cp.name) || null, dom, secu: dom === "SECU", card: !!m,
  };
}

function localDate(iso) { const d = new Date(iso || ""); if (isNaN(d)) return String(iso || "").slice(0, 10); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function normName(n) { return String(n).toUpperCase().replace(/[^A-ZÕÄÖÜŠŽ ]/g, "").split(/\s+/).filter(Boolean).sort().join(" "); }
// LHV implied FX from portfolio (units of ccy per EUR) -> EUR per unit
function lhvFx(ccy) {
  for (const a of (S.lhv.portfolio && S.lhv.portfolio.accounts) || []) for (const p of a.positions || []) {
    if (p.currency === ccy && num(p.marketValue) && num(p.baseCurrencyMarketValue)) return num(p.baseCurrencyMarketValue) / num(p.marketValue);
  }
  if (S.ibkr && S.ibkr.fx && S.ibkr.fx[ccy]) return S.ibkr.fx[ccy];
  return fxRate(ccy);
}
// "Pots": savings, growth and investment-only accounts. Money moved into them = saved & invested.
function potIbans() {
  const set = new Set(S.lhv.accounts.filter(a => a.type === "GROWTH" || a.subtype === "SAVINGS").map(a => a.iban));
  const listed = new Set(S.lhv.accounts.map(a => a.iban));
  for (const a of (S.lhv.portfolio && S.lhv.portfolio.accounts) || []) if (!listed.has(a.iban)) set.add(a.iban);
  return set;
}
function investIbans() {
  const set = new Set(S.lhv.accounts.filter(a => a.type === "GROWTH").map(a => a.iban));
  for (const a of (S.lhv.portfolio && S.lhv.portfolio.accounts) || []) if ((a.positions || []).length) set.add(a.iban);
  return set;
}
function categorize(tx, inv = investIbans()) {
  if (tx.dom === "FORX") return "Currency exchange";
  if (tx.dom === "SECU" || tx.dom === "LDAS") return "Dividends & interest";
  if (tx.internal) return "Own transfer";
  const hay = (tx.merchant + " " + tx.desc).toUpperCase();
  let ruleCat = null;
  const merchU = tx.merchant.toUpperCase().replace(/\s+/g, " ").trim();
  for (const r of S.settings.rules) if (r.match && (r.exact ? merchU === String(r.match).toUpperCase() : hay.includes(String(r.match).toUpperCase())) && (r.amount == null || r.amount === "" || Math.abs(Math.abs(tx.amount) - Number(r.amount)) < 0.01)) { ruleCat = r.category || "Other"; break; }
  if (tx.amount > 0 && incomeConfigured()) {
    if (isIncome(tx)) return ruleCat && INCOME_CATS.has(ruleCat) ? ruleCat : "Income";
    if (ruleCat && !INCOME_CATS.has(ruleCat)) return ruleCat; // e.g. a friend paying back for padel offsets "Sport"
    return tx.card ? "Refunds" : (isCompany(tx.cpName) ? "Refunds" : peopleCat());
  }
  if (ruleCat) return ruleCat;
  if (tx.amount > 0) return "Income";
  if (!tx.card) return isCompany(tx.cpName) ? "Other" : peopleCat();
  return "Other";
}
function peopleCat() { return (S.settings.peopleCategory || "").trim() || "Payments to people"; }
function isCompany(n) { if (!n) return true; return /(^|[^A-ZÕÄÖÜ])(OÜ|OU|AS|OY|AB|SIA|UAB|LTD|GMBH|MTÜ|MTU|SA|LLC|INC|PANK|BANK|GROUP|AMET|KESKUS)([^A-ZÕÄÖÜ]|$)/i.test(n) || /\d|\./.test(n); }
const INCOME_CATS = new Set(["Income", "Salary"]);
function incomeConfigured() { const c = S.settings.income || {}; return !!((c.payers || []).length || (c.keywords || []).length); }
function isIncome(tx) {
  const c = S.settings.income || {};
  const payer = normName(tx.cpName || "");
  if ((c.payers || []).some(p => p && (payer === normName(p) || payer.includes(normName(p)) || String(tx.cpName || "").toUpperCase().includes(String(p).toUpperCase())))) return true;
  const d = tx.desc.toUpperCase();
  return (c.keywords || []).some(k => k && d.includes(String(k).toUpperCase()));
}

// --- IBKR: shape-tolerant parsing (tool arguments are read from the connector's own schema) ---
async function inputFor(tool, ctx) {
  let schema = null;
  try { schema = (await S.mcp.describeTool(IBKR_SERVER, tool)).inputSchema; } catch { }
  const input = {};
  const req = (schema && schema.required) || [];
  const props = (schema && schema.properties) || {};
  for (const k of Object.keys(props)) {
    if (/account/i.test(k) && ctx.accountId) input[k] = props[k].type === "array" ? [ctx.accountId] : ctx.accountId;
  }
  for (const k of req) if (!(k in input)) { if (/account/i.test(k)) return { need: "account" }; }
  return { input: Object.keys(input).length ? input : undefined };
}
function walk(o, fn, depth = 0) {
  if (depth > 8 || o == null || typeof o !== "object") return;
  fn(o);
  for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v, fn, depth + 1);
}
function findKey(o, names) {
  const want = names.map(nkey); let hit;
  walk(o, x => { if (hit !== undefined || Array.isArray(x)) return; for (const [k, v] of Object.entries(x)) if (want.includes(nkey(k)) && num(v) != null) { hit = num(v); return; } });
  return hit;
}
function findStr(o, names) {
  const want = names.map(nkey); let hit;
  walk(o, x => { if (hit || Array.isArray(x)) return; for (const [k, v] of Object.entries(x)) if (want.includes(nkey(k)) && typeof v === "string" && v) { hit = v; return; } });
  return hit;
}
function findAccountId(o) {
  let id = findStr(o, ["accountId", "account_id", "acctId", "accountid", "account"]);
  if (!id) walk(o, x => { if (!id && typeof x === "object") for (const v of Object.values(x)) if (typeof v === "string" && /^[DU]\d{5,}$/.test(v)) { id = v; break; } });
  return id;
}
const pick = (obj, names) => { const want = names.map(nkey); for (const [k, v] of Object.entries(obj)) if (want.includes(nkey(k))) return v; };
function parsePositions(o) {
  let best = [];
  walk(o, x => {
    if (!Array.isArray(x) || !x.length || typeof x[0] !== "object") return;
    const ok = x.filter(r => r && pick(r, ["symbol", "ticker", "contractDesc", "contract_description", "localSymbol"]) != null);
    if (ok.length > best.length) best = ok;
  });
  return best.map(r => {
    const sym = String(pick(r, ["symbol", "ticker", "contractDesc", "contract_description", "localSymbol"]) || "").replace(/\s*@.*$/, "").trim();
    const name = String(pick(r, ["name", "description", "longName", "companyName", "fullName"]) || sym);
    const qty = num(pick(r, ["position", "quantity", "qty", "shares", "pos"]));
    const price = num(pick(r, ["marketPrice", "mktPrice", "price", "lastPrice", "last"]));
    let value = num(pick(r, ["marketValue", "mktValue", "market_value", "positionValue", "value"]));
    if (value == null && qty != null && price != null) value = qty * price;
    const pnl = num(pick(r, ["unrealizedPnl", "unrealizedPNL", "unrealized_pnl", "unrealizedPL", "unrealPnl", "pnl", "unrealized"]));
    const avg = num(pick(r, ["avgCost", "averageCost", "avg_cost", "avgPrice", "averagePrice", "costBasisPrice"]));
    const ccy = String(pick(r, ["currency", "ccy", "curr"]) || "").toUpperCase() || null;
    const cls = String(pick(r, ["assetClass", "asset_class", "secType", "type"]) || "");
    const daily = num(pick(r, ["dailyPnl", "daily_pnl", "dailyPnL"]));
    return { sym, name, qty, price, value, pnl, avg, ccy, cls, daily };
  }).filter(p => p.sym && p.value != null && p.value !== 0);
}

async function loadIBKR(refresh) {
  const I = S.ibkr; I.status = "loading"; I.error = null; renderChips();
  try {
    const r = await fn("ibkr", "sync", { refresh: !!refresh });
    const d = r.data || {};
    Object.assign(I, { currency: d.currency || "EUR", positions: d.positions || [], cash: d.cash, netLiq: d.netLiq, fx: d.fx || {}, dividends: d.dividends || [], navHistory: d.navHistory || [], raw: d, status: "ok", fetchedAt: d.fetchedAt || Date.now() });
    if (r.warning) toast("IBKR: showing last saved numbers (" + r.warning + ")");
    if (!refresh && d.navHistory === undefined) { setTimeout(() => loadIBKR(true), 0); return; }
  } catch (e) { I.status = "error"; I.error = e; }
  renderChips(); renderAll();
}

function fxRate(ccy) {
  if (!ccy || ccy === "EUR") return 1;
  if ((S.ibkr.currency || "EUR") === "EUR" && S.ibkr.fx && S.ibkr.fx[ccy]) return S.ibkr.fx[ccy];
  const r = S.settings.fx.find(f => (f.ccy || "").toUpperCase() === ccy);
  return r && num(r.rate) ? num(r.rate) : null;
}

// ---------- model ----------
function model() {
  const missingFx = new Set();
  const conv = (v, ccy) => { const r = fxRate(ccy); if (r == null) { missingFx.add(ccy); return null; } return v * r; };
  const holdings = []; const cashRows = []; const otherRows = []; const debtRows = [];
  // LHV
  if (S.lhv.status === "ok") {
    for (const a of S.lhv.accounts) {
      const v = num(a.availableBalance) || 0;
      if (a.currency && a.currency !== "EUR") { const c = conv(v, a.currency); if (c != null) cashRows.push({ name: a.name || "LHV account", inst: "LHV", kind: a.type === "GROWTH" ? "Growth account cash" : "Cash", value: c }); }
      else cashRows.push({ name: (a.name || "LHV account") + (a.type === "GROWTH" ? " (cash)" : ""), inst: "LHV", kind: a.type === "GROWTH" ? "Uninvested cash" : "Cash", value: v });
    }
    const pf = S.lhv.portfolio;
    if (pf && pf.accounts) {
      const accName = Object.fromEntries(S.lhv.accounts.map(a => [a.iban, a.name]));
      for (const acc of pf.accounts) for (const p of acc.positions || []) {
        const value = num(p.baseCurrencyMarketValue) ?? num(p.marketValue) ?? 0;
        const pnl = num(p.baseCurrencyProfitLoss) ?? num(p.profitLoss);
        holdings.push({ sym: p.symbol, name: p.name, broker: "LHV", account: accName[acc.iban] || "", qty: num(p.quantity), price: num(p.latestPrice), ccy: p.currency, value, pnl, cost: pnl != null ? value - pnl : null, today: num(p.todayChange) });
      }
    }
  }
  // IBKR
  if (S.ibkr.status === "ok") {
    const base = S.ibkr.currency || "EUR";
    let posSum = 0;
    for (const p of S.ibkr.positions) {
      const ccy = p.ccy || base;
      const v = conv(p.value, ccy); if (v == null) continue;
      posSum += v;
      const pnl = p.pnl != null ? conv(p.pnl, ccy) : null;
      const today = p.daily != null && p.value - p.daily ? p.daily / (p.value - p.daily) * 100 : null;
      holdings.push({ sym: p.sym, name: p.name, broker: "IBKR", account: "", qty: p.qty, price: p.price, ccy, value: v, pnl, cost: pnl != null ? v - pnl : null, today });
    }
    let cash = S.ibkr.cash != null ? conv(S.ibkr.cash, base) : null;
    if (cash == null && S.ibkr.netLiq != null) { const nl = conv(S.ibkr.netLiq, base); if (nl != null) cash = nl - posSum; }
    const label = S.ibkr.positions.length ? "IBKR cash" : "IBKR account value";
    if (cash != null && Math.abs(cash) > 0.5) cashRows.push({ name: label, inst: "IBKR", kind: S.ibkr.positions.length ? "Cash at broker" : "Holdings not itemised", value: cash });
  }
  // manual
  for (const p of S.settings.manualPositions) {
    const v = num(p.value); if (v == null) continue;
    holdings.push({ sym: p.sym || "—", name: p.name || p.sym || "Holding", broker: p.broker || "Manual", account: "", qty: num(p.qty), price: null, ccy: "EUR", value: v, pnl: null, cost: null, today: null });
  }
  for (const a of S.settings.assets) { const v = num(a.value); if (v != null) otherRows.push({ name: a.name || "Asset", inst: "Manual", kind: a.kind || "Other asset", value: v }); }
  for (const d of S.settings.debts) { const v = num(d.value); if (v != null) debtRows.push({ name: d.name || "Debt", inst: "Manual", kind: "Debt", value: -Math.abs(v) }); }

  const sum = a => a.reduce((s, x) => s + (x.value || 0), 0);
  const cash = sum(cashRows), inv = sum(holdings), other = sum(otherRows), debt = sum(debtRows);
  return { holdings, cashRows, otherRows, debtRows, cash, inv, other, debt, total: cash + inv + other + debt, missingFx: [...missingFx].filter(Boolean) };
}

function spendModel() {
  const inv = investIbans();
  const shift = !!S.settings.salaryNextMonth;
  const monthKey = (t, cat) => {
    if (shift && cat === "Salary" && t.amount > 0) {
      const [y, m, d] = t.date.split("-").map(Number);
      const dim = new Date(y, m, 0).getDate();
      if (d >= dim - 6) return addMonths(ym(t.date), 1);
    }
    return ym(t.date);
  };
  const pots = potIbans();
  const tx = S.lhv.tx.filter(t => !S.settings.excludedIbans.includes(t.iban) && !pots.has(t.iban)).map(t => { const cat = categorize(t, inv); return { ...t, cat, mk: monthKey(t, cat) }; });
  const months = {};
  for (const t of tx) {
    const k = t.mk; const m = months[k] || (months[k] = { income: 0, spend: 0, invest: 0, oneoff: 0, divs: 0, cats: {} });
    if (t.cat === "Currency exchange" || t.cat === "Excluded" || t.noFx) continue;
    if (t.cat === "Own transfer" || t.cat === "Investing") { if (t.cat === "Investing" || pots.has(t.cpAcc) || !t.cpAcc) m.invest += -t.amount; continue; }
    if (t.cat === "Dividends & interest") { m.divs += t.amount; if (!incomeConfigured()) m.income += t.amount; continue; }
    if (t.amount > 0 && (INCOME_CATS.has(t.cat) || !incomeConfigured())) { m.income += t.amount; continue; }
    m.cats[t.cat] = (m.cats[t.cat] || 0) - t.amount; // outgoing adds, money back from people/refunds subtracts
  }
  for (const m of Object.values(months)) {
    // categories that went negative = money people paid back beyond what that category cost; it still reduces total spending
    let back = 0;
    for (const c of Object.keys(m.cats)) if (m.cats[c] <= 0.005) { back += -m.cats[c]; delete m.cats[c]; }
    m.paidBack = back;
    m.spend = Math.max(0, Object.values(m.cats).reduce((a, b) => a + b, 0) - back);
    m.oneoff = m.cats["One-off"] || 0;
  }
  const keys = Object.keys(months).sort();
  const cur = ym(today());
  const full = keys.filter(k => k < cur).slice(-3);
  const avg = f => full.length ? full.reduce((s, k) => s + f(months[k]), 0) / full.length : null;
  return { tx, months, keys, avgSpend: avg(m => m.spend - m.oneoff), avgIncome: avg(m => m.income), avgSave: avg(m => m.income - (m.spend - m.oneoff)), fullMonths: full.length };
}

// ---------- history snapshots ----------
let snapChain = Promise.resolve();
function snapshot(M) { snapChain = snapChain.then(() => doSnapshot(M)).catch(() => { }); }
async function doSnapshot(M) {
  if (S.demo || S.lhv.status === "loading" || S.ibkr.status === "loading") return;
  if (S.lhv.status !== "ok" && S.ibkr.status !== "ok") return;
  const pts = S.history.points || [];
  const d = today();
  const p = { d, nw: Math.round(M.total), cash: Math.round(M.cash), inv: Math.round(M.inv), other: Math.round(M.other), debt: Math.round(M.debt) };
  const last = pts[pts.length - 1];
  if (last && last.d === d && last.nw === p.nw && last.inv === p.inv) return;
  const next = pts.filter(x => x.d !== d).concat([p]).sort((a, b) => a.d.localeCompare(b.d)).slice(-3000);
  S.history = { points: next };
  await Store.set("history", S.history);
}
function historySeries(M) {
  const byMonth = {}, est = {};
  if (M) for (const [k, v] of Object.entries(rebuiltHistory(M))) { byMonth[k] = v; est[k] = true; }
  const pts = [...(S.history.points || []), ...(S.settings.backfill || []).filter(b => b.d && num(b.nw) != null).map(b => ({ d: b.d, nw: num(b.nw) }))];
  for (const p of pts.sort((a, b) => a.d.localeCompare(b.d))) { byMonth[ym(p.d)] = p.nw; delete est[ym(p.d)]; }
  Object.defineProperty(byMonth, "_est", { value: est, enumerable: false });
  return byMonth;
}

// Net worth at each of the last 12 month-ends, rebuilt from data we already have:
// IBKR = its own daily account value; LHV accounts = today's balance minus every transaction since;
// LHV growth/investment accounts = today's value minus money moved in since (their market moves are not rebuilt);
// pension, other assets and debts = held at today's value.
function monthEnd(k) { const [y, m] = k.split("-").map(Number); return k + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0"); }
function rebuiltHistory(M) {
  const out = {};
  const lhvOk = S.lhv.status === "ok" && S.lhv.tx.length, ibOk = S.ibkr.status === "ok";
  if (!lhvOk && !ibOk) return out;
  const nowK = ym(today());
  const eur = (v, ccy) => { const r = fxRate(ccy || "EUR"); return r == null ? 0 : (num(v) || 0) * r; };
  const growthSet = new Set(S.lhv.accounts.filter(a => a.type === "GROWTH").map(a => a.iban));
  for (const a of (S.lhv.portfolio && S.lhv.portfolio.accounts) || []) growthSet.add(a.iban);
  let lhvCashNow = 0, lhvGrowthNow = 0;
  for (const a of S.lhv.accounts) { const v = eur(a.availableBalance, a.currency); if (a.type === "GROWTH") lhvGrowthNow += v; else lhvCashNow += v; }
  for (const h of M.holdings) if (h.broker === "LHV") lhvGrowthNow += h.value || 0;
  const ibNow = M.holdings.filter(h => h.broker === "IBKR").reduce((s, h) => s + h.value, 0) + M.cashRows.filter(r => r.inst === "IBKR").reduce((s, r) => s + r.value, 0);
  const fixed = M.other + M.debt;
  const nav = (S.ibkr.navHistory || []).slice().sort((a, b) => a.d.localeCompare(b.d));
  const ibBase = fxRate(S.ibkr.currency || "EUR") || 1;
  const cashIbans = new Set(S.lhv.accounts.filter(a => a.type !== "GROWTH").map(a => a.iban));
  for (let i = 12; i >= 1; i--) {
    const k = addMonths(nowK, -i), end = monthEnd(k);
    let cash = lhvCashNow, growth = lhvGrowthNow;
    if (lhvOk) for (const t of S.lhv.tx) {
      if (t.date <= end || t.noFx) continue;
      cash -= t.amount;
      if (t.cpAcc && growthSet.has(t.cpAcc) && !cashIbans.has(t.cpAcc)) growth += t.amount; // money moved into a growth account after this month
    }
    let ib = ibNow;
    if (ibOk && nav.length) { let row = null; for (const r of nav) { if (r.d <= end) row = r; else break; } ib = (row || nav[0]).v * ibBase; }
    out[k] = cash + Math.max(0, growth) + ib + fixed;
  }
  return out;
}

// ---------- render ----------
let charts = {};
function chart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
if (window.Chart) {
  Chart.defaults.color = "#bba98e"; Chart.defaults.font.family = "IBM Plex Sans, system-ui, sans-serif"; Chart.defaults.font.size = 12;
  Chart.defaults.borderColor = "rgba(214,186,140,.08)";
  Chart.defaults.plugins.legend.display = false;
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: "rgba(30,23,18,.96)", borderColor: "rgba(214,186,140,.3)", borderWidth: 1, padding: 10, cornerRadius: 10, titleColor: "#f2e9d8", bodyColor: "#f2e9d8", displayColors: true, boxPadding: 4 });
}
const hidden = () => document.body.classList.contains("hide-amounts");
const tickEur = v => hidden() ? "•••" : (Math.abs(v) >= 1e6 ? "€" + (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e4 ? "€" + Math.round(v / 1e3) + "k" : Math.abs(v) >= 1e3 ? "€" + (+(v / 1e3).toFixed(1)) + "k" : "€" + v);

function kpi(label, value, delta, color) {
  return el("div", { class: "card glass kpi" },
    el("div", { class: "l" }, color ? el("i", { class: "sw", style: "background:" + color }) : null, label),
    el("div", { class: "v" }, amt(value)),
    delta != null ? el("div", { class: "d" }, delta) : null);
}
function bars(container, rows, opts = {}) {
  container.replaceChildren();
  if (!rows.length) { container.append(el("div", { class: "subtle" }, opts.empty || "Nothing yet.")); return; }
  const max = Math.max(...rows.map(r => Math.abs(r.value))) || 1;
  for (const r of rows) {
    const w = Math.max(1.5, Math.abs(r.value) / max * 100);
    const row = el("div", { class: "row" },
      el("div", { class: "name", title: r.label }, r.label),
      el("div", { class: "track" }, el("div", { class: "fill", style: `width:${w}%;background:${r.color || COLORS[0]}` })),
      el("div", { class: "num " + (r.cls || ""), style: "text-align:right;min-width:90px" }, amt(r.text != null ? r.text : fmt(r.value)), r.note ? el("span", { class: "subtle" }, " " + r.note) : null));
    if (opts.onclick) { row.style.cursor = "pointer"; row.addEventListener("click", () => opts.onclick(r)); }
    container.append(row);
  }
}
function table(tbl, cols, rows, sortState) {
  tbl.replaceChildren();
  const tr = el("tr");
  cols.forEach((c, i) => {
    const th = el("th", { class: c.r ? "r" : "" }, c.h + (sortState && sortState.i === i ? (sortState.dir > 0 ? " ↑" : " ↓") : ""));
    if (sortState && c.sort) th.addEventListener("click", () => { sortState.dir = sortState.i === i ? -sortState.dir : -1; sortState.i = i; sortState.redraw(); });
    tr.append(th);
  });
  tbl.append(el("thead", {}, tr));
  const body = el("tbody");
  if (sortState && cols[sortState.i] && cols[sortState.i].sort) {
    const f = cols[sortState.i].sort; rows = [...rows].sort((a, b) => { const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * sortState.dir; });
  }
  for (const r of rows) body.append(el("tr", {}, cols.map(c => { const v = c.v(r); return el("td", { class: (c.r ? "r " : "") + (c.cls ? c.cls(r) : "") }, v); })));
  tbl.append(body);
}

function renderChips() {
  const c = $("#chips"); c.replaceChildren();
  const chip = (name, st) => {
    const dot = st.status === "ok" ? "ok" : st.status === "loading" ? "wait" : st.status === "error" ? "err" : "";
    const label = st.status === "loading" ? "loading…" : st.status === "ok" ? "live" : st.status === "error" ? "needs attention" : "off";
    return el("span", { class: "chip", title: st.error ? errMsg(st.error, name) : "" }, el("i", { class: "dot " + dot }), name + " · " + label);
  };
  if (S.demo) c.append(el("span", { class: "chip" }, el("i", { class: "dot wait" }), "Demo data"));
  else { c.append(chip("LHV", S.lhv), chip("IBKR", S.ibkr)); }
  const b = $("#banners"); b.replaceChildren();
  if (S.demo) b.append(el("div", { class: "banner glass warn" }, el("div", { class: "msg" }, el("b", {}, "You're looking at made-up demo numbers. "), "Log out and back in to see your own money."), el("button", { class: "btn", onclick: () => { S.demo = false; boot(); } }, "Use my data")));

  for (const [name, st] of [["LHV", S.lhv], ["IBKR", S.ibkr]]) {
    if (S.demo || st.status !== "error" || !st.error) continue;
    const e = st.error; const btns = [];
    if (e.code === "approval_required") btns.push(el("button", { class: "btn primary", onclick: () => name === "LHV" ? loadLHV(true) : loadIBKR(true) }, "Allow " + name));
    if (e.code === "need_account" || e.code === "ibkr_not_connected") btns.push(el("button", { class: "btn primary", onclick: openSettings }, "Open settings"));
    if (e.code === "lhv_not_connected" || e.code === "lhv_reconnect") btns.push(el("button", { class: "btn primary", onclick: connectLHV }, "Connect LHV"));
    btns.push(el("button", { class: "btn ghost", onclick: () => name === "LHV" ? loadLHV(true) : loadIBKR(true) }, "Try again"));
    const msg = e.code === "need_account" ? e.message : errMsg(e, name === "LHV" ? "LHV" : IBKR_SERVER);
    b.append(el("div", { class: "banner glass" }, el("div", { class: "msg" }, el("b", {}, name + ": "), msg), ...btns));
  }
  const M = model();
  if (M.missingFx.length) b.append(el("div", { class: "banner glass warn" }, el("div", { class: "msg" }, "Some amounts are in " + M.missingFx.join(", ") + ". Add the rate to € in Settings so they're counted."), el("button", { class: "btn", onclick: openSettings }, "Add rate")));
}

function renderNetWorth(M) {
  $("#nwTotal").textContent = S.lhv.status === "ok" || S.ibkr.status === "ok" || S.demo || M.total ? fmt(M.total) : "—";
  const hs = S.history.points || [];
  const ago = d => { const t = new Date(); t.setDate(t.getDate() - d); return t.toISOString().slice(0, 10); };
  const ref = [...hs].reverse().find(p => p.d <= ago(30)) || hs[0];
  const sub = $("#nwSub"); sub.replaceChildren();
  if (ref && ref.d !== today()) { const ch = M.total - ref.nw; sub.append(el("span", { class: cls(ch) }, amt(signed(ch))), " since " + new Date(ref.d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })); }
  else sub.append("History builds up each day you open this page.");
  const k = $("#nwKpis"); k.replaceChildren(
    kpi("Cash", fmt(M.cash), null, COLORS[0]),
    kpi("Investments", fmt(M.inv), null, COLORS[2]),
    kpi("Other assets", fmt(M.other), M.otherRows.length ? null : el("a", { class: "lnk", href: "#", onclick: e => { e.preventDefault(); openSettings(); } }, "Add property, pension…"), COLORS[6]),
    kpi("Debts", fmt(M.debt), null, COLORS[1]));
  const alloc = [
    { label: "Cash", value: M.cash, color: COLORS[0] }, { label: "Investments", value: M.inv, color: COLORS[2] },
    { label: "Other assets", value: M.other, color: COLORS[6] }, { label: "Debts", value: M.debt, color: COLORS[1] }
  ].filter(r => r.value);
  const gross = M.cash + M.inv + M.other || 1;
  alloc.forEach(r => r.note = r.value > 0 ? Math.round(r.value / gross * 100) + "%" : "");
  bars($("#nwAlloc"), alloc);
  const inst = {};
  for (const r of [...M.cashRows, ...M.otherRows, ...M.debtRows]) inst[r.inst] = (inst[r.inst] || 0) + r.value;
  for (const h of M.holdings) inst[h.broker] = (inst[h.broker] || 0) + h.value;
  bars($("#nwInst"), Object.entries(inst).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: COLORS[i % 8] })));
  const rows = [...M.cashRows, ...M.otherRows, ...M.debtRows];
  const brokerInv = {};
  for (const h of M.holdings) { const key = h.broker + (h.account ? " · " + h.account : ""); brokerInv[key] = brokerInv[key] || { name: h.account || h.broker + " portfolio", inst: h.broker, kind: "Investments", value: 0 }; brokerInv[key].value += h.value; }
  rows.push(...Object.values(brokerInv));
  rows.sort((a, b) => b.value - a.value);
  table($("#nwTable"), [
    { h: "Name", v: r => r.name }, { h: "Where", v: r => el("span", { class: "tag" }, r.inst) }, { h: "Type", v: r => el("span", { class: "subtle" }, r.kind) },
    { h: "Value", r: 1, v: r => amt(fmt2(r.value)), cls: r => r.value < 0 ? "down" : "" }
  ], rows.filter(r => Math.abs(r.value) >= 0.01));
  const f = [S.lhv.fetchedAt, S.ibkr.fetchedAt].filter(Boolean);
  $("#nwFresh").textContent = S.demo ? "demo" : f.length ? "Updated " + new Date(Math.max(...f)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
}

const stSort = { i: 5, dir: -1, redraw: () => renderStocks(model()) };
function renderStocks(M) {
  const H = M.holdings;
  const tot = H.reduce((s, h) => s + h.value, 0);
  const withPnl = H.filter(h => h.pnl != null);
  const pnl = withPnl.reduce((s, h) => s + h.pnl, 0);
  const cost = withPnl.reduce((s, h) => s + (h.cost || 0), 0);
  $("#stTotal").textContent = H.length ? fmt(tot) : "—";
  const sub = $("#stSub"); sub.replaceChildren();
  if (withPnl.length) sub.append(el("span", { class: cls(pnl) }, amt(signed(pnl)), " (" + pct(cost ? pnl / cost * 100 : null) + ")"), " unrealized gain on holdings with a known cost");
  const todayItems = H.filter(h => h.today != null);
  const todayEur = todayItems.reduce((s, h) => s + h.value - h.value / (1 + h.today / 100), 0);
  const brokers = [...new Set(H.map(h => h.broker))];
  $("#stKpis").replaceChildren(
    kpi("Holdings", String(H.length), brokers.join(" · ") || null),
    kpi("Unrealized P/L", signed(pnl), cost ? el("span", { class: cls(pnl) }, pct(pnl / cost * 100)) : null),
    kpi("Today", todayItems.length ? signed(todayEur) : "—", todayItems.length ? el("span", { class: cls(todayEur) }, pct(todayEur / (tot || 1) * 100, 2)) : "No daily change reported"),
    divKpi());
  const top = [...H].sort((a, b) => b.value - a.value);
  const topRows = top.slice(0, 8).map((h, i) => ({ label: h.sym + " · " + h.broker, value: h.value, color: COLORS[i % 8], note: Math.round(h.value / (tot || 1) * 100) + "%" }));
  if (top.length > 8) topRows.push({ label: "Other (" + (top.length - 8) + ")", value: top.slice(8).reduce((s, h) => s + h.value, 0), color: "#8a7a63" });
  bars($("#stTop"), topRows, { empty: "No holdings found yet." });
  bars($("#stPnl"), [...withPnl].sort((a, b) => b.pnl - a.pnl).slice(0, 10).map(h => ({ label: h.sym, value: h.pnl, text: signed(h.pnl), cls: cls(h.pnl), color: h.pnl >= 0 ? "#6cc07a" : "#e2685d" })), { empty: "Cost isn't known for these holdings." });
  const q = ($("#stSearch").value || "").toLowerCase();
  const rows = H.filter(h => !q || (h.sym + " " + h.name + " " + h.broker).toLowerCase().includes(q));
  table($("#stTable"), [
    { h: "Symbol", v: h => el("span", { class: "sym" }, h.sym), sort: h => h.sym },
    { h: "Name", v: h => el("span", { class: "subtle" }, h.name), sort: h => h.name },
    { h: "Broker", v: h => el("span", { class: "tag" }, h.broker + (h.account ? " · " + h.account : "")), sort: h => h.broker },
    { h: "Qty", r: 1, v: h => amt(h.qty != null ? (+h.qty.toFixed(4)).toString() : "—"), sort: h => h.qty || 0 },
    { h: "Price", r: 1, v: h => h.price != null ? h.price.toLocaleString("en-IE", { maximumFractionDigits: 2 }) + " " + (h.ccy || "") : "—", sort: h => h.price || 0 },
    { h: "Value €", r: 1, v: h => amt(fmt2(h.value)), sort: h => h.value },
    { h: "Weight", r: 1, v: h => (h.value / (tot || 1) * 100).toFixed(1) + "%", sort: h => h.value },
    { h: "P/L €", r: 1, v: h => amt(h.pnl != null ? signed(h.pnl) : "—"), cls: h => cls(h.pnl), sort: h => h.pnl ?? -1e15 },
    { h: "P/L %", r: 1, v: h => h.pnl != null && h.cost ? pct(h.pnl / h.cost * 100) : "—", cls: h => cls(h.pnl), sort: h => h.cost ? h.pnl / h.cost : -1e15 },
    { h: "Today", r: 1, v: h => h.today != null ? pct(h.today, 2) : "—", cls: h => cls(h.today), sort: h => h.today ?? -1e9 },
  ], rows, stSort);
}

// Dividends received in the last 12 months, after withholding tax: IBKR (Flex cash transactions) + LHV (dividends & interest)
function divKpi() {
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const ib = (S.ibkr.dividends || []).filter(d => !d.date || d.date >= since);
  const ibNet = ib.reduce((s, d) => s + d.amount, 0);
  const ibTax = -ib.filter(d => d.kind === "tax").reduce((s, d) => s + d.amount, 0);
  let lhv = 0;
  if (S.lhv.tx.length) for (const t of spendModel().tx) if (t.cat === "Dividends & interest" && t.date >= since) lhv += t.amount;
  const parts = [];
  if (S.ibkr.status === "ok") parts.push("IBKR " + fmt(ibNet));
  if (S.lhv.tx.length) parts.push("LHV " + fmt(lhv));
  if (ibTax > 0.5) parts.push("tax withheld " + fmt(ibTax));
  return kpi("Dividends · 12 months", parts.length ? fmt(ibNet + lhv) : "—", parts.length ? parts.join(" · ") : "Connect a broker to see dividends", COLORS[2]);
}

let spMonthSel = null;
function renderSpending() {
  const SM = spendModel();
  const sel = $("#spMonth");
  const keys = SM.keys.slice().reverse();
  if (!spMonthSel || !keys.includes(spMonthSel)) spMonthSel = keys.includes(ym(today())) ? ym(today()) : (keys.filter(k => k <= ym(today()))[0] || keys[0] || ym(today()));
  sel.replaceChildren(...keys.map(k => el("option", { value: k, ...(k === spMonthSel ? { selected: "" } : {}) }, monthName(k))));
  const m = SM.months[spMonthSel] || { income: 0, spend: 0, invest: 0, oneoff: 0, divs: 0, cats: {} };
  const isCur = spMonthSel === ym(today());
  $("#spMonthLabel").textContent = isCur ? "Spent this month" : "Spent in " + monthName(spMonthSel);
  if (!S.lhv.tx.length) {
    $("#spTotal").textContent = "—";
    $("#spSub").textContent = S.lhv.status === "ok" ? "Loading transactions…" : "Connect LHV to see your spending.";
  } else {
    $("#spTotal").textContent = fmt(m.spend);
    const sub = $("#spSub"); sub.replaceChildren();
    if (SM.avgSpend) { const d = m.spend - SM.avgSpend; sub.append(isCur ? "So far this month. Your 3-month average is " : "", isCur ? amt(fmt(SM.avgSpend)) : el("span", { class: d > 0 ? "down" : "up" }, amt(signed(d)), " vs your 3-month average")); }
  }
  const save = m.income - m.spend;
  $("#spKpis").replaceChildren(
    kpi("Income", fmt(m.income), null, COLORS[2]),
    kpi("Spending", fmt(m.spend), null, COLORS[1]),
    (isCur && SM.avgSpend != null)
      ? kpi("Expected savings this month", signed(m.income - Math.max(m.spend, SM.avgSpend)), el("span", {}, "Income minus your usual spending (", amt(fmt(SM.avgSpend)), "). So far: ", el("span", { class: cls(save) }, amt(signed(save)))))
      : kpi("Saved", signed(save), m.income ? el("span", { class: cls(save) }, "Savings rate " + Math.round(save / m.income * 100) + "%") : null),
    kpi("Saved & invested", fmt(m.invest), "Moved to savings, Kasvukonto & brokers", COLORS[0]));
  const last = SM.keys.slice(-12);
  chart("spChart", {
    type: "bar",
    data: { labels: last.map(monthName), datasets: [
      { label: "Income", data: last.map(k => SM.months[k].income), backgroundColor: COLORS[2], borderRadius: 4, borderSkipped: "start", barPercentage: .8, categoryPercentage: .7, stack: "in" },
      { label: "Spending", data: last.map(k => SM.months[k].spend), backgroundColor: COLORS[1], borderColor: "#1e1712", borderWidth: { top: 2 }, borderRadius: 0, barPercentage: .8, categoryPercentage: .7, stack: "out" },
      { label: "Saved & invested", data: last.map(k => Math.max(0, SM.months[k].invest)), backgroundColor: COLORS[0], borderRadius: 4, borderSkipped: "start", barPercentage: .8, categoryPercentage: .7, stack: "out" }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      onClick: (e, els) => { if (els.length) { spMonthSel = last[els[0].index]; renderSpending(); } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: tickEur }, grid: { color: "rgba(214,186,140,.08)" }, border: { display: false } } },
      plugins: { tooltip: { callbacks: { label: c => " " + c.dataset.label + ": " + (hidden() ? "•••" : fmt(c.parsed.y)) } } } }
  });
  const cats = Object.entries(m.cats).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const top = cats.slice(0, 7);
  if (cats.length > 7) top.push(["Other categories", cats.slice(7).reduce((s, [, v]) => s + v, 0)]);
  const catColor = {}; top.forEach(([c], i) => catColor[c] = c === "Other categories" ? "#8a7a63" : COLORS[i % 8]);
  chart("spDonut", { type: "doughnut",
    data: { labels: top.map(([c]) => c), datasets: [{ data: top.map(([, v]) => v), backgroundColor: top.map(([c]) => catColor[c]), borderColor: "#1e1712", borderWidth: 2, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%",
      onClick: (e, els) => { if (els.length) { const c = top[els[0].index][0]; if (c !== "Other categories") { $("#spSearch").value = c; renderSpending(); } } },
      plugins: { tooltip: { callbacks: { label: c => " " + c.label + ": " + (hidden() ? "•••" : fmt(c.parsed)) + " · " + Math.round(c.parsed / (m.spend || 1) * 100) + "%" } } } } });
  const gross = cats.reduce((a, [, v]) => a + v, 0) || 1;
  const catRows = cats.map(([label, value]) => ({ label, value, color: catColor[label] || "#8a7a63", note: Math.round(value / gross * 100) + "%" }));
  if (m.paidBack > 0.5) catRows.push({ label: "Paid back to you", value: -m.paidBack, text: "−" + fmt(m.paidBack), color: "#6cc07a", cls: "up" });
  bars($("#spCats"), catRows, { empty: "No spending this month.", onclick: r => { if (r.label !== "Paid back to you") { $("#spSearch").value = r.label; renderSpending(); } } });
  const q = ($("#spSearch").value || "").toLowerCase();
  const rows = SM.tx.filter(t => t.mk === spMonthSel && (!q || (t.merchant + " " + t.desc + " " + t.cat).toLowerCase().includes(q)));
  const accName = Object.fromEntries(S.lhv.accounts.map(a => [a.iban, a.name]));
  const allCats = [...new Set(["Groceries", "Eating out", "Free time & entertainment", "Clothing", "Car", "Transport", "Travel", "Subscriptions", "Sport", "Bills", "Home", "Shopping", "Health", "Shared with girlfriend", "Family", "Payments to people", "Refunds", "Salary", "Income", "Dividends & interest", "Investing", "One-off", "Excluded", "Other", ...S.settings.rules.map(r => r.category)])].filter(Boolean);
  table($("#spTable"), [
    { h: "Date", v: t => el("span", { class: "subtle" }, t.date.slice(5)) },
    { h: "Merchant / payee", v: t => el("div", {}, el("div", {}, t.merchant), el("div", { class: "subtle", style: "font-size:11.5px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, t.desc)) },
    { h: "Account", v: t => el("span", { class: "tag" }, accName[t.iban] || "") },
    { h: "Category", v: t => {
      if (t.cat === "Own transfer") return el("span", { class: "subtle" }, "Own transfer");
      const s = el("select", { style: "padding:4px 8px;font-size:12.5px" }, allCats.map(c => el("option", { value: c, ...(c === t.cat ? { selected: "" } : {}) }, c)));
      s.addEventListener("change", async () => {
        const key = (t.merchant && t.merchant !== "—" ? t.merchant : t.desc.slice(0, 30)).toUpperCase();
        S.settings.rules = [{ match: key, category: s.value }, ...S.settings.rules.filter(r => String(r.match).toUpperCase() !== key)];
        await Store.set("settings", S.settings); renderSpending(); renderTrends(); toast("Rule saved: " + key + " → " + s.value);
      });
      return s; } },
    { h: "Amount", r: 1, v: t => amt(fmt2(t.amount)), cls: t => t.amount > 0 ? "up" : "" },
  ], rows.slice(0, 400));
}

let planTouched = false;
// Your recent saving: averages over the last n full months
function savingStats(SM, n) {
  const cur = ym(today());
  const ks = SM.keys.filter(k => k < cur).slice(-n);
  if (!ks.length) return null;
  const inWin = new Set(ks); const invSet = investIbans();
  let inc = 0, sp = 0, usual = 0, inv = 0;
  for (const k of ks) { const m = SM.months[k]; inc += m.income; sp += m.spend; usual += m.spend - m.oneoff; }
  // money that went into investments (brokers, LHV growth/investment accounts), net of withdrawals; savings deposits don't count
  for (const t of SM.tx) if (inWin.has(t.mk) && !t.noFx && (t.cat === "Investing" || (t.cpAcc && invSet.has(t.cpAcc)))) inv += -t.amount;
  const L = ks.length, saved = (inc - sp) / L;
  return { keys: ks, n: L, income: inc / L, spend: sp / L, usual: usual / L, saved, savedTotal: inc - sp, rate: inc > 0 ? (inc - sp) / inc : null,
    invested: inv / L, investShare: saved > 0 ? Math.min(1, Math.max(0, inv / L / saved)) : 0 };
}
function planDefaults(M, SM, win) {
  const st = savingStats(SM, win);
  return {
    contrib: st ? Math.round(st.saved / 10) * 10 : 500,
    share: st ? Math.round(st.investShare * 100) : 50,
    ret: 7, cash: 2, infl: 2.5, grow: 0,
    spend: st && st.usual > 0 ? Math.round(st.usual * 12 / 100) * 100 : 18000, mult: 25, age: "", years: 30,
  };
}
function readPlan(M, SM) {
  const p = S.settings.plan || {};
  const win = [3, 4, 5, 6, 12].includes(+p.win) ? +p.win : 4;
  const d = planDefaults(M, SM, win);
  const set = k => p[k] !== undefined && p[k] !== "" && p[k] !== null;
  const g = k => set(k) ? p[k] : d[k];
  return { win, auto: { contrib: !set("contrib"), share: !set("share"), spend: !set("spend") }, stats: savingStats(SM, win),
    contrib: +g("contrib"), share: Math.min(100, Math.max(0, +g("share"))), ret: +g("ret"), cash: +g("cash"), infl: +g("infl"), grow: +g("grow"),
    spend: +g("spend"), mult: +g("mult"), age: g("age") === "" ? null : +g("age"), years: Math.min(60, Math.max(1, +g("years") || 30)) };
}
// Monthly simulation in today's euros: investments grow at (return − inflation), cash at (interest − inflation).
// Each month you add your saving: the invested share goes to investments, the rest stays as cash.
function project(cash0, inv0, P, retPct, months) {
  const real = pct => Math.pow((1 + pct / 100) / (1 + P.infl / 100), 1 / 12) - 1;
  const ri = real(retPct), rc = real(P.cash), g = Math.pow(1 + P.grow / 100, 1 / 12) - 1;
  let c = cash0, v = inv0, k = P.contrib; const out = [c + v];
  for (let i = 1; i <= months; i++) {
    const toInv = k > 0 ? k * P.share / 100 : 0;
    v = v * (1 + ri) + toInv; c = c * (1 + (c > 0 ? rc : 0)) + (k - toInv);
    if (c < 0 && v > 0) { const take = Math.min(v, -c); v -= take; c += take; } // spend from investments when cash runs out
    k *= 1 + g; out.push(c + v);
  }
  return out;
}
function renderTrends() {
  const M = model(); const SM = spendModel(); const P = readPlan(M, SM); const st = P.stats;
  const inputs = { trContrib: "contrib", trShare: "share", trReturn: "ret", trCash: "cash", trInfl: "infl", trGrow: "grow", trSpend: "spend", trMult: "mult", trAge: "age", trYears: "years" };
  for (const [id, k] of Object.entries(inputs)) { const i = document.getElementById(id); if (document.activeElement !== i) i.value = P[k] ?? ""; }
  $("#trWin").value = String(P.win);
  for (const [id, k] of [["trContrib", "contrib"], ["trShare", "share"], ["trSpend", "spend"]]) document.getElementById(id).closest("label").classList.toggle("auto", P.auto[k]);
  const fiTarget = P.spend * P.mult;
  const months = P.years * 12;
  const start = M.total;
  const cash0 = M.cash, inv0 = M.inv + M.other + M.debt;
  const base = project(cash0, inv0, P, P.ret, months);
  const low = project(cash0, inv0, P, P.ret - 2, months);
  const high = project(cash0, inv0, P, P.ret + 2, months);
  const hist = historySeries(M); const est = hist._est || {}; const histKeys = Object.keys(hist).sort();
  const nowK = ym(today());
  const firstK = histKeys.length ? (histKeys[0] < nowK ? histKeys[0] : nowK) : nowK;
  const labels = []; for (let k = firstK; k <= addMonths(nowK, months); k = addMonths(k, 1)) labels.push(k);
  const idxNow = labels.indexOf(nowK);
  const pad = arr => labels.map((_, i) => i < idxNow ? null : arr[i - idxNow]);
  const histData = labels.map(k => k < nowK ? (hist[k] ?? null) : k === nowK ? start : null);
  // what actually happened over the window: change in net worth = what you saved + everything else (markets, dividends, pension)
  let past = null;
  if (st) {
    const k0 = addMonths(st.keys[0], -1), k1 = st.keys[st.keys.length - 1];
    if (hist[k0] != null && hist[k1] != null) { const d = hist[k1] - hist[k0]; past = { d, saved: st.savedTotal, market: d - st.savedTotal, est: !!(est[k0] || est[k1]) }; }
  }
  const hitIdx = arr => { const i = arr.findIndex(v => v >= fiTarget); return i < 0 ? null : i; };
  const fiI = hitIdx(base);
  const fiDate = fiI != null ? addMonths(nowK, fiI) : null;
  $("#trHeadLabel").textContent = "Financial independence (base case)";
  $("#trHead").textContent = fiI == null ? "Beyond " + P.years + " yrs" : fiI === 0 ? "Reached" : monthName(fiDate);
  const sub = $("#trSub"); sub.replaceChildren();
  sub.append("Target ", amt(fmt(fiTarget)), ` (${P.mult}× your yearly spending of `, amt(fmt(P.spend)), ")");
  if (fiI != null && fiI > 0) { const lo = hitIdx(high), hi = hitIdx(low); sub.append(` · in ${(fiI / 12).toFixed(1)} years` + (P.age ? `, at age ${Math.floor(P.age + fiI / 12)}` : "") + (lo != null && hi != null ? ` (range ${(lo / 12).toFixed(0)}–${(hi / 12).toFixed(0)} yrs)` : "")); }
  sub.append(el("br"), el("span", { class: "subtle" }, "All future amounts are in today's euros, after " + P.infl + "% inflation."));
  const yr = n => base[Math.min(months, n * 12)];
  $("#trKpis").replaceChildren(
    kpi("Your saving pace", st ? signed(st.saved) + "/mo" : "—",
      st ? el("span", {}, (st.rate != null ? Math.round(st.rate * 100) + "% of income" : "No income found") + " · avg of last " + st.n + " mo · " + Math.round(st.investShare * 100) + "% of it invested") : "Connect LHV to measure it", COLORS[2]),
    kpi("Last " + (st ? st.n : P.win) + " months", past ? signed(past.d) : "—",
      past ? el("span", {}, amt(signed(past.saved)), " saved · ", el("span", { class: cls(past.market) }, amt(signed(past.market))), " markets & other" + (past.est ? " (estimated)" : "")) : "Needs a few months of history", COLORS[0]),
    kpi("In 10 years", fmt(yr(10)), "At your current pace, " + P.ret + "% return", COLORS[0]),
    kpi("In " + P.years + " years", fmt(base[months]), el("span", {}, "Range ", amt(fmt(low[months])), " – ", amt(fmt(high[months])))));
  const leg = $("#trLegend"); leg.replaceChildren(
    el("span", {}, el("i", { class: "ln", style: "background:#f2e9d8" }), "Past (rebuilt from IBKR & LHV)"),
    el("span", {}, el("i", { class: "ln", style: "background:" + COLORS[0] }), "If you keep saving like the last " + P.win + " months"),
    el("span", { style: "color:" + COLORS[2] }, el("i", { class: "ln dash" }), el("span", { style: "color:var(--muted)" }, "Markets +2%")),
    el("span", { style: "color:" + COLORS[1] }, el("i", { class: "ln dash" }), el("span", { style: "color:var(--muted)" }, "Markets −2%")),
    el("span", {}, el("i", { class: "ln", style: "background:" + COLORS[3] }), "FI target"));
  const ds = [
    { label: "Net worth", data: histData, borderColor: "#f2e9d8", backgroundColor: "#f2e9d8", borderWidth: 2, pointRadius: 0, spanGaps: true, tension: .25 },
    { label: "Your pace", data: pad(base), borderColor: COLORS[0], backgroundColor: "rgba(63,114,184,.12)", fill: false, borderWidth: 2, pointRadius: 0, tension: .2 },
    { label: "Markets +2%", data: pad(high), borderColor: COLORS[2], borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
    { label: "Markets −2%", data: pad(low), borderColor: COLORS[1], borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
    { label: "FI target", data: labels.map(() => fiTarget), borderColor: COLORS[3], borderWidth: 1, pointRadius: 0 },
  ];
  const yStep = labels.length > 300 ? 5 : labels.length > 150 ? 2 : 1;
  const yearTick = (v, i) => { const k = labels[i]; return k && k.endsWith("-01") && (+k.slice(0, 4)) % yStep === 0 ? k.slice(0, 4) : ""; };
  chart("trChart", { type: "line", data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: { x: { grid: { display: false }, ticks: { callback: yearTick, autoSkip: false, maxRotation: 0 } }, y: { ticks: { callback: tickEur }, grid: { color: "rgba(214,186,140,.08)" }, border: { display: false } } },
      plugins: { tooltip: { callbacks: { title: c => monthName(labels[c[0].dataIndex]) + (est[labels[c[0].dataIndex]] ? " (rebuilt)" : ""), label: c => c.parsed.y == null ? null : " " + c.dataset.label + ": " + (hidden() ? "•••" : fmt(c.parsed.y)) } } } } });
  const ms = [10000, 25000, 50000, 100000, 250000, 500000, 1000000].filter(v => v > start);
  const mrows = ms.map(v => ({ label: fmt(v), i: base.findIndex(x => x >= v) })).filter(r => r.i >= 0).slice(0, 6);
  if (fiI != null && fiI > 0) mrows.push({ label: "FI target · " + fmt(fiTarget), i: fiI, fi: true });
  mrows.sort((a, b) => a.i - b.i);
  table($("#trMilestones"), [
    { h: "Net worth (today's €)", v: r => r.fi ? el("b", {}, amt(r.label)) : amt(r.label) },
    { h: "When", v: r => monthName(addMonths(nowK, r.i)) },
    { h: "From now", r: 1, v: r => r.i < 12 ? r.i + " mo" : (r.i / 12).toFixed(1) + " yrs" },
    ...(P.age ? [{ h: "Your age", r: 1, v: r => String(Math.floor(P.age + r.i / 12)) }] : []),
  ], mrows);
  // what saving more would do: +€100/mo
  const more = project(cash0, inv0, { ...P, contrib: P.contrib + 100 }, P.ret, months);
  const fiMore = hitIdx(more);
  $("#trWhatIf").textContent = fiI != null && fiMore != null && fiI > 0 ? `Saving €100 more per month would bring FI ${((fiI - fiMore) / 12).toFixed(1)} years sooner and add ${hidden() ? "•••" : fmt(more[months] - base[months])} by year ${P.years}.` : "";
  const last = SM.keys.filter(k => k < nowK).slice(-12);
  const win = new Set(st ? st.keys : []);
  const sv = k => SM.months[k].income - SM.months[k].spend;
  chart("trSaveChart", { type: "bar", data: { labels: last.map(monthName), datasets: [{ label: "Saved", data: last.map(sv),
    backgroundColor: last.map(k => (sv(k) >= 0 ? COLORS[2] : COLORS[7]) + (win.has(k) ? "" : "55")), borderRadius: 4, borderSkipped: "start" }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { ticks: { callback: tickEur }, grid: { color: "rgba(214,186,140,.08)" }, border: { display: false } } },
      plugins: { tooltip: { callbacks: { label: c => { const k = last[c.dataIndex], m = SM.months[k]; return hidden() ? " •••" : [" Saved: " + fmt(c.parsed.y) + (m.income > 0 ? " (" + Math.round(c.parsed.y / m.income * 100) + "% of income)" : ""), " Income " + fmt(m.income) + " · spent " + fmt(m.spend)]; } } } } } });
}

let renderQueued = false;
function renderAll() {
  if (renderQueued) return; renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const M = model();
    renderChips(); renderNetWorth(M); renderStocks(M); renderSpending(); renderTrends();
    snapshot(M);
  });
}

// ---------- routing ----------
function route() {
  const v = (location.hash || "#networth").slice(1);
  const name = ["networth", "stocks", "spending", "trends"].includes(v) ? v : "networth";
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + name));
  document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.v === name));
  Object.values(charts).forEach(c => c.resize());
}
window.addEventListener("hashchange", route);

// ---------- settings drawer ----------
function listEditor(container, arr, fields, onChange) {
  container.replaceChildren();
  arr.forEach((item, idx) => {
    const row = el("div", { class: "list-item" });
    for (const f of fields) {
      const inp = f.options ? el("select", {}, f.options.map(o => el("option", { value: o, ...(item[f.k] === o ? { selected: "" } : {}) }, o))) : el("input", { placeholder: f.ph, type: f.type || "text", value: item[f.k] ?? "", style: f.w ? "flex:0 0 " + f.w : "" });
      inp.addEventListener("input", () => { item[f.k] = inp.value; onChange && onChange(); });
      inp.addEventListener("change", () => { item[f.k] = inp.value; });
      row.append(inp);
    }
    row.append(el("button", { class: "btn ghost", onclick: () => { arr.splice(idx, 1); listEditor(container, arr, fields, onChange); } }, "✕"));
    container.append(row);
  });
}
let draft = null;
function openSettings() {
  draft = structuredClone(S.settings);
  const conn = $("#setConn"); conn.replaceChildren();
  const dot = st => el("i", { class: "dot " + (st.status === "ok" ? "ok" : st.status === "error" ? "err" : "") });
  conn.append(el("div", { class: "list-item" }, dot(S.lhv), el("span", { style: "flex:1" }, "LHV"),
    el("button", { class: "btn", onclick: connectLHV }, S.lhv.status === "ok" ? "Log in again" : "Connect LHV"),
    el("button", { class: "btn ghost", onclick: showLhvPaste }, "Paste LHV address"),
    S.lhv.status === "ok" ? el("button", { class: "btn ghost", onclick: async () => { await fn("lhv", "disconnect"); toast("LHV disconnected"); loadLHV(true); } }, "Disconnect") : null));
  const tok = el("input", { placeholder: "Flex token", type: "password", autocomplete: "off" });
  const qid = el("input", { placeholder: "Query ID", style: "flex:0 0 120px" });
  const ibMsg = el("div", { class: "subtle", style: "margin-top:4px" }, S.ibkr.status === "ok" ? "Connected. Paste a new token below only to replace it." : "Paste the Flex Web Service token and Query ID from IBKR (see README).");
  conn.append(el("div", { class: "list-item", style: "margin-top:8px" }, dot(S.ibkr), el("span", { style: "flex:1" }, "Interactive Brokers")),
    el("div", { class: "list-item" }, tok, qid, el("button", { class: "btn", onclick: async () => {
      ibMsg.textContent = "Checking with IBKR…";
      try { await fn("ibkr", "setup", { token: tok.value, queryId: qid.value }); tok.value = ""; ibMsg.textContent = "Saved and working."; loadIBKR(false); }
      catch (e) { ibMsg.textContent = (e && e.message) || "Didn't work."; }
    } }, "Save")), ibMsg);
  const acc = $("#setAccounts");
  if (S.lhv.accounts.length) {
    acc.replaceChildren(...S.lhv.accounts.filter(a => a.type !== "GROWTH").map(a => {
      const cb = el("input", { type: "checkbox", ...(draft.excludedIbans.includes(a.iban) ? {} : { checked: "" }) });
      cb.addEventListener("change", () => { draft.excludedIbans = cb.checked ? draft.excludedIbans.filter(x => x !== a.iban) : [...draft.excludedIbans, a.iban]; });
      return el("label", { class: "list-item", style: "color:var(--fg)" }, cb, a.name || a.iban);
    }));
  }
  const ed = () => {
    listEditor($("#setAssets"), draft.assets, [{ k: "name", ph: "Name" }, { k: "kind", options: ["Property", "Pension (II/III pillar)", "Crypto", "Car", "Savings elsewhere", "Other asset"] }, { k: "value", ph: "€", type: "number", w: "110px" }]);
    listEditor($("#setDebts"), draft.debts, [{ k: "name", ph: "Name" }, { k: "value", ph: "€ owed", type: "number", w: "120px" }]);
    listEditor($("#setManualPos"), draft.manualPositions, [{ k: "sym", ph: "Symbol", w: "90px" }, { k: "broker", ph: "Broker", w: "110px" }, { k: "qty", ph: "Qty", type: "number", w: "80px" }, { k: "value", ph: "€ value", type: "number" }]);
    listEditor($("#setFx"), draft.fx, [{ k: "ccy", ph: "USD", w: "90px" }, { k: "rate", ph: "1 unit = ? €", type: "number" }]);
    listEditor($("#setRules"), draft.rules, [{ k: "match", ph: "text in description" }, { k: "category", ph: "Category", w: "150px" }]);
    listEditor($("#setHist"), draft.backfill, [{ k: "d", type: "date", w: "160px" }, { k: "nw", ph: "Net worth €", type: "number" }]);
  };
  ed();
  $("#setIbkrAcct").value = draft.ibkrAccount || "";
  $("#setSalaryShift").checked = !!draft.salaryNextMonth;
  $("#setPeopleCat").value = draft.peopleCategory || "";
  const inc = draft.income || {};
  $("#setIncPayers").value = (inc.payers || []).join(", ");
  $("#setIncKeys").value = (inc.keywords || []).join(", ");
  $("#setSalaryShift").onchange = e => { draft.salaryNextMonth = e.target.checked; };
  $("#addAsset").onclick = () => { draft.assets.push({ name: "", kind: "Other asset", value: "" }); ed(); };
  $("#addDebt").onclick = () => { draft.debts.push({ name: "", value: "" }); ed(); };
  $("#addPos").onclick = () => { draft.manualPositions.push({ sym: "", broker: "", qty: "", value: "" }); ed(); };
  $("#addFx").onclick = () => { draft.fx.push({ ccy: "USD", rate: "" }); ed(); };
  $("#addRule").onclick = () => { draft.rules.unshift({ match: "", category: "" }); ed(); };
  $("#addHist").onclick = () => { draft.backfill.push({ d: "", nw: "" }); ed(); };
  $("#drawer").classList.add("on"); $("#drawerBg").classList.add("on");
}
function closeSettings() { $("#drawer").classList.remove("on"); $("#drawerBg").classList.remove("on"); }
$("#btnSettings").onclick = openSettings; $("#btnClose").onclick = closeSettings; $("#drawerBg").onclick = closeSettings;
$("#btnSave").onclick = async () => {
  draft.ibkrAccount = $("#setIbkrAcct").value.trim();
  draft.peopleCategory = $("#setPeopleCat").value.trim();
  const split = v => v.split(",").map(x => x.trim()).filter(Boolean);
  draft.income = { payers: split($("#setIncPayers").value), keywords: split($("#setIncKeys").value) };
  draft.rules = draft.rules.filter(r => r.match);
  const acctChanged = draft.ibkrAccount !== S.settings.ibkrAccount;
  S.settings = draft; await Store.set("settings", S.settings);
  closeSettings(); toast(Store.mode === "cloud" ? "Saved to your account" : "Saved in this browser");
  if (acctChanged && S.mcp && !S.demo) loadIBKR(true);
  renderAll();
};
$("#btnDemo").onclick = () => { closeSettings(); startDemo(); };
$("#btnCopyRaw").onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(S.ibkr.raw || { note: "IBKR hasn't answered yet" }, null, 2).slice(0, 200000)); toast("Copied"); }
  catch { toast("Your browser blocked copying"); }
};

// ---------- trends inputs ----------
for (const [id, k] of Object.entries({ trContrib: "contrib", trShare: "share", trReturn: "ret", trCash: "cash", trInfl: "infl", trGrow: "grow", trSpend: "spend", trMult: "mult", trAge: "age", trYears: "years", trWin: "win" })) {
  const i = document.getElementById(id);
  i.addEventListener(i.tagName === "SELECT" ? "change" : "input", () => { S.settings.plan = { ...(S.settings.plan || {}), [k]: i.value }; renderTrends(); savePlanSoon(); });
}
let planTimer; const savePlanSoon = () => { clearTimeout(planTimer); planTimer = setTimeout(() => { if (!S.demo) Store.set("settings", S.settings); }, 1200); };
$("#trReset").onclick = () => { const p = S.settings.plan || {}; S.settings.plan = { age: p.age, win: p.win }; renderTrends(); savePlanSoon(); };

// ---------- misc controls ----------
try { if (localStorage.getItem("mymoney:hide") === "1") document.body.classList.add("hide-amounts"); } catch { }
$("#btnHide").onclick = () => { document.body.classList.toggle("hide-amounts"); try { localStorage.setItem("mymoney:hide", hidden() ? "1" : "0"); } catch { } Object.values(charts).forEach(c => c.update()); };
$("#btnRefresh").onclick = () => { if (S.demo || !S.mcp) return; loadLHV(true); loadIBKR(true); };
$("#stSearch").addEventListener("input", () => renderStocks(model()));
$("#spSearch").addEventListener("input", renderSpending);
$("#spMonth").addEventListener("change", e => { spMonthSel = e.target.value; renderSpending(); });

// ---------- demo data (made up, for friends to preview) ----------
function startDemo() {
  S.demo = true;
  const accts = [{ iban: "EE00DEMO1", currency: "EUR", availableBalance: 2140.55, type: "CURRENT", name: "Everyday" }, { iban: "EE00DEMO2", currency: "EUR", availableBalance: 6500, type: "CURRENT", name: "Savings" }, { iban: "EE00DEMO3", currency: "EUR", availableBalance: 12.4, type: "GROWTH", name: "Growth account" }];
  const P = (symbol, name, q, price, buy, today) => ({ symbol, name, quantity: q, latestPrice: price, currency: "EUR", baseCurrencyMarketValue: q * price, baseCurrencyProfitLoss: q * (price - buy), todayChange: today });
  S.lhv = { status: "ok", server: "demo", accounts: accts, fetchedAt: Date.now(), tx: [], portfolio: { accounts: [{ iban: "EE00DEMO3", positions: [P("VWCE", "Vanguard FTSE All-World", 42, 128.4, 104, .4), P("SXR8", "iShares Core S&P 500", 6, 610, 520, .6), P("EXXT", "iShares NASDAQ-100", 9, 236, 190, .9)] }] } };
  S.ibkr = { status: "ok", currency: "EUR", cash: 310, netLiq: null, fetchedAt: Date.now(), positions: [{ sym: "MSFT", name: "Microsoft", qty: 4, price: 420, value: 1680, pnl: 210, ccy: "EUR" }, { sym: "AAPL", name: "Apple", qty: 6, price: 205, value: 1230, pnl: 95, ccy: "EUR" }] };
  const own = new Set(accts.map(a => a.iban)); const tx = [];
  const merchants = [["RIMI TALLINN", 34, "Groceries"], ["WOLT", 22], ["BOLT", 9], ["SPOTIFY", 11.99], ["PLAYTOMIC.IO", 18], ["SELVER", 41], ["TELIA EESTI", 25], ["ZALANDO", 60]];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 11; i >= 0; i--) {
    const k = addMonths(ym(today()), -i);
    tx.push({ id: "s" + i, date: k + "-05", amount: 2650, currency: "EUR", desc: "PALK", merchant: "Employer OÜ", iban: "EE00DEMO1", internal: false, card: false });
    tx.push({ id: "r" + i, date: k + "-02", amount: -620, currency: "EUR", desc: "Üür", merchant: "Landlord", iban: "EE00DEMO1", internal: false, card: false });
    tx.push({ id: "i" + i, date: k + "-06", amount: -500, currency: "EUR", desc: "Investeerimine", merchant: "Growth account", iban: "EE00DEMO1", internal: true, cpAcc: "EE00DEMO3", card: false });
    for (let j = 0; j < 22; j++) { const m = merchants[Math.floor(rnd() * merchants.length)]; const day = String(1 + Math.floor(rnd() * 27)).padStart(2, "0"); const d = k + "-" + day; if (d > today()) continue; tx.push({ id: k + j, date: d, amount: -Math.round(m[1] * (0.6 + rnd() * .9) * 100) / 100, currency: "EUR", desc: "(..1234) " + d + " 12:00 " + m[0], merchant: m[0], iban: "EE00DEMO1", internal: false, card: true }); }
  }
  S.lhv.tx = tx.filter(t => t.date <= today()).sort((a, b) => b.date.localeCompare(a.date));
  S.history = { points: [] };
  S.settings = { ...DEFAULT_SETTINGS(), assets: [{ name: "II pillar pension", kind: "Pension (II/III pillar)", value: 7400 }], backfill: Array.from({ length: 12 }, (_, i) => ({ d: addMonths(ym(today()), -12 + i) + "-15", nw: Math.round(21000 + i * 1150 + Math.sin(i) * 600) })) };
  renderAll();
}


// ---------- landscape backgrounds (painted in SVG, no outside images) ----------
function rng(seed) { let x = seed; return () => (x = (x * 16807) % 2147483647) / 2147483647; }
function ridge(y, amp, seed, w = 1600, h = 1000, step = 16) {
  const r = rng(seed); const ph = [r() * 6, r() * 6, r() * 6]; const f = [1.2 + r(), 2.6 + r() * 2, 6 + r() * 4];
  let d = `M0 ${h} L0 ${y}`;
  for (let x = 0; x <= w; x += step) {
    const t = x / w * Math.PI * 2;
    const v = Math.sin(t * f[0] / 2 + ph[0]) * amp + Math.sin(t * f[1] / 2 + ph[1]) * amp * .35 + Math.sin(t * f[2] / 2 + ph[2]) * amp * .08;
    d += ` L${x} ${(y - v).toFixed(1)}`;
  }
  return d + ` L${w} ${h} Z`;
}
function trees(y, n, seed, color, size) {
  const r = rng(seed); let out = "";
  for (let i = 0; i < n; i++) { const x = r() * 1600, yy = y + r() * 60, s = size * (.6 + r() * .8); out += `<ellipse cx="${x.toFixed(0)}" cy="${yy.toFixed(0)}" rx="${(s * 1.1).toFixed(1)}" ry="${(s * .9).toFixed(1)}" fill="${color}"/>`; }
  return `<g opacity=".45" filter="url(#tb)">${out}</g>`;
}
function pines(base, n, seed, color, hgt) {
  const r = rng(seed); let out = "";
  for (let i = 0; i < n; i++) { const x = i * (1600 / n) + r() * 30, h = hgt * (.6 + r() * .7), w = h * .28, b = base + r() * 20; out += `<path d="M${x} ${b - h} L${x - w} ${b} L${x + w} ${b} Z" fill="${color}"/>`; }
  return out;
}
const SCENES = {
  hills: () => `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb0b8"/><stop offset=".45" stop-color="#e9d2a4"/><stop offset=".62" stop-color="#f3c47c"/></linearGradient>
    <radialGradient id="sun" cx=".7" cy=".42" r=".45"><stop offset="0" stop-color="#fff2c8" stop-opacity=".95"/><stop offset=".25" stop-color="#ffd98c" stop-opacity=".55"/><stop offset="1" stop-color="#ffd98c" stop-opacity="0"/></radialGradient>
    <filter id="b1"><feGaussianBlur stdDeviation="6"/></filter><filter id="tb"><feGaussianBlur stdDeviation="1.6"/></filter><filter id="b2"><feGaussianBlur stdDeviation="2"/></filter>
    <linearGradient id="h1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a39a6c"/><stop offset="1" stop-color="#7d7a52"/></linearGradient>
    <linearGradient id="h2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f8f4c"/><stop offset="1" stop-color="#5d6a32"/></linearGradient>
    <linearGradient id="h3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f8034"/><stop offset="1" stop-color="#3e4d1f"/></linearGradient>
    <linearGradient id="h4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f5f24"/><stop offset="1" stop-color="#232c10"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#sk)"/><rect width="1600" height="1000" fill="url(#sun)"/>
    <path d="${ridge(520, 40, 11)}" fill="url(#h1)" opacity=".75" filter="url(#b1)"/>
    <path d="${ridge(600, 60, 23)}" fill="url(#h2)" opacity=".92" filter="url(#b2)"/>
    <rect y="560" width="1600" height="90" fill="#f6dfae" opacity=".18" filter="url(#b1)"/>
    <path d="${ridge(700, 80, 37)}" fill="url(#h3)"/>${trees(640, 26, 5, "#2f3a14", 7)}
    <path d="${ridge(840, 70, 51)}" fill="url(#h4)"/>${trees(800, 18, 9, "#1b220b", 11)}
  </svg>`,
  estate: () => `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sk2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3a48"/><stop offset=".5" stop-color="#b07a52"/><stop offset=".6" stop-color="#e2a86a"/></linearGradient>
    <linearGradient id="lk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c88f5e"/><stop offset="1" stop-color="#2a2420"/></linearGradient><filter id="bb"><feGaussianBlur stdDeviation="4"/></filter></defs>
    <rect width="1600" height="1000" fill="url(#sk2)"/><circle cx="520" cy="560" r="70" fill="#ffe1a8" opacity=".55" filter="url(#bb)"/>
    <path d="${ridge(560, 35, 71)}" fill="#5a4b45" opacity=".8" filter="url(#bb)"/>
    <g>${pines(600, 70, 3, "#2a2a22", 90)}</g><rect y="600" width="1600" height="400" fill="url(#lk)"/>
    <g opacity=".25" transform="translate(0 1200) scale(1 -1)">${pines(600, 70, 3, "#1a1814", 90)}</g>
    <path d="${ridge(880, 40, 83)}" fill="#1c1a14"/>${pines(900, 40, 7, "#121109", 160)}
  </svg>`,
  autumn: () => `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sk3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c7b9a3"/><stop offset=".55" stop-color="#e8c79a"/></linearGradient><filter id="bc"><feGaussianBlur stdDeviation="5"/></filter><filter id="tb"><feGaussianBlur stdDeviation="1.6"/></filter></defs>
    <rect width="1600" height="1000" fill="url(#sk3)"/>
    <path d="${ridge(500, 50, 101)}" fill="#9a8a78" opacity=".7" filter="url(#bc)"/>
    <path d="${ridge(590, 70, 113)}" fill="#a2683a" opacity=".9"/>${trees(560, 30, 13, "#8a4a26", 6)}
    <path d="${ridge(700, 75, 127)}" fill="#8a4a24"/>${trees(660, 24, 17, "#6e3519", 7)}
    <path d="${ridge(830, 70, 139)}" fill="#5a3a1c"/>${trees(800, 16, 19, "#46290f", 9)}
    <path d="${ridge(940, 40, 151)}" fill="#2e2010"/>
  </svg>`,
};
let bgPhoto = null;
function applyBackground() {
  const kind = S.settings.bg || "hills";
  const el = $("#bg");
  if (kind === "photo" && bgPhoto) { el.innerHTML = ""; const img = new Image(); img.src = bgPhoto; img.alt = ""; el.append(img); }
  else el.innerHTML = (SCENES[kind] || SCENES.hills)();
  document.querySelectorAll("#setBg button").forEach(b => b.classList.toggle("on", b.dataset.bg === kind));
}
document.querySelectorAll("#setBg button").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.bg === "photo" && !bgPhoto) { $("#bgNote").textContent = "Upload a photo first."; return; }
  S.settings.bg = b.dataset.bg; if (draft) draft.bg = b.dataset.bg; applyBackground(); Store.set("settings", S.settings);
}));
$("#bgFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  $("#bgNote").textContent = "Preparing…";
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); });
    let w = Math.min(1920, img.naturalWidth), q = .78, url = "";
    for (let tries = 0; tries < 8; tries++) {
      const h = Math.round(img.naturalHeight * w / img.naturalWidth);
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
      url = c.toDataURL("image/jpeg", q);
      if (url.length < 240000) break;
      if (q > .5) q -= .1; else w = Math.round(w * .8);
    }
    bgPhoto = url; await Store.set("background", { img: url });
    S.settings.bg = "photo"; if (draft) draft.bg = "photo"; await Store.set("settings", S.settings);
    applyBackground(); $("#bgNote").textContent = "Saved privately.";
  } catch { $("#bgNote").textContent = "Couldn't read that image."; }
});

// ---------- LHV login ----------
async function connectLHV() {
  const tab = window.open("about:blank", "_blank"); // open now, while we still have the click
  try {
    const r = await fn("lhv", "connect", { return_to: location.origin + location.pathname });
    try { localStorage.setItem("mymoney:lhvPending", String(Date.now())); } catch { }
    if (tab && !tab.closed) { tab.location.href = r.url; showLhvPaste(); }
    else location.href = r.url; // popup blocked: go in this tab; the box reopens when you come back
  } catch (e) { if (tab) tab.close(); toast((e && e.message) || "Couldn't start LHV login"); }
}
function showLhvPaste() {
  closeSettings();
  const input = el("input", { placeholder: "http://localhost:53682/lhv-callback?code=…", style: "width:100%" });
  const msg = el("div", { class: "subtle", style: "min-height:18px" });
  const box = el("div", { style: "position:fixed;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(10,8,5,.45)" });
  const done = el("button", { class: "btn primary", onclick: async () => {
    msg.textContent = "Connecting…";
    try { await fn("lhv", "finish", { url: input.value }); try { localStorage.removeItem("mymoney:lhvPending"); } catch { } box.remove(); toast("LHV connected"); loadLHV(true); }
    catch (e) { msg.textContent = (e && e.message) || "That didn't work. Try Connect LHV again."; }
  } }, "Finish connecting");
  box.append(el("div", { class: "glass", style: "width:min(560px,100%);padding:26px;display:flex;flex-direction:column;gap:12px" },
    el("div", { style: "font-size:18px;font-weight:500;color:#fff" }, "Finish connecting LHV"),
    el("ol", { class: "subtle", style: "margin:0;padding-left:18px;line-height:1.6" },
      el("li", {}, "Log in to LHV in the new tab with Smart-ID / Mobile-ID and approve access."),
      el("li", {}, "The tab then shows a page that can't be reached. That's expected."),
      el("li", {}, "Copy the whole address from that tab's address bar and paste it below.")),
    input, msg, el("div", { style: "display:flex;gap:8px;justify-content:flex-end" }, el("button", { class: "btn ghost", onclick: () => box.remove() }, "Cancel"), done)));
  document.body.append(box); input.focus();
}
$("#btnLogout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ---------- login / first-run ----------
async function showAuth() {
  const box = $("#auth"); box.style.display = "flex"; $("#app").style.visibility = "hidden";
  let claimed = true;
  try { claimed = (await fn("account", "state")).claimed; } catch { }
  if (!claimed) { $("#authHint").textContent = "First time here: create your account. You will be the only one who can log in."; $("#authBtn").textContent = "Create account"; $("#authPass").autocomplete = "new-password"; $("#authCodeRow").style.display = "flex"; }
  $("#authForm").onsubmit = async ev => {
    ev.preventDefault(); $("#authMsg").textContent = "";
    const email = $("#authEmail").value.trim(), password = $("#authPass").value;
    try {
      if (!claimed) await fn("account", "create", { email, password, setup_code: $("#authCode").value });
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.reload();
    } catch (e) { $("#authMsg").textContent = (e && e.message) || "Login failed."; }
  };
}

// ---------- boot ----------
async function boot() {
  route();
  applyBackground();
  if (!sb) { document.body.innerHTML = "<p style='padding:40px;color:#fff'>Missing config.js — see README.</p>"; return; }
  const { data } = await sb.auth.getSession();
  SESSION = data.session;
  sb.auth.onAuthStateChange((_e, sess) => { SESSION = sess; });
  if (!SESSION) { showAuth(); return; }
  const qp = new URLSearchParams(location.search);
  if (qp.has("lhv")) {
    const v = qp.get("lhv");
    toast(v === "connected" ? "LHV connected" : v === "declined" ? "LHV login was cancelled" : "LHV login didn't finish, try again");
    history.replaceState(null, "", location.pathname + location.hash);
  }
  const [st, hist] = await Promise.all([Store.get("settings"), Store.get("history")]);
  S.settings = Object.assign(DEFAULT_SETTINGS(), st || {});
  S.history = hist && Array.isArray(hist.points) ? hist : { points: [] };
  try { const b = await Store.get("background"); bgPhoto = b && b.img || null; } catch { }
  applyBackground();
  S.lhv = { status: "idle", server: null, accounts: [], portfolio: null, tx: [], error: null, fetchedAt: null };
  S.ibkr = { status: "idle", positions: [], cash: null, netLiq: null, currency: null, error: null, raw: null, fetchedAt: null };
  S.mcp = LHVAPI;
  renderAll();
  try { const t = +localStorage.getItem("mymoney:lhvPending"); if (t && Date.now() - t < 15 * 60e3) showLhvPaste(); else localStorage.removeItem("mymoney:lhvPending"); } catch { }
  loadLHV(false); loadIBKR(false);
}
boot();
})();
