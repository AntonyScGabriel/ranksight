// Modèle gratuit / VIP hors salons (voir rooms-rules.test.mjs) : Plus haut / Plus bas et organisation de tournois réservés
// aux VIP, participation gratuite. Tout est vérifié par l'API, requêtes directes comprises.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addClips, cleanup, grantVip, newUser, sql } from "./lib.mjs";

const GAME = "valorant";
before(async () => {
  await addClips(GAME, 30);
});
after(cleanup);

const expireVip = (userId) =>
  sql("UPDATE subscriptions SET status = 'EXPIRED', current_period_end = (now() at time zone 'utc') - interval '1 day' WHERE user_id = $1::uuid", [userId]);
async function vipUser(prefix) {
  const u = await newUser(prefix);
  await grantVip(u.id);
  return u;
}

test("6-8. Plus haut / Plus bas : VIP pour lancer ; une série lancée se termine même si le VIP prend fin", async () => {
  const [free, vip] = await Promise.all([newUser("h1"), vipUser("h2")]);
  let r = await free.s.get("/higher-lower");
  assert.equal(r.status, 200);
  assert.equal(r.body.vip, false);
  assert.ok(!("freeRunsLeft" in r.body));
  r = await free.s.post("/higher-lower/runs", { game: GAME });
  assert.equal(r.status, 402, "gratuit : lancement refusé");
  r = await vip.s.post("/higher-lower/runs", { game: GAME });
  assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.body));
  const run = r.body;
  // VIP expiré pendant la série : le joueur peut la terminer…
  await expireVip(vip.id);
  assert.equal((await vip.s.get("/higher-lower")).body.vip, false);
  let current = run;
  for (let i = 0; i < 40 && current.status === "ACTIVE"; i++) {
    r = await vip.s.post(`/higher-lower/runs/${current.id}/answer`, { round: current.round, choice: "higher" });
    assert.equal(r.status, 200, `réponse ${i + 1} après la fin du VIP : ${JSON.stringify(r.body)}`);
    current = r.body.run;
  }
  assert.equal(current.status, "ENDED", "série terminée");
  // …mais ne peut pas en lancer une nouvelle (ni par une requête directe)
  r = await vip.s.post("/higher-lower/runs", { game: GAME });
  assert.equal(r.status, 402, "VIP expiré : nouvelle série refusée");
  assert.equal(r.body.code, "PREMIUM_REQUIRED");
  // Un joueur gratuit ne peut pas répondre à la série d'un autre
  assert.equal((await free.s.post(`/higher-lower/runs/${run.id}/answer`, { round: 1, choice: "higher" })).status, 404);
});

test("9-10. tournois : organisation VIP, inscription gratuite sur invitation", async () => {
  const [free, vip, p2, p3] = await Promise.all([newUser("t1"), vipUser("t2"), newUser("t3"), newUser("t4")]);
  let r = await free.s.post("/tournaments", { game: GAME, capacity: 8, rounds: 3 });
  assert.equal(r.status, 402, "gratuit : création refusée");
  r = await vip.s.post("/tournaments", { game: GAME, capacity: 8, rounds: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = r.body;
  for (const u of [free, p2, p3]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200, "inscription gratuite avec le code");
  assert.equal((await free.s.post(`/tournaments/${t.id}/start`)).status, 403, "seul l'organisateur lance");
  await expireVip(vip.id);
  assert.equal((await vip.s.post(`/tournaments/${t.id}/start`)).status, 402, "organisateur sans VIP : lancement refusé");
  await grantVip(vip.id);
  r = await vip.s.post(`/tournaments/${t.id}/start`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Le match de tournoi d'un joueur gratuit n'est pas bloqué par la mort subite de départage
  const [m] = await sql("SELECT r.sudden_death FROM tournament_matches tm JOIN rooms r ON r.id = tm.room_id WHERE tm.tournament_id = $1 LIMIT 1", [t.id]);
  if (m) assert.equal(m.sudden_death, true);
  // Une fois lancé, le tournoi continue même si le VIP de l'organisateur prend fin
  await expireVip(vip.id);
  r = await vip.s.get(`/tournaments/${t.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ACTIVE", "tournoi toujours en cours");
  const [room] = await sql("SELECT r.id FROM tournament_matches tm JOIN rooms r ON r.id = tm.room_id WHERE tm.tournament_id = $1 AND (tm.player1_id = $2::uuid OR tm.player2_id = $2::uuid) LIMIT 1", [t.id, free.id]);
  if (room) assert.equal((await free.s.get(`/rooms/${room.id}`)).status, 200, "match d'un joueur gratuit accessible");
});

test("tournoi : départ et annulation sans VIP selon les règles existantes", async () => {
  const [host, p1] = await Promise.all([vipUser("tc1"), newUser("tc2")]);
  let r = await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = r.body;
  assert.equal((await p1.s.post("/tournaments/join", { code: t.code })).status, 200);
  await expireVip(host.id);
  // Un participant gratuit quitte le tournoi
  assert.equal((await p1.s.post(`/tournaments/${t.id}/leave`)).status, 204, "départ d'un participant gratuit");
  // L'organisateur, VIP expiré, quitte : seul inscrit, le tournoi est fermé (annulation)
  assert.equal((await host.s.post(`/tournaments/${t.id}/leave`)).status, 204, "départ de l'organisateur sans VIP");
  const [row] = await sql("SELECT status FROM tournaments WHERE id = $1::uuid", [t.id]);
  assert.equal(row.status, "CLOSED");
});

test("tournoi : l'organisateur qui part est remplacé par un inscrit VIP, jamais par un joueur gratuit", async () => {
  const [host, free1, vip2, free3] = await Promise.all([vipUser("th1"), newUser("th2"), vipUser("th3"), newUser("th4")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 8, rounds: 3 })).body;
  // Le plus ancien inscrit est gratuit : l'organisation passe au VIP inscrit après lui
  for (const u of [free1, vip2, free3]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200);
  assert.equal((await host.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  let r = await vip2.s.get(`/tournaments/${t.id}`);
  assert.equal(r.body.isHost, true, "le VIP inscrit devient organisateur");
  assert.equal(r.body.hostLeft, false);
  r = await free1.s.get(`/tournaments/${t.id}`);
  assert.equal(r.body.isHost, false, "le plus ancien inscrit, gratuit, n'est pas désigné");
  assert.equal((await vip2.s.post(`/tournaments/${t.id}/start`)).status, 200, "le nouvel organisateur lance le tournoi");
});

test("tournoi sans inscrit VIP : reste en attente, un VIP inscrit reprend l'organisation (une seule reprise)", async () => {
  const [host, a, b, c] = await Promise.all([vipUser("to1"), newUser("to2"), newUser("to3"), newUser("to4")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 8, rounds: 3 })).body;
  for (const u of [a, b, c]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200);
  assert.equal((await host.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  let r = await a.s.get(`/tournaments/${t.id}`);
  assert.equal(r.body.status, "LOBBY", "le tournoi reste en attente");
  assert.equal(r.body.hostLeft, true, "sans organisateur");
  assert.equal(r.body.canClaimHost, false, "un joueur gratuit ne peut pas reprendre");
  assert.ok(r.body.players.every((p) => !p.isHost), "aucun joueur gratuit désigné");
  r = await a.s.post(`/tournaments/${t.id}/claim-host`);
  assert.equal(r.status, 402, "reprise refusée sans VIP, même par l'API");
  assert.equal((await a.s.post(`/tournaments/${t.id}/start`)).status, 403, "lancement refusé sans être organisateur");
  // L'ancien organisateur, parti, ne peut rien faire sans se réinscrire
  assert.equal((await host.s.post(`/tournaments/${t.id}/start`)).status, 404);
  // Deux joueurs devenus VIP essaient de reprendre en même temps : une seule reprise aboutit
  await Promise.all([grantVip(a.id), grantVip(b.id)]);
  assert.equal((await b.s.get(`/tournaments/${t.id}`)).body.canClaimHost, true);
  const claims = await Promise.all([a.s.post(`/tournaments/${t.id}/claim-host`), b.s.post(`/tournaments/${t.id}/claim-host`)]);
  assert.deepEqual(claims.map((x) => x.status).sort(), [200, 409], claims.map((x) => JSON.stringify(x.body)).join(" | "));
  const winner = claims[0].status === 200 ? a : b;
  r = await c.s.get(`/tournaments/${t.id}`);
  assert.equal(r.body.hostLeft, false);
  assert.equal(r.body.players.filter((p) => p.isHost).length, 1);
  assert.equal(r.body.players.find((p) => p.isHost).id, winner.id);
  assert.equal((await winner.s.post(`/tournaments/${t.id}/start`)).status, 200, "le VIP qui a repris lance le tournoi");
  assert.equal((await winner.s.post(`/tournaments/${t.id}/claim-host`)).status, 409, "plus de reprise après le lancement");
});

test("tournoi sans organisateur : fermé au départ du dernier inscrit", async () => {
  const [host, a] = await Promise.all([vipUser("tz1"), newUser("tz2")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 })).body;
  assert.equal((await a.s.post("/tournaments/join", { code: t.code })).status, 200);
  assert.equal((await host.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  assert.equal((await a.s.get(`/tournaments/${t.id}`)).body.hostLeft, true);
  assert.equal((await a.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  const [row] = await sql("SELECT status FROM tournaments WHERE id = $1::uuid", [t.id]);
  assert.equal(row.status, "CLOSED");
});

test("tournoi : lancement et départ simultanés restent cohérents", async () => {
  for (let round = 0; round < 3; round++) {
    const [host, a, b, c] = await Promise.all([vipUser(`tr${round}a`), newUser(`tr${round}b`), newUser(`tr${round}c`), newUser(`tr${round}d`)]);
    const t = (await host.s.post("/tournaments", { game: GAME, capacity: 8, rounds: 3 })).body;
    for (const u of [a, b, c]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200);
    const [start, leave] = await Promise.all([host.s.post(`/tournaments/${t.id}/start`), c.s.post(`/tournaments/${t.id}/leave`)]);
    assert.ok([200, 409].includes(start.status), `lancement : ${start.status} ${JSON.stringify(start.body)}`);
    assert.ok([204, 409].includes(leave.status), `départ : ${leave.status} ${JSON.stringify(leave.body)}`);
    const [row] = await sql("SELECT status, (SELECT count(*)::int FROM tournament_players WHERE tournament_id = $1::uuid) AS seats, (SELECT count(*)::int FROM tournament_players WHERE tournament_id = $1::uuid AND seed IS NOT NULL) AS seeded FROM tournaments WHERE id = $1::uuid", [t.id]);
    if (row.status === "ACTIVE") assert.equal(row.seeded, row.seats, "tous les inscrits ont une tête de série");
    else assert.equal(row.status, "LOBBY");
  }
});

test("tournoi « Tous les jeux » : sans jeu fixé, matchs lancés sur les clips de tous les jeux", async () => {
  const [host, a, b, c] = await Promise.all([vipUser("ta1"), newUser("ta2"), newUser("ta3"), newUser("ta4")]);
  let r = await host.s.post("/tournaments", { game: "all", capacity: 4, rounds: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = r.body;
  assert.deepEqual(t.game, { slug: "all", name: "Tous les jeux" });
  assert.equal((await sql("SELECT game_id FROM tournaments WHERE id = $1::uuid", [t.id]))[0].game_id, null);
  assert.equal((await a.s.get(`/tournaments/code/${t.code}`)).body.game.slug, "all", "aperçu par le code");
  for (const u of [a, b, c]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200);
  // 4 places sur 4 : lancé automatiquement à la dernière inscription
  r = await host.s.get(`/tournaments/${t.id}`);
  assert.equal(r.body.status, "ACTIVE", "complet : lancé automatiquement");
  // Les matchs sont créés quand les deux joueurs sont prêts : chaque salon de match n'a pas de jeu fixé
  const [m] = await sql("SELECT id, player1_id, player2_id FROM tournament_matches WHERE tournament_id = $1::uuid AND player1_id IS NOT NULL AND player2_id IS NOT NULL LIMIT 1", [t.id]);
  const players = { [host.id]: host, [a.id]: a, [b.id]: b, [c.id]: c };
  for (const id of [m.player1_id, m.player2_id]) {
    r = await players[id].s.post(`/tournaments/${t.id}/ready`);
    assert.ok([200, 201, 204].includes(r.status), `prêt : ${r.status} ${JSON.stringify(r.body)}`);
  }
  const [room] = await sql("SELECT r.id, r.game_id FROM tournament_matches tm JOIN rooms r ON r.id = tm.room_id WHERE tm.id = $1::uuid", [m.id]);
  assert.ok(room, "salon du match créé");
  assert.equal(room.game_id, null, "match « Tous les jeux »");
  r = await players[m.player1_id].s.get(`/rooms/${room.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.game.name, "Tous les jeux");
});
test("tournoi de joueurs complet : lancé automatiquement, même sans organisateur VIP présent", async () => {
  const [host, a, b, c] = await Promise.all([vipUser("tq1"), newUser("tq2"), newUser("tq3"), newUser("tq4")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 })).body;
  for (const u of [a, b]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200);
  // L'organisateur part sans VIP pour le remplacer : le tournoi reste en attente…
  assert.equal((await host.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  assert.equal((await a.s.get(`/tournaments/${t.id}`)).body.status, "LOBBY");
  const d = await sql("SELECT 1 FROM tournament_players WHERE tournament_id = $1::uuid", [t.id]);
  assert.equal(d.length, 2);
  // …et se lance tout seul dès qu'il est complet
  const [extra] = await Promise.all([newUser("tq5")]);
  assert.equal((await c.s.post("/tournaments/join", { code: t.code })).status, 200);
  assert.equal((await a.s.get(`/tournaments/${t.id}`)).body.status, "LOBBY", "3 sur 4 : toujours en attente");
  const r = await extra.s.post("/tournaments/join", { code: t.code });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "ACTIVE", "4 sur 4 : lancé automatiquement");
  assert.equal(r.body.bracketSize, 4);
});