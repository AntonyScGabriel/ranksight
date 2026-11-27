// Promotion sur les réseaux sociaux (outil Toon Pilot) : routes /v1/promo réservées aux jetons de service ; seuls les clips
// proposés par un joueur, acceptés par la modération, jugés aptes et dont l'auteur a donné son accord sont transmis, avec
// le rang validé ; l'auteur seul donne ou retire son accord ; le retrait bloque tout et ouvre les demandes de suppression
// des vidéos publiées (30 jours) ; jamais de publicité payante ; aucune donnée personnelle ; traçabilité ; secrets protégés.
// L'API testée doit tourner avec PROMO_CONSENT_ENABLED=true (c'est le cas en CI ; la valeur par défaut reste false).
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

/** Clip de test ; « consent » crée aussi l'événement d'accord de l'auteur (comme la route « Mes clips ») */
async function insertClip(uploaderId, { status = "APPROVED", consent = true, review = "APPROVED", source = "COMMUNITY", rankIndex = 0, link = false } = {}) {
  const [c] = await sql(
    `INSERT INTO clips (id, game_id, rank_id, uploader_id, source, status, storage_key, duration_sec, creator_consent, difficulty,
       reviewed_at, promo_consent_at, promo_review_status, link_provider, link_video_id, in_game_pseudo, proof_url, submitter_note, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::"ClipSource", $5::"ClipStatus", $6, 20, true, 2, CASE WHEN $5::text = 'APPROVED' THEN now() END,
       CASE WHEN $7::boolean THEN now() END, $8::"PromoReviewStatus", $9::"ClipLinkProvider", $10, 'PseudoSecret#123', 'https://preuve.invalid',
       'note privée', now(), now()) RETURNING id`,
    [
      game.id, game.ranks[rankIndex].id, uploaderId, source, status,
      link ? `link/youtube/promo${Math.random().toString(36).slice(2, 10)}/0` : `clips/promo-test-${crypto.randomUUID()}.mp4`,
      consent, review, link ? "YOUTUBE" : null, link ? "dQw4w9WgXcQ" : null,
    ],
  );
  if (consent) {
    await sql(
      `INSERT INTO promo_consent_events (id, clip_id, actor_id, action, terms_version, created_at) VALUES (gen_random_uuid(), $1, $2, 'GRANT', 'promo-2026-12', now())`,
      [c.id, uploaderId],
    );
  }
  clips.push(c.id);
  return c.id;
}

async function exportedIds() {
  const ids = [];
  let cursor = null;
  do {
    const r = await promo(`/promo/clips?limit=100${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.push(...r.body.items.map((c) => c.id));
    cursor = r.body.nextCursor;
  } while (cursor);
  return ids;
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
  await sql("DELETE FROM promo_removal_requests WHERE clip_id = ANY($1::uuid[])", [clips]);
  await sql("DELETE FROM promo_publications WHERE clip_id = ANY($1::uuid[])", [clips]);
  await sql("DELETE FROM promo_uses WHERE token_id = $1", [tokenId]);
  await sql("DELETE FROM promo_access_logs WHERE token_id = $1", [tokenId]);
  await sql("DELETE FROM promo_consent_events WHERE clip_id = ANY($1::uuid[])", [clips]);
  await sql("DELETE FROM service_tokens WHERE id = $1", [tokenId]);
  await sql("DELETE FROM clips WHERE id = ANY($1::uuid[])", [clips]);
  await cleanup();
});

test("accès : jeton de service obligatoire, jetons de compte et faux jetons refusés, hash seul en base", async () => {
  assert.equal((await promo("/promo/games", { auth: null })).status, 401);
  assert.equal((await promo("/promo/games", { auth: "rsk_faux" })).status, 401);
  assert.equal((await promo("/promo/games", { auth: owner.s.token() })).status, 401, "un jeton de compte, même fondateur, n'ouvre pas /promo");
  const ok = await promo("/promo/games");
  assert.equal(ok.status, 200);
  assert.ok(ok.body.items.some((g) => g.slug === game.slug && g.ranks.length === game.ranks.length));
  const [row] = await sql("SELECT token_hash FROM service_tokens WHERE id = $1", [tokenId]);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash.length, 64);
  const other = await fetch(`${API}/admin/clips`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(other.status, 401, "le jeton de service n'ouvre aucune autre route");
  const mod = await newUser("md");
  users.push(mod.id);
  await sql("UPDATE users SET role = 'MODERATOR' WHERE id = $1", [mod.id]);
  assert.equal((await mod.s.get("/admin/service-tokens")).status, 403);
});

test("export : accord absent, clip refusé, clip non vérifié, clip ajouté par la modération ou lien → jamais transmis", async () => {
  const u = await newUser("pc");
  users.push(u.id);
  const ok = await insertClip(u.id, { rankIndex: 1 });
  const noConsent = await insertClip(u.id, { consent: false });
  const rejected = await insertClip(u.id, { status: "REJECTED" });
  const notReviewed = await insertClip(u.id, { review: "PENDING" });
  const reviewRefused = await insertClip(u.id, { review: "REJECTED" });
  // Clip ajouté par la modération, même avec un accord écrit en base : jamais utilisable
  const staff = await insertClip(owner.id, { source: "ADMIN" });
  const linkClip = await insertClip(u.id, { link: true });
  await sql("UPDATE clips SET rank_id = $1 WHERE id = $2", [game.ranks[2].id, ok]);

  const ids = await exportedIds();
  assert.ok(ids.includes(ok));
  for (const refused of [noConsent, rejected, notReviewed, reviewRefused, staff, linkClip]) {
    assert.ok(!ids.includes(refused), refused);
    assert.equal((await promo(`/promo/clips/${refused}`)).status, 404);
    assert.equal((await promo(`/promo/clips/${refused}/uses`, { method: "POST", body: { reference: "x" } })).status, 404);
  }
  const detail = await promo(`/promo/clips/${ok}`);
  assert.deepEqual(Object.keys(detail.body).sort(), ["approvedAt", "audio", "consent", "durationSec", "game", "id", "rank", "updatedAt", "usage", "video"]);
  assert.deepEqual(detail.body.rank, { id: game.ranks[2].id, name: game.ranks[2].name, order: game.ranks[2].order }, "rang validé par la modération");
  assert.equal(detail.body.consent.version, "promo-2026-12");
  assert.deepEqual(detail.body.usage, { organic: true, paidAds: false, platforms: ["TIKTOK", "YOUTUBE_SHORTS", "INSTAGRAM_REELS"] });
  const text = JSON.stringify(detail.body);
  for (const secret of ["PseudoSecret", "preuve", "note privée", u.pseudo, u.id]) assert.ok(!text.includes(secret), `donnée personnelle transmise : ${secret}`);
  const status = await promo("/promo/clips/status", { method: "POST", body: { ids: [ok, noConsent, notReviewed] } });
  assert.deepEqual(status.body.items.map((i) => i.available), [true, false, false]);
  assert.equal(status.body.items[1].reason, "accord de promotion absent ou retiré");
});

test("l'auteur seul donne son accord ; la modération ne peut jamais consentir, seulement vérifier l'aptitude", async () => {
  const u = await newUser("pa");
  users.push(u.id);
  const id = await insertClip(u.id, { consent: false, review: "PENDING" });
  const stranger = await newUser("ps");
  users.push(stranger.id);
  assert.equal((await stranger.s.post(`/clips/mine/${id}/promo-consent`, { consent: true })).status, 404);
  assert.equal((await owner.s.post(`/admin/clips/${id}/promo-consent`, { consent: true })).status, 404, "route de consentement par la modération supprimée");
  const staffClip = await insertClip(owner.id, { consent: false, source: "ADMIN" });
  assert.equal((await owner.s.post(`/clips/mine/${staffClip}/promo-consent`, { consent: true })).status, 403, "clip ajouté par l'équipe");
  assert.equal((await owner.s.post(`/admin/clips/${staffClip}/promo-review`, { decision: "APPROVED" })).status, 400);
  const linkClip = await insertClip(u.id, { link: true, consent: false });
  assert.equal((await u.s.post(`/clips/mine/${linkClip}/promo-consent`, { consent: true })).status, 400);

  assert.equal((await u.s.post(`/clips/mine/${id}/promo-consent`, { consent: true })).body.promoConsent, true);
  assert.equal((await promo(`/promo/clips/${id}`)).status, 404, "pas encore vérifié par la modération");
  const reviewed = await owner.s.post(`/admin/clips/${id}/promo-review`, { decision: "APPROVED", muteAudio: true, note: "voix coupée" });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.exportable, true);
  const detail = await promo(`/promo/clips/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.audio, false, "son coupé à la demande de la modération");
  const [event] = await sql("SELECT action, actor_id, terms_version FROM promo_consent_events WHERE clip_id = $1", [id]);
  assert.deepEqual([event.action, event.actor_id, event.terms_version], ["GRANT", u.id, "promo-2026-12"]);
  const mine = await u.s.get("/clips/mine");
  assert.deepEqual(
    (({ promoConsent, promoReview }) => ({ promoConsent, promoReview }))(mine.body.find((c) => c.id === id)),
    { promoConsent: true, promoReview: "APPROVED" },
  );
});

test("retrait : export et nouvelle utilisation bloqués, vidéo non publiée abandonnée, vidéo publiée à retirer sous 30 jours, autres clips intacts", async () => {
  const u = await newUser("pr");
  users.push(u.id);
  const id = await insertClip(u.id);
  const other = await insertClip(u.id, { rankIndex: 1 });
  const published = await promo(`/promo/clips/${id}/uses`, { method: "POST", body: { reference: "toonpilot:video-1" } });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.consentVersion, "promo-2026-12");
  const unpublished = await promo(`/promo/clips/${id}/uses`, { method: "POST", body: { reference: "toonpilot:video-2" } });
  // Publicité payante et réseau non couvert : refusés
  assert.equal((await promo(`/promo/uses/${published.body.id}/publications`, { method: "POST", body: { platform: "TIKTOK", url: "https://www.tiktok.com/@ranksight/video/1", publishedAt: new Date().toISOString(), paid: true } })).status, 400);
  assert.equal((await promo(`/promo/uses/${published.body.id}/publications`, { method: "POST", body: { platform: "FACEBOOK", url: "https://facebook.com/x", publishedAt: new Date().toISOString() } })).status, 400);
  const pub = await promo(`/promo/uses/${published.body.id}/publications`, { method: "POST", body: { platform: "TIKTOK", url: "https://www.tiktok.com/@ranksight/video/1", publishedAt: new Date().toISOString() } });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  assert.equal(pub.body.removalRequired, false);

  const r = await u.s.post(`/clips/mine/${id}/promo-consent`, { consent: false });
  assert.deepEqual(r.body, { promoConsent: false, removalRequests: 1 });
  assert.equal((await promo(`/promo/clips/${id}`)).status, 404);
  assert.equal((await promo(`/promo/clips/${id}/uses`, { method: "POST", body: { reference: "toonpilot:video-3" } })).status, 404);
  assert.ok(!(await exportedIds()).includes(id));
  assert.equal((await promo(`/promo/clips/${other}`)).status, 200, "un autre clip autorisé reste utilisable");

  // Vidéo non publiée : abandonnée par l'outil (fichier supprimé), et ne peut plus être déclarée publiée
  assert.equal((await promo(`/promo/uses/${unpublished.body.id}/discard`, { method: "POST" })).status, 200);
  assert.equal((await promo(`/promo/uses/${unpublished.body.id}/publications`, { method: "POST", body: { platform: "TIKTOK", url: "https://www.tiktok.com/@ranksight/video/2", publishedAt: new Date().toISOString() } })).status, 409);
  assert.equal((await promo(`/promo/uses/${published.body.id}/discard`, { method: "POST" })).status, 409, "une vidéo publiée n'est pas « abandonnée »");

  // Vidéo publiée : une demande de suppression à traiter sous 30 jours, visible par l'outil et par la modération
  const removals = await promo("/promo/removals");
  const removal = removals.body.items.find((x) => x.clipId === id);
  assert.ok(removal);
  assert.equal(removal.platform, "TIKTOK");
  assert.equal(removal.reference, "toonpilot:video-1");
  const days = (new Date(removal.dueAt) - new Date(removal.requestedAt)) / 86_400_000;
  assert.ok(Math.abs(days - 30) < 0.01);
  assert.ok(!removals.body.items.some((x) => x.clipId === other));
  const staffList = await owner.s.get("/admin/promo/removals");
  assert.ok(staffList.body.some((x) => x.id === removal.id));
  assert.equal((await promo(`/promo/removals/${removal.id}/done`, { method: "POST", body: { note: "supprimée" } })).body.status, "DONE");
  assert.ok(!(await promo("/promo/removals")).body.items.some((x) => x.id === removal.id));
  const history = await owner.s.get(`/admin/clips/${id}/promo`);
  const use = history.body.uses.find((x) => x.reference === "toonpilot:video-1");
  assert.equal(use.consentVersion, "promo-2026-12");
  assert.equal(use.publications[0].removal.status, "DONE");
  assert.ok(history.body.uses.find((x) => x.reference === "toonpilot:video-2").discardedAt);

  // Une publication déclarée après le retrait ouvre aussitôt une demande de suppression
  const late = await promo(`/promo/uses/${published.body.id}/publications`, { method: "POST", body: { platform: "YOUTUBE_SHORTS", url: "https://youtube.com/shorts/x", publishedAt: new Date().toISOString() } });
  assert.equal(late.status, 201);
  assert.equal(late.body.removalRequired, true);
});

test("clip refusé ou supprimé après l'accord : fin de l'accord, preuve conservée", async () => {
  const u = await newUser("pd");
  users.push(u.id);
  const rejected = await insertClip(u.id);
  const deleted = await insertClip(u.id);
  const use = await promo(`/promo/clips/${rejected}/uses`, { method: "POST", body: { reference: "toonpilot:video-r" } });
  await promo(`/promo/uses/${use.body.id}/publications`, { method: "POST", body: { platform: "INSTAGRAM_REELS", url: "https://www.instagram.com/reel/x", publishedAt: new Date().toISOString() } });
  const r = await owner.s.post(`/admin/clips/${rejected}/review`, { decision: "REJECT", reason: "Rang visible dans la vidéo" });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  const [ev] = await sql("SELECT action, reason FROM promo_consent_events WHERE clip_id = $1 AND action = 'WITHDRAW'", [rejected]);
  assert.equal(ev.reason, "clip refusé par la modération");
  assert.equal((await sql("SELECT count(*)::int AS n FROM promo_removal_requests WHERE clip_id = $1 AND status = 'OPEN'", [rejected]))[0].n, 1);

  assert.equal((await u.s.del(`/clips/mine/${deleted}`)).status, 204);
  const events = await sql("SELECT action, reason FROM promo_consent_events WHERE clip_id = $1 ORDER BY created_at", [deleted]);
  assert.deepEqual(events.map((e) => [e.action, e.reason]), [["GRANT", null], ["WITHDRAW", "clip supprimé"]], "la preuve reste après la suppression du clip");
});

test("traçabilité, secrets jamais exposés, puis révocation immédiate du jeton", async () => {
  const logs = await sql("SELECT action FROM promo_access_logs WHERE token_id = $1", [tokenId]);
  for (const action of ["games", "clips", "clip", "status", "use", "publication", "discard", "removals", "removal_done"]) {
    assert.ok(logs.some((l) => l.action === action), action);
  }
  const list = await owner.s.get("/admin/service-tokens");
  const row = list.body.find((t) => t.id === tokenId);
  assert.ok(row && !("tokenHash" in row) && row.lastUsedAt);
  assert.ok(!JSON.stringify(list.body).includes(token));
  const refused = await promo("/promo/games", { auth: `${token}x` });
  assert.equal(refused.status, 401);
  assert.ok(!JSON.stringify(refused.body).includes(token));
  const leaks = await sql(
    `SELECT (SELECT count(*) FROM audit_logs WHERE metadata::text LIKE '%' || $1 || '%' OR after::text LIKE '%' || $1 || '%' OR before::text LIKE '%' || $1 || '%')
          + (SELECT count(*) FROM service_tokens WHERE token_hash = $1 OR prefix = $1) AS n`,
    [token],
  );
  assert.equal(Number(leaks[0].n), 0);
  assert.equal((await owner.s.post(`/admin/service-tokens/${tokenId}/revoke`)).status, 200);
  assert.equal((await promo("/promo/games")).status, 401);
  assert.equal((await promo("/promo/clips")).status, 401);
  assert.equal((await promo("/promo/removals")).status, 401);
});

test("envoi d'un clip : l'accord est facultatif, décoché par défaut, et le clip reste à vérifier", async () => {
  const terms = await fetch(`${API}/clips/promo-terms`).then((r) => r.json());
  assert.equal(terms.enabled, true);
  assert.equal(terms.paidAds, false);
  assert.deepEqual(terms.platforms, ["TIKTOK", "YOUTUBE_SHORTS", "INSTAGRAM_REELS"]);
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
  assert.equal(withConsent.body.promoReview, "PENDING");
  clips.push(without.body.id, withConsent.body.id);
  const events = await sql("SELECT action FROM promo_consent_events WHERE clip_id = ANY($1::uuid[])", [[without.body.id, withConsent.body.id]]);
  assert.deepEqual(events.map((e) => e.action), ["GRANT"]);
});
