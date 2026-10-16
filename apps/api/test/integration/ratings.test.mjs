// Classement compétitif : seuls les duels « au hasard » terminés comptent, une seule fois, dans la limite par adversaire.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { RATING_START, ratingDelta } from "@ranksight/shared";
import { addClips, cleanup, grantVip, newUser, sql, wait } from "./lib.mjs";
import { services } from "./nest.mjs";

let nest;
let valorant;
before(async () => {
  nest = await services();
  valorant = (await addClips("valorant", 12)).gameId;
});
after(async () => {
  await nest.app.close();
  await cleanup();
});

/** Duel enregistré tel qu'il serait à la fin d'une partie (statut, vainqueur, abandon) */
async function duel(a, b, winner, { game = valorant, random = true, status = "FINISHED", forfeitedBy = null, currentRound = 5 } = {}) {
  const [m] = await sql(
    `INSERT INTO versus_matches (id, creator_id, opponent_id, random, status, rounds, winner_id, game_id, current_round, forfeited_by_id, created_at, accepted_at, finished_at, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::"VersusStatus", 5, $5, $6, $7, $8, now(), now(), now(), now()) RETURNING id`,
    [a.id, b.id, random, status, winner?.id ?? null, game, currentRound, forfeitedBy?.id ?? null],
  );
  return m.id;
}
const row = async (u, scope = "global") => (await sql("SELECT * FROM competitive_ratings WHERE user_id = $1 AND scope = $2", [u.id, scope]))[0];
const changes = async (matchId) => sql("SELECT * FROM rating_changes WHERE match_id = $1 ORDER BY user_id, scope", [matchId]);

test("cote initiale 500 ; victoire et défaite à cote égale (coefficient de placement)", async () => {
  const [a, b] = await Promise.all([newUser("ea"), newUser("eb")]);
  const m = await duel(a, b, a);
  await nest.ratings.recordDuel(m);
  const ra = await row(a);
  const rb = await row(b);
  assert.equal(ra.rating, RATING_START + 16);
  assert.equal(rb.rating, RATING_START - 16);
  assert.equal(ra.games, 1);
  assert.equal(ra.career_games, 1);
  assert.equal((await row(a, "valorant")).rating, RATING_START + 16, "duel sur un jeu : classement du jeu aussi");
  // Rejoué (même duel, plusieurs fois et en même temps) : compté une seule fois
  await Promise.all([nest.ratings.recordDuel(m), nest.ratings.recordDuel(m), nest.ratings.recordDuel(m)]);
  assert.equal((await changes(m)).length, 4, "2 joueurs × 2 périmètres");
  assert.equal((await row(a)).rating, RATING_START + 16);
});

test("battre plus fort rapporte plus ; perdre contre plus faible coûte plus", async () => {
  const [strong, weak, mid1, mid2] = await Promise.all([newUser("es"), newUser("ew"), newUser("em"), newUser("en")]);
  for (const [u, rating] of [[strong, 800], [weak, 400], [mid1, 500], [mid2, 500]]) {
    await sql("INSERT INTO competitive_ratings (user_id, scope, rating, peak, career_games, updated_at) VALUES ($1, 'global', $2, $2, 40, now())", [u.id, rating]);
  }
  const upset = await duel(weak, strong, weak, { game: null });
  await nest.ratings.recordDuel(upset);
  const even = await duel(mid1, mid2, mid1, { game: null });
  await nest.ratings.recordDuel(even);
  const gainUpset = (await row(weak)).rating - 400;
  const lossUpset = (await row(strong)).rating - 800;
  const gainEven = (await row(mid1)).rating - 500;
  assert.equal(gainUpset, ratingDelta(400, 800, "WIN", 40));
  assert.ok(gainUpset > gainEven, "victoire contre mieux classé : plus de points");
  assert.ok(lossUpset < -gainEven, "défaite contre moins bien classé : plus de points perdus");
  assert.equal(await row(weak, "valorant"), undefined, "« Tous les jeux » : classement global seulement");
});

test("coefficient : élevé jusqu'au 20e duel admissible, normal à partir du 21e", async () => {
  const [a, b, c, d] = await Promise.all([newUser("ka"), newUser("kb"), newUser("kc"), newUser("kd")]);
  for (const [u, career] of [[a, 19], [b, 19], [c, 20], [d, 20]]) {
    await sql("INSERT INTO competitive_ratings (user_id, scope, rating, peak, career_games, updated_at) VALUES ($1, 'global', 500, 500, $2, now())", [u.id, career]);
  }
  await nest.ratings.recordDuel(await duel(a, b, a, { game: null }));
  await nest.ratings.recordDuel(await duel(c, d, c, { game: null }));
  assert.equal((await row(a)).rating, 516, "20e duel : coefficient de placement");
  assert.equal((await row(c)).rating, 510, "21e duel : coefficient normal");
  assert.equal((await row(a)).career_games, 20);
});

test("exclusions : duels entre amis, annulés ou non terminés", async () => {
  const [a, b] = await Promise.all([newUser("xa"), newUser("xb")]);
  for (const opts of [{ random: false }, { status: "CANCELED" }, { status: "EXPIRED" }, { status: "ACTIVE" }]) {
    const m = await duel(a, b, a, opts);
    await nest.ratings.recordDuel(m);
    assert.equal((await changes(m)).length, 0, JSON.stringify(opts));
  }
  assert.equal(await row(a), undefined, "aucune cote créée");
});

test("limite : 3 duels comptés par adversaire sur 24 heures, même avec des duels traités en même temps", async () => {
  const [a, b] = await Promise.all([newUser("la"), newUser("lb")]);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await duel(a, b, i % 2 ? b : a, { game: null }));
  await Promise.all(ids.map((id) => nest.ratings.recordDuel(id)));
  const rows = await sql("SELECT counted, reason FROM rating_changes WHERE user_id = $1 AND scope = 'global'", [a.id]);
  assert.equal(rows.length, 5, "les 5 duels restent dans l'historique");
  assert.equal(rows.filter((r) => r.counted).length, 3);
  assert.ok(rows.filter((r) => !r.counted).every((r) => r.reason === "PAIR_LIMIT"));
  assert.equal((await row(a)).games, 3);
  // Fenêtre glissante : les duels de plus de 24 heures ne comptent plus dans la limite
  await sql("UPDATE rating_changes SET created_at = created_at - interval '25 hours' WHERE user_id = ANY($1::uuid[])", [[a.id, b.id]]);
  const next = await duel(a, b, a, { game: null });
  await nest.ratings.recordDuel(next);
  assert.equal((await changes(next)).every((c) => c.counted), true);
});

test("abandon : défaite pour celui qui abandonne ; avant la fin de la 1re manche, le gagnant n'est pas crédité", async () => {
  const [a, b, c, d] = await Promise.all([newUser("fa"), newUser("fb"), newUser("fc"), newUser("fd")]);
  // Vrai duel au hasard, abandon pendant la 1re manche
  let r = await a.s.post("/versus", { opponent: "random", game: "valorant" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await b.s.post("/versus", { opponent: "random", game: "valorant" });
  const match = r.body.id;
  assert.equal(r.body.status, "ACTIVE", "les deux joueurs sont réunis");
  r = await b.s.post(`/versus/${match}/forfeit`);
  assert.ok(r.status < 300, JSON.stringify(r.body));
  for (let i = 0; i < 10 && (await changes(match)).length < 4; i++) await wait(200);
  const early = await changes(match);
  const of = (u) => early.filter((x) => x.user_id === u.id && x.scope === "global")[0];
  assert.equal(of(b).result, "LOSS");
  assert.equal(of(b).counted, true);
  assert.ok(of(b).delta < 0, "abandon : défaite comptée");
  assert.equal(of(a).counted, false, "victoire par abandon immédiat : non créditée");
  assert.equal(of(a).reason, "EARLY_FORFEIT");
  assert.equal((await row(a)).rating, RATING_START);
  // Abandon après au moins une manche jouée : victoire normale
  const later = await duel(c, d, c, { forfeitedBy: d, currentRound: 3, game: null });
  await nest.ratings.recordDuel(later);
  assert.ok((await changes(later)).every((x) => x.counted));
  assert.ok((await row(c)).rating > RATING_START);
});

test("éligibilité au classement public : 5 duels admissibles dans la saison", async () => {
  const [p, o1, o2] = await Promise.all([newUser("pa"), newUser("po"), newUser("pq")]);
  for (const opp of [o1, o1, o2, o2]) await nest.ratings.recordDuel(await duel(p, opp, p, { game: null }));
  const board = async () => (await p.s.get("/ratings/leaderboard?scope=global")).body;
  let b = await board();
  assert.ok(!b.entries.some((e) => e.userId === p.id), "4 duels : pas encore classé");
  assert.equal(b.me.rank, null);
  assert.equal(b.me.provisional, true);
  // Un duel non compté (limite atteinte contre o1) ne compte pas pour l'éligibilité
  await nest.ratings.recordDuel(await duel(p, o1, p, { game: null }));
  await nest.ratings.recordDuel(await duel(p, o1, p, { game: null }));
  b = await board();
  assert.equal(b.me.games, 5, "3 duels comptés contre o1, 2 contre o2");
  assert.ok(b.entries.some((e) => e.userId === p.id), "5 duels comptés : classé");
  assert.equal(typeof b.me.rank, "number");
});

test("VIP : aucun point ni avantage", async () => {
  const [vip, free] = await Promise.all([newUser("va"), newUser("vb")]);
  await grantVip(vip.id);
  await nest.ratings.recordDuel(await duel(vip, free, vip, { game: null }));
  await nest.ratings.recordDuel(await duel(vip, free, free, { game: null }));
  const v = await row(vip);
  const f = await row(free);
  assert.equal(v.rating - RATING_START, -(f.rating - RATING_START), "gains et pertes symétriques");
  const [first] = await sql("SELECT delta FROM rating_changes WHERE user_id = $1 ORDER BY created_at LIMIT 1", [vip.id]);
  assert.equal(first.delta, 16, "même gain qu'un joueur sans VIP");
});
