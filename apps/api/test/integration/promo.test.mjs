// Promotion sur les réseaux sociaux (outil Toon Pilot) : routes /v1/promo réservées aux jetons de service, seuls les clips
// acceptés par la modération et dont l'auteur a donné son accord sont transmis, avec le rang validé ; retrait de l'accord,
// révocation du jeton, aucune donnée personnelle, traçabilité des accords, synchronisations et utilisations.
// L'API testée doit tourner avec PROMO_CONSENT_ENABLED=true.
/* global fetch, crypto, URL */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { API, cleanup, newUser, sql } from "./lib.mjs";

const clips = [];
const users = [];
let owner;
let token;
let tokenId;
let game;

const promo = async (path, { method = "GET", body, auth = token } = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "X-Forwarded-For": "10.99.0.1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};

async function insertClip(uploaderId, { status = "APPROVED", consent = true, source = "COMMUNITY", rankIndex = 0, link = false } = {}) {
  const [c] = await sql(
    `INSERT INTO clips (id, game_id, rank_id, uploader_id, source, status, storage_key, duration_sec, creator_consent, difficulty,
       reviewed_at, promo_consent_at, link_provider, link_video_id, in_game_pseudo, proof_url, submitter_note, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::"ClipSource", $5::"ClipStatus", $6, 20, true, 2, CASE WHEN $5::text = 'APPROVED' THEN now() END,
       CASE WHEN $7::boolean THEN now() END, $8::"ClipLinkProvider", $9, 'PseudoSecret#123', 'https://preuve.invalid', 'note privée', now(), now()) RETURNING id`,
    [
      game.id, game.ranks[rankIndex].id, uploaderId, source, status,
      link ? `link/youtube/promo${Math.random().toString(36).slice(2, 10)}/0` : `clips/promo-test-${crypto.randomUUID()}.mp4`,
      consent, link ? "YOUTUBE" : null, link ? "dQw4w9WgXcQ" : null,
    ],
  );
  clips.push(c.id);
  return c.id;
}

before(async () => {
  const [g] = await sql("SELECT id, slug, name FROM games WHERE is_active ORDER BY sort_order LIMIT 1");
  const ranks = await sql(`SELECT id, name, "order" FROM ranks WHERE game_id = $1 ORDER BY "order"`, [g.id]);
  game = { ...g, ranks };
  owner = await newUser("ow");
  users.push(owner.id);
  await sql("UPDATE users SET role = 'OWNER' WHERE id = $1", [owner.id]);
  const created = await owner.s.post("/admin/service-tokens", { name: "Toon Pilot (test)" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.token, /^rsk_/);
  assert.deepEqual(created.body.scopes, ["promo:read"]);
  token = created.body.token;
  tokenId = created.body.id;
});

after(async () => {
  await sql("UPDATE users SET role = 'USER' WHERE id = ANY($1::uuid[])", [users]);
  await sql("DELETE FROM promo_uses WHERE token_id = $1", [tokenId]);
  await sql("DELETE FROM promo_access_logs WHERE token_id = $1", [tokenId]);
  await sql("DELETE FROM service_tokens WHERE id = $1", [tokenId]);
  await sql("DELETE FROM clips WHERE id = ANY($1::uuid[])", [clips]);
  await cleanup();
});

test("accès : jeton de service obligatoire, jetons de joueur et faux jetons refusés, hash seul en base", async () => {
  assert.equal((await promo("/promo/games", { auth: null })).status, 401);
  assert.equal((await promo("/promo/games", { auth: "rsk_faux" })).status, 401);
  assert.equal((await promo("/promo/games", { auth: owner.s.token() })).status, 401, "un jeton de compte, même fondateur, n'ouvre pas /promo");
  const ok = await promo("/promo/games");
  assert.equal(ok.status, 200);
  assert.ok(ok.body.items.some((g) => g.slug === game.slug && g.ranks.length === game.ranks.length));
  const [row] = await sql("SELECT token_hash, prefix FROM service_tokens WHERE id = $1", [tokenId]);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash.length, 64);
  // Le jeton de service n'ouvre aucune autre route
  const other = await fetch(`${API}/admin/clips`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(other.status, 401);
  // Un modérateur ne gère pas les jetons
  const mod = await newUser("md");
  users.push(mod.id);
  await sql("UPDATE users SET role = 'MODERATOR' WHERE id = $1", [mod.id]);
  assert.equal((await mod.s.get("/admin/service-tokens")).status, 403);
});

test("seuls les clips acceptés avec accord sont exportés, avec le rang validé et sans donnée personnelle", async () => {
  const u = await newUser("pc");
  users.push(u.id);
  const ok = await insertClip(u.id, { rankIndex: 1 });
  const noConsent = await insertClip(u.id, { consent: false });
  const pending = await insertClip(u.id, { status: "PENDING_REVIEW" });
  const linkClip = await insertClip(u.id, { link: true });
  // Rang corrigé par la modération après l'envoi : c'est lui qui est exporté
  await sql("UPDATE clips SET rank_id = $1 WHERE id = $2", [game.ranks[2].id, ok]);

  const ids = [];
  let cursor = null;
  do {
    const r = await promo(`/promo/clips?limit=100${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.push(...r.body.items.map((c) => c.id));
    const mine = r.body.items.find((c) => c.id === ok);
    if (mine) {
      assert.deepEqual(Object.keys(mine).sort(), ["approvedAt", "durationSec", "game", "id", "rank", "updatedAt", "video"]);
      assert.deepEqual(mine.rank, { id: game.ranks[2].id, name: game.ranks[2].name, order: game.ranks[2].order });
      assert.deepEqual(mine.game, { slug: game.slug, name: game.name });
      assert.equal(mine.video.contentType, "video/mp4");
      assert.ok(!JSON.stringify(mine).includes("PseudoSecret") && !JSON.stringify(mine).includes("preuve") && !JSON.stringify(mine).includes(u.pseudo));
    }
    cursor = r.body.nextCursor;
  } while (cursor);
  assert.ok(ids.includes(ok));
  for (const refused of [noConsent, pending, linkClip]) assert.ok(!ids.includes(refused));
  assert.equal((await promo(`/promo/clips/${noConsent}`)).status, 404);
  assert.equal((await promo(`/promo/clips/${pending}`)).status, 404);
  const status = await promo("/promo/clips/status", { method: "POST", body: { ids: [ok, noConsent, pending] } });
  assert.deepEqual(status.body.items.map((i) => i.available), [true, false, false]);
  assert.equal(status.body.items[1].reason, "accord de promotion absent ou retiré");
});

test("le joueur donne et retire son accord ; le retrait bloque export, vérification et nouvelle utilisation", async () => {
  const u = await newUser("pr");
  users.push(u.id);
  const id = await insertClip(u.id, { consent: false });

  // Un autre joueur ne peut pas décider à sa place ; un lien ne peut pas être promu
  const stranger = await newUser("ps");
  users.push(stranger.id);
  assert.equal((await stranger.s.post(`/clips/mine/${id}/promo-consent`, { consent: true })).status, 404);
  const linkClip = await insertClip(u.id, { link: true, consent: false });
  assert.equal((await u.s.post(`/clips/mine/${linkClip}/promo-consent`, { consent: true })).status, 400);

  let r = await u.s.post(`/clips/mine/${id}/promo-consent`, { consent: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.promoConsent, true);
  const mine = await u.s.get("/clips/mine");
  assert.equal(mine.body.find((c) => c.id === id).promoConsent, true);
  assert.equal((await promo(`/promo/clips/${id}`)).status, 200);
  const use = await promo(`/promo/clips/${id}/uses`, { method: "POST", body: { reference: "video-test-1" } });
  assert.equal(use.status, 201, JSON.stringify(use.body));
  assert.equal(use.body.rankId, game.ranks[0].id);

  r = await u.s.post(`/clips/mine/${id}/promo-consent`, { consent: false });
  assert.equal(r.body.promoConsent, false);
  assert.equal((await promo(`/promo/clips/${id}`)).status, 404);
  assert.equal((await promo(`/promo/clips/${id}/uses`, { method: "POST", body: { reference: "video-test-2" } })).status, 404);
  const status = await promo("/promo/clips/status", { method: "POST", body: { ids: [id] } });
  assert.equal(status.body.items[0].available, false);

  const events = await sql("SELECT action, actor_id, terms_version FROM promo_consent_events WHERE clip_id = $1 ORDER BY created_at", [id]);
  assert.deepEqual(events.map((e) => e.action), ["GRANT", "WITHDRAW"]);
  assert.ok(events.every((e) => e.actor_id === u.id && e.terms_version === "promo-2026-12"));
  const uses = await sql("SELECT reference FROM promo_uses WHERE clip_id = $1", [id]);
  assert.deepEqual(uses.map((x) => x.reference), ["video-test-1"]);
});

test("modération : accord possible seulement pour un clip qu'elle a ajouté ; historique consultable", async () => {
  const u = await newUser("pm");
  users.push(u.id);
  const community = await insertClip(u.id, { consent: false });
  const staff = await insertClip(owner.id, { consent: false, source: "ADMIN" });
  assert.equal((await owner.s.post(`/admin/clips/${community}/promo-consent`, { consent: true })).status, 403);
  assert.equal((await owner.s.post(`/admin/clips/${staff}/promo-consent`, { consent: true })).status, 200);
  assert.equal((await promo(`/promo/clips/${staff}`)).status, 200);
  const history = await owner.s.get(`/admin/clips/${staff}/promo`);
  assert.equal(history.status, 200);
  assert.equal(history.body.consentEvents[0].action, "GRANT");
});

test("traçabilité des synchronisations, puis révocation immédiate du jeton", async () => {
  const logs = await sql("SELECT action, array_length(clip_ids, 1) AS n FROM promo_access_logs WHERE token_id = $1", [tokenId]);
  for (const action of ["games", "clips", "clip", "status", "use"]) assert.ok(logs.some((l) => l.action === action), action);
  const list = await owner.s.get("/admin/service-tokens");
  const row = list.body.find((t) => t.id === tokenId);
  assert.ok(row && !("tokenHash" in row) && row.lastUsedAt);
  // Le secret du jeton n'apparaît jamais : ni dans la liste, ni dans une erreur, ni dans les journaux en base
  assert.ok(!JSON.stringify(list.body).includes(token));
  const refused = await promo("/promo/games", { auth: `${token}x` });
  assert.equal(refused.status, 401);
  assert.ok(!JSON.stringify(refused.body).includes(token));
  const leaks = await sql(
    `SELECT (SELECT count(*) FROM audit_logs WHERE metadata::text LIKE '%' || $1 || '%' OR after::text LIKE '%' || $1 || '%')
          + (SELECT count(*) FROM service_tokens WHERE token_hash = $1 OR prefix = $1) AS n`,
    [token],
  );
  assert.equal(Number(leaks[0].n), 0);
  const revoked = await owner.s.post(`/admin/service-tokens/${tokenId}/revoke`);
  assert.equal(revoked.status, 200);
  assert.equal((await promo("/promo/games")).status, 401);
  assert.equal((await promo("/promo/clips")).status, 401);
});

test("envoi d'un clip : l'accord est facultatif et décoché par défaut", async () => {
  const terms = await fetch(`${API}/clips/promo-terms`).then((r) => r.json());
  assert.equal(terms.enabled, true);
  const u = await newUser("pe");
  users.push(u.id);
  const upload = async () => {
    const r = await u.s.post("/clips/upload-url", { contentType: "video/mp4", sizeBytes: 16 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const put = await fetch(new URL(r.body.url, API), { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array(16) });
    assert.equal(put.status, 200);
    return r.body.key;
  };
  const base = { gameId: game.id, rankId: game.ranks[0].id, inGamePseudo: "Joueur#EUW", durationSec: 20, ownsRights: true };
  const without = await u.s.post("/clips", { ...base, storageKey: await upload() });
  assert.equal(without.status, 201, JSON.stringify(without.body));
  assert.equal(without.body.promoConsent, false);
  const withConsent = await u.s.post("/clips", { ...base, storageKey: await upload(), promoConsent: true });
  assert.equal(withConsent.body.promoConsent, true);
  clips.push(without.body.id, withConsent.body.id);
  // En attente de validation : rien n'est exporté tant que la modération n'a pas accepté (et vérifié le rang)
  const events = await sql("SELECT action FROM promo_consent_events WHERE clip_id = ANY($1::uuid[])", [[without.body.id, withConsent.body.id]]);
  assert.deepEqual(events.map((e) => e.action), ["GRANT"]);
});
