// First-run setup: the first account created becomes the site's only owner.
// Creating it requires a one-time setup code (stored hashed in app_config, deleted after use),
// so nobody else can claim a freshly deployed site. Fails closed on any error.
import { admin, cors, fail, json, sha256b64url } from "../_shared/util.ts";

async function claimed(): Promise<boolean> {
  const { count, error } = await admin.from("owner").select("id", { count: "exact", head: true });
  if (error) throw new Error("Database not ready: " + error.message);
  return (count || 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const route = new URL(req.url).pathname.split("/").pop();
  try {
    if (route === "state") return json({ claimed: await claimed() });
    if (route === "create" && req.method === "POST") {
      if (await claimed()) return fail("already_set_up", "This site already has an owner. Log in instead.", 403);
      const { email, password, setup_code } = await req.json().catch(() => ({}));
      const { data: row, error: e1 } = await admin.from("app_config").select("data").eq("key", "setup_code_hash").maybeSingle();
      if (e1) throw e1;
      if (!row) return fail("no_setup_code", "No setup code is configured for this site (see README).", 403);
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing
      if (!setup_code || (await sha256b64url(String(setup_code).trim())) !== row.data) return fail("bad_setup_code", "Wrong setup code.", 403);
      if (!/^\S+@\S+\.\S+$/.test(String(email || ""))) return fail("bad_request", "Enter a valid email.");
      if (String(password || "").length < 10) return fail("bad_request", "Use a password of at least 10 characters.");
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) return fail("create_failed", error?.message || "Could not create the account.");
      const ins = await admin.from("owner").insert({ id: data.user.id });
      if (ins.error) { await admin.auth.admin.deleteUser(data.user.id); return fail("already_set_up", "This site already has an owner.", 403); }
      await admin.from("app_config").delete().eq("key", "setup_code_hash");
      return json({ ok: true });
    }
    return fail("not_found", "Unknown route.", 404);
  } catch (e) {
    return fail("server_error", String((e as Error).message).slice(0, 300), 500);
  }
});
