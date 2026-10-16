// Modèle gratuit / VIP : salons publics classiques gratuits ; salon privé, mort subite, options avancées, Plus haut / Plus bas
// et organisation de tournois réservés aux VIP. Tout est vérifié par l'API, requêtes directes comprises.
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
const befriend = (a, b) => sql("INSERT INTO friendships (requester_id, addressee_id, status, responded_at) VALUES ($1::uuid, $2::uuid, 'ACCEPTED', now())", [a.id, b.id]);
async function vipUser(prefix) {
  const u = await newUser(prefix);
  await grantVip(u.id);
  return u;
}

test("1-2. salon public classique : gratuit pour créer et rejoindre, VIP comme gratuit", async () => {
  const [free, free2, vip] = await Promise.all([newUser("f1"), newUser("f2"), vipUser("v1")]);
  let r = await free.s.post("/rooms", { game: GAME, visibility: "PUBLIC" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.vipOnly, false);
  assert.equal((await free2.s.post(`/rooms/${r.body.id}/join`)).status, 200, "un joueur gratuit rejoint");
  assert.equal((await vip.s.post(`/rooms/${r.body.id}/join`)).status, 200, "un VIP rejoint");
  const v = await vipUser("v2");
  r = await v.s.post("/rooms", { game: GAME, visibility: "PUBLIC" });
  assert.equal(r.status, 201, "un VIP crée un salon public classique");
  assert.equal((await free.s.post(`/rooms/${r.body.id}/join`)).status, 200, "un joueur gratuit rejoint le salon public d'un VIP");
});

test("4. options par défaut explicites (5 manches, 30 s, sans mort subite) : gratuites", async () => {
  const [free, free2] = await Promise.all([newUser("d1"), newUser("d2")]);
  const r = await free.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 5, roundSec: 30, suddenDeath: false });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.vipOnly, false);
  assert.equal(r.body.rounds, 5);
  assert.equal(r.body.roundSec, 30);
  assert.equal((await free2.s.post(`/rooms/${r.body.id}/join`)).status, 200);
  assert.ok([200, 201].includes((await free.s.post(`/rooms/${r.body.id}/start`)).status), "lancement par un hôte gratuit");
  // Une seule option avancée suffit à exiger un hôte VIP
  const free3 = await newUser("d3");
  for (const opts of [{ rounds: 3 }, { roundSec: 20 }, { suddenDeath: true }]) {
    const x = await free3.s.post("/rooms", { game: GAME, visibility: "PUBLIC", ...opts });
    assert.equal(x.status, 402, `option ${JSON.stringify(opts)} sans VIP`);
  }
});

test("3-5. salon privé : création VIP seulement ; invité gratuit accepté avec une invitation valide", async () => {
  const [free, host, friend, stranger] = await Promise.all([newUser("f3"), vipUser("v3"), newUser("f4"), newUser("f5")]);
  let r = await free.s.post("/rooms", { game: GAME, visibility: "PRIVATE" });
  assert.equal(r.status, 402, "gratuit : salon privé refusé");
  r = await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE" });
  assert.equal(r.status, 201, "VIP : salon privé créé");
  const room = r.body;
  assert.equal((await stranger.s.post(`/rooms/${room.id}/join`)).status, 404, "sans invitation ni code : refusé");
  await befriend(host, friend);
  r = await host.s.post(`/rooms/${room.id}/invite`, { userId: friend.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await friend.s.post(`/rooms/${room.id}/join`);
  assert.equal(r.status, 200, "invité gratuit : accepté");
  assert.equal(r.body.players.length, 2);
  // Code partagé : un autre joueur gratuit entre aussi
  assert.equal((await stranger.s.post("/rooms/join", { code: room.code })).status, 200);
});

test("6-8. mort subite et options avancées : interdites sans VIP, contournement par l'API refusé", async () => {
  const [free, freeB, vip, vipB] = await Promise.all([newUser("f6"), newUser("f7"), vipUser("v6"), vipUser("v7")]);
  for (const body of [
    { game: GAME, visibility: "PUBLIC", suddenDeath: true },
    { game: GAME, visibility: "PUBLIC", rounds: 10 },
    { game: GAME, visibility: "PUBLIC", roundSec: 60 },
  ]) {
    const r = await free.s.post("/rooms", body);
    assert.equal(r.status, 402, JSON.stringify(body));
  }
  let r = await free.s.post("/rooms", { game: GAME, visibility: "PUBLIC", vip: true, suddenDeath: true });
  assert.equal(r.status, 400, "aucun champ « VIP » accepté du client");
  // Salon public en mode VIP : visible, mais un joueur gratuit ne peut pas y jouer (liste, code, identifiant, invitation)
  r = await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC", suddenDeath: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const room = r.body;
  assert.equal(room.vipOnly, true);
  const listed = (await free.s.get(`/rooms/public?game=${GAME}`)).body.find((x) => x.id === room.id);
  assert.equal(listed.vipOnly, true);
  assert.equal(listed.joinable, false, "affiché comme réservé aux VIP");
  assert.equal((await free.s.post(`/rooms/${room.id}/join`)).body.code, "VIP_MODE_REQUIRED");
  r = await free.s.post("/rooms/join", { code: room.code });
  assert.equal(r.status, 402);
  assert.equal((await free.s.get(`/rooms/code/${room.code}`)).body.allowed, false);
  await befriend(vip, free);
  assert.equal((await vip.s.post(`/rooms/${room.id}/invite`, { userId: free.id })).status, 402, "invitation d'un ami sans VIP refusée");
  // Un VIP rejoint et l'hôte lance
  assert.equal((await vipB.s.post(`/rooms/${room.id}/join`)).status, 200);
  // VIP expiré entre l'inscription et le lancement : lancement refusé, droit relu en base
  await expireVip(vipB.id);
  r = await vip.s.post(`/rooms/${room.id}/start`);
  assert.equal(r.status, 402, JSON.stringify(r.body));
  await grantVip(vipB.id);
  r = await vip.s.post(`/rooms/${room.id}/start`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "ACTIVE", "7. VIP : mort subite lancée");
  assert.equal(await sql("SELECT 1 FROM competitive_ratings WHERE user_id = ANY($1::uuid[])", [[vip.id, vipB.id]]).then((x) => x.length), 0, "aucun effet sur la cote");
  // Options avancées : hôte VIP, joueurs gratuits acceptés
  r = await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 3 });
  assert.equal(r.status, 409, "déjà en partie");
  r = await vipUser("v8").then((v) => v.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 3, roundSec: 45 }));
  assert.equal(r.status, 201);
  assert.equal(r.body.vipOnly, false);
  assert.equal((await freeB.s.post(`/rooms/${r.body.id}/join`)).status, 200, "options avancées : un joueur gratuit peut jouer");
});

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
  let r = await free.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 });
  assert.equal(r.status, 402, "gratuit : création refusée");
  r = await vip.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 });
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

test("11. « Jouer maintenant » : gratuit, jamais dans un salon en mode VIP", async () => {
  const [vip, free, vip2] = await Promise.all([vipUser("q1"), newUser("q2"), vipUser("q3")]);
  const vipRoom = (await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC", teamSize: 2, suddenDeath: true })).body;
  let r = await free.s.post("/rooms/quick-play", { game: GAME, mode: "TEAMS_2" });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.room?.id, vipRoom.id, "joueur gratuit : salon en mode VIP jamais proposé");
  if (r.body.room) await free.s.post(`/rooms/${r.body.room.id}/leave`);
  r = await free.s.post("/rooms/quick-play", { game: GAME, mode: "TEAMS_2", create: true });
  assert.equal(r.status, 200);
  assert.ok(r.body.room && r.body.room.id !== vipRoom.id && r.body.room.vipOnly === false, "création d'un salon public classique");
  r = await vip2.s.post("/rooms/quick-play", { game: GAME, mode: "TEAMS_2" });
  assert.ok(r.body.room, "un VIP trouve un salon");
});

test("revanche d'un salon aux options avancées : proposée par un VIP, acceptée gratuitement", async () => {
  const [vip, free] = await Promise.all([vipUser("r1"), newUser("r2")]);
  const room = (await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 3 })).body;
  await free.s.post(`/rooms/${room.id}/join`);
  await sql("UPDATE rooms SET status = 'FINISHED', started_at = now(), finished_at = now() WHERE id = $1", [room.id]);
  await sql("UPDATE room_players SET placement = 1 WHERE room_id = $1", [room.id]);
  assert.equal((await free.s.get(`/rooms/${room.id}`)).body.canRematch, false, "gratuit : ne peut pas proposer cette revanche");
  assert.equal((await free.s.post(`/rooms/${room.id}/rematch`)).status, 402);
  const r = await vip.s.post(`/rooms/${room.id}/rematch`);
  assert.equal(r.status, 200);
  const accepted = await free.s.post(`/rooms/${room.id}/rematch`);
  assert.equal(accepted.status, 200, "gratuit : accepte la revanche proposée");
  assert.equal(accepted.body.id, r.body.id);
});

test("hôte parti : un joueur VIP reprend un salon qui l'exige", async () => {
  const [host, free, vip2] = await Promise.all([vipUser("o1"), newUser("o2"), vipUser("o3")]);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE" })).body;
  await free.s.post("/rooms/join", { code: room.code });
  await vip2.s.post("/rooms/join", { code: room.code });
  await host.s.post(`/rooms/${room.id}/leave`);
  const [{ host_id: hostId }] = await sql("SELECT host_id FROM rooms WHERE id = $1", [room.id]);
  assert.equal(hostId, vip2.id, "le VIP devient hôte, même arrivé après le joueur gratuit");
});
