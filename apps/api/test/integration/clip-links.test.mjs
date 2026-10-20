// Clips proposés par un lien YouTube ou Medal : enregistrés sans fichier (aucun téléchargement), en attente de
// validation comme les fichiers, un même passage d'une même vidéo une seule fois, autres sites refusés ; « Mes clips »
// renvoie le lecteur intégré limité au passage choisi.
/* global URL */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { cleanup, grantVip, newUser, sql } from "./lib.mjs";

const uploaders = [];
after(async () => {
  await sql("DELETE FROM clips WHERE uploader_id = ANY($1::uuid[])", [uploaders]);
  await cleanup();
});

const VIDEO = "dQw4w9WgXcQ";

async function target() {
  const [rank] = await sql(`SELECT r.id, r.game_id FROM ranks r JOIN games g ON g.id = r.game_id WHERE g.is_active ORDER BY g.sort_order, r."order" LIMIT 1`);
  return { gameId: rank.game_id, rankId: rank.id };
}

test("lien YouTube : enregistré sans fichier, en attente de validation, passage début → fin", async () => {
  const u = await newUser("lk");
  uploaders.push(u.id);
  const t = await target();
  const base = { ...t, inGamePseudo: "Joueur#EUW", durationSec: 20, ownsRights: true };

  let r = await u.s.post("/clips", { ...base, link: `https://youtu.be/${VIDEO}?t=1m30s` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, "PENDING");
  assert.equal(r.body.videoKind, "YOUTUBE");
  assert.equal(r.body.linkUrl, `https://www.youtube.com/watch?v=${VIDEO}`);
  const preview = new URL(r.body.previewUrl);
  assert.equal(preview.hostname, "www.youtube-nocookie.com");
  assert.equal(preview.searchParams.get("start"), "90");
  assert.equal(preview.searchParams.get("end"), "110");

  const [clip] = await sql("SELECT status, storage_key, link_provider, link_video_id, link_start_sec, processed_at FROM clips WHERE id = $1::uuid", [r.body.id]);
  assert.equal(clip.status, "PENDING_REVIEW");
  assert.equal(clip.storage_key, `link/youtube/${VIDEO}/90`);
  assert.equal(clip.link_provider, "YOUTUBE");
  assert.equal(clip.link_start_sec, 90);
  assert.ok(clip.processed_at, "aucune compression à faire");

  // Même passage de la même vidéo : refusé ; autre passage (début saisi dans le formulaire) : accepté
  r = await u.s.post("/clips", { ...base, link: `https://www.youtube.com/watch?v=${VIDEO}&t=90` });
  assert.equal(r.status, 409);
  r = await u.s.post("/clips", { ...base, link: `https://www.youtube.com/watch?v=${VIDEO}`, startSec: 200 });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const mine = await u.s.get("/clips/mine");
  assert.equal(mine.status, 200);
  assert.equal(mine.body.filter((c) => c.videoKind === "YOUTUBE").length, 2);
});

test("lien Medal accepté ; autres sites, lien et fichier à la fois, ou rien : refusés", async () => {
  const u = await newUser("lm");
  uploaders.push(u.id);
  const base = { ...(await target()), inGamePseudo: "Joueur#EUW", durationSec: 25, ownsRights: true };

  let r = await u.s.post("/clips", { ...base, link: "https://medal.tv/games/valorant/clips/abc123XYZ/titre" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.videoKind, "MEDAL");
  assert.equal(new URL(r.body.previewUrl).searchParams.get("cta"), "0");

  for (const body of [
    { ...base, link: "https://vimeo.com/123456" },
    { ...base, link: `https://evil.example/youtube.com/watch?v=${VIDEO}` },
    { ...base, link: `https://youtu.be/${VIDEO}`, storageKey: "raw/0f8f5a2c-1b2d-4c3e-9f00-123456789abc.mp4" },
    base,
  ]) {
    r = await u.s.post("/clips", body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test("clips en attente : 25 au plus par joueur, 50 pour un VIP", async () => {
  const t = await target();
  const base = { ...t, inGamePseudo: "Joueur#EUW", durationSec: 20, ownsRights: true };
  const fill = (userId, n) =>
    sql(
      `INSERT INTO clips (id, game_id, rank_id, uploader_id, source, status, storage_key, duration_sec, creator_consent, difficulty, created_at, updated_at)
       SELECT gen_random_uuid(), $1, $2, $3, 'ADMIN', 'PENDING_REVIEW', 'clips/quota-' || gen_random_uuid() || '.mp4', 20, true, 2, now(), now() FROM generate_series(1, $4::int)`,
      [t.gameId, t.rankId, userId, n],
    );
  const link = () => `https://youtu.be/${VIDEO}?t=${Math.floor(Math.random() * 40000)}`;
  for (const [vip, max] of [[false, 25], [true, 50]]) {
    const u = await newUser(vip ? "qv" : "qf");
    uploaders.push(u.id);
    if (vip) await grantVip(u.id);
    await fill(u.id, max - 1);
    let r = await u.s.post("/clips", { ...base, link: link() });
    assert.equal(r.status, 201, `${max}e clip accepté : ${JSON.stringify(r.body)}`);
    r = await u.s.post("/clips", { ...base, link: link() });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, "TOO_MANY_PENDING");
  }
});
