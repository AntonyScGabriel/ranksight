// Jetons virtuels et mode Confiance supprimés : plus de routes, plus de solde ; le VIP et la boutique fonctionnent toujours.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { cleanup, grantVip, newUser, sql } from "./lib.mjs";

after(cleanup);

test("routes et données des jetons retirées", async () => {
  const u = await newUser("tok");
  assert.equal((await u.s.get("/tokens")).status, 404);
  assert.equal((await u.s.post("/tokens/refill")).status, 404);
  const me = (await u.s.get("/users/me")).body;
  assert.ok(!("tokenBalance" in me) && !("tokens" in me));
  const cols = await sql("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'token_balance'");
  assert.equal(cols.length, 0);
  const tables = await sql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('token_transactions', 'room_stakes')");
  assert.equal(tables.length, 0, "tables retirées de l'application (archivées hors du schéma public)");
  const trigger = await sql("SELECT 1 FROM pg_trigger WHERE tgname = 'token_welcome'");
  assert.equal(trigger.length, 0, "plus de solde de départ pour les nouveaux comptes");
  const archived = await sql("SELECT count(*)::int AS n FROM archive.token_transactions WHERE user_id = $1", [u.id]);
  assert.equal(archived[0].n, 0, "aucun mouvement pour un compte créé après la suppression");
});

test("VIP, boutique, succès et récompenses toujours en place", async () => {
  const u = await newUser("shp");
  let r = await u.s.get("/shop/catalog");
  assert.equal(r.status, 200);
  r = await u.s.get("/shop");
  assert.equal(r.status, 200);
  assert.equal(r.body.vip.active, false);
  r = await u.s.get("/shop/purchases");
  assert.equal(r.status, 200);
  assert.equal((await u.s.get("/achievements/me")).status, 200);
  await grantVip(u.id);
  r = await u.s.get("/shop");
  assert.equal(r.body.vip.active, true, "abonnement VIP reconnu");
  r = await u.s.get("/rooms");
  assert.equal(r.body.canHostPrivate, true, "le VIP permet toujours de créer un salon privé");
  r = await u.s.post("/rooms", { game: "valorant", visibility: "PRIVATE" });
  assert.ok(r.status === 201 || r.body.code === "NOT_ENOUGH_CLIPS", JSON.stringify(r.body));
});
