// Salons : création réservée aux VIP, participation gratuite, transfert d'hôte sans VIP (départ ou déconnexion),
// salon retiré en fin de partie (résultats conservés), salle d'attente vide supprimée, mort subite (3 finalistes au plus),
// salons publics par défaut entretenus par le serveur. Tout est vérifié par l'API, requêtes directes comprises.
/* global URL */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { io } from "socket.io-client";
import { API, addClips, cleanup, grantVip, newUser, sql, wait } from "./lib.mjs";

const GAME = "valorant";
let clips;
before(async () => {
  clips = await addClips(GAME, 40);
});
after(cleanup);

async function vipUser(prefix) {
  const u = await newUser(prefix);
  await grantVip(u.id);
  return u;
}
const roomRow = async (id) => (await sql("SELECT status::text, host_id, created_by_id, system_slot FROM rooms WHERE id = $1::uuid", [id]))[0];
const startNow = (id) => sql("UPDATE rooms SET round_starts_at = (now() at time zone 'utc') - interval '1 second' WHERE id = $1::uuid", [id]);

/** Connexion temps réel d'un joueur (comme le site ou l'application ouverts) */
function connect(user) {
  const socket = io(`${new URL(API).origin}/ws/chat`, { transports: ["websocket"], auth: { token: user.s.token() }, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

/**
 * Joue les manches prévues : chaque joueur répond au rang exact (`exact`) ou à un autre rang. Les manches se terminent dès
 * que tout le monde a répondu ; le début de chaque manche est avancé pour ne pas attendre le compte à rebours.
 */
async function playRounds(roomId, players, rounds, exact = () => true, beforeLast = async () => {}) {
  for (let round = 1; round <= rounds; round++) {
    if (round === rounds) await beforeLast();
    await startNow(roomId);
    const served = [];
    for (const u of players) {
      const c = await u.s.get(`/rooms/${roomId}/next`);
      assert.equal(c.status, 200, `manche ${round} : ${JSON.stringify(c.body)}`);
      served.push([u, c.body]);
    }
    await wait(1100);
    for (const [u, c] of served) {
      const rankId = exact(u, round) ? clips.rankOf[c.id] : clips.ranks.find((x) => x.id !== clips.rankOf[c.id]).id;
      const r = await u.s.post("/guesses", { playToken: c.playToken, rankId, watchedMs: 900 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    await wait(300);
  }
}
const until = async (check, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    const v = await check();
    if (v) return v;
    await wait(300);
  }
  return check();
};

test("1-4. création : réservée aux VIP (public comme privé, tous modes), refusée sans VIP même par l'API", async () => {
  const [free, vip] = await Promise.all([newUser("c1"), vipUser("c2")]);
  for (const body of [
    { game: GAME, visibility: "PUBLIC" },
    { game: GAME, visibility: "PRIVATE" },
    { game: GAME, visibility: "PUBLIC", teamSize: 2 },
    { game: GAME, visibility: "PUBLIC", impostor: true },
    { game: GAME, visibility: "PUBLIC", rounds: 5, roundSec: 30, suddenDeath: false },
  ]) {
    const r = await free.s.post("/rooms", body);
    assert.equal(r.status, 402, `1-2. sans VIP : ${JSON.stringify(body)}`);
    assert.equal(r.body.code, "PREMIUM_REQUIRED");
  }
  let r = await free.s.post("/rooms/quick-play", { game: GAME, mode: "CLASSIC", create: true });
  assert.equal(r.status, 402, "« Jouer maintenant » ne crée pas de salon pour un joueur sans VIP");
  r = await free.s.post("/rooms", { game: GAME, visibility: "PUBLIC", vip: true });
  assert.equal(r.status, 400, "aucun champ « VIP » accepté du client");
  assert.equal((await free.s.get("/rooms")).body.canCreate, false);
  assert.equal((await vip.s.get("/rooms")).body.canCreate, true);
  r = await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC" });
  assert.equal(r.status, 201, `3. VIP : salon public ${JSON.stringify(r.body)}`);
  assert.equal(r.body.visibility, "PUBLIC");
  assert.equal(r.body.system, false);
  assert.equal((await roomRow(r.body.id)).created_by_id, vip.id, "créé par le VIP");
  r = await vip.s.post("/rooms", { game: GAME, visibility: "PRIVATE", suddenDeath: true, rounds: 3 });
  assert.equal(r.status, 201, "4. VIP : salon privé");
  assert.equal(r.body.visibility, "PRIVATE");
});

test("5-8. un joueur gratuit rejoint ; l'hôte VIP part : un joueur gratuit devient hôte, lance et la partie va à son terme", async () => {
  const [host, a, b] = await Promise.all([vipUser("h1"), newUser("h2"), newUser("h3")]);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 3, roundSec: 20 })).body;
  let r = await a.s.post(`/rooms/${room.id}/join`);
  assert.equal(r.status, 200, "5. gratuit : rejoint un salon public");
  assert.equal((await b.s.post("/rooms/join", { code: room.code })).status, 200, "5. gratuit : rejoint avec le code");
  assert.equal((await host.s.post(`/rooms/${room.id}/leave`)).status, 204);
  r = await a.s.get(`/rooms/${room.id}`);
  assert.equal(r.body.isHost, true, "6. le joueur gratuit arrivé le plus tôt devient hôte");
  assert.equal((await roomRow(room.id)).host_id, a.id);
  assert.equal(r.body.players.filter((p) => p.isHost).length, 1, "un seul hôte");
  // 7. Aucun abonnement requis : l'hôte gratuit gère le salon et lance la partie
  assert.equal((await a.s.post(`/rooms/${room.id}/kick/${b.id}`)).status, 200, "7. hôte gratuit : retire un joueur");
  const c = await newUser("h4");
  assert.equal((await c.s.post(`/rooms/${room.id}/join`)).status, 200);
  r = await a.s.post(`/rooms/${room.id}/start`);
  assert.equal(r.status, 200, `7. hôte gratuit : lance la partie ${JSON.stringify(r.body)}`);
  // 8. La partie continue normalement jusqu'aux résultats
  await playRounds(room.id, [a, c], 3, (u) => u === a);
  const done = await until(async () => ((await a.s.get(`/rooms/${room.id}`)).body.status === "FINISHED" ? true : null));
  assert.ok(done, "8. partie terminée");
  const final = (await c.s.get(`/rooms/${room.id}`)).body;
  assert.equal(final.players.find((p) => p.id === a.id).placement, 1);
  assert.equal(final.details.length, 3);
});

test("6-7. hôte déconnecté depuis plus de 30 s : le rôle passe à un joueur connecté, sans VIP", { timeout: 90_000 }, async () => {
  const [host, a] = await Promise.all([vipUser("d1"), newUser("d2")]);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC" })).body;
  assert.equal((await a.s.post(`/rooms/${room.id}/join`)).status, 200);
  const [hostSocket, aSocket] = await Promise.all([connect(host), connect(a)]);
  await wait(6000);
  assert.equal((await roomRow(room.id)).host_id, host.id, "hôte connecté : rien ne change");
  hostSocket.disconnect(); // fermeture brutale de l'application
  const moved = await until(async () => ((await roomRow(room.id)).host_id === a.id ? true : null), 50_000);
  aSocket.disconnect();
  assert.ok(moved, "l'hôte absent est remplacé par le joueur connecté");
  const detail = (await a.s.get(`/rooms/${room.id}`)).body;
  assert.equal(detail.isHost, true);
  assert.equal(detail.players.length, 2, "l'ancien hôte reste inscrit (il peut revenir comme joueur)");
});

test("9. fin de partie : salon retiré (liste, code, invitations), résultats et historique conservés", async () => {
  const [host, a, friend] = await Promise.all([vipUser("f1"), newUser("f2"), newUser("f3")]);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 3, roundSec: 20 })).body;
  await a.s.post(`/rooms/${room.id}/join`);
  await sql("INSERT INTO friendships (requester_id, addressee_id, status, responded_at) VALUES ($1::uuid, $2::uuid, 'ACCEPTED', now())", [host.id, friend.id]);
  assert.equal((await host.s.post(`/rooms/${room.id}/invite`, { userId: friend.id })).status, 200);
  assert.equal((await host.s.post(`/rooms/${room.id}/start`)).status, 200);
  await playRounds(room.id, [host, a], 3, (u) => u === host);
  assert.ok(await until(async () => ((await roomRow(room.id)).status === "FINISHED" ? true : null)), "partie terminée");
  // Salon retiré
  assert.ok(!(await a.s.get(`/rooms/public?game=${GAME}`)).body.some((x) => x.id === room.id), "plus dans la liste");
  const outsider = await newUser("f4");
  assert.equal((await outsider.s.post("/rooms/join", { code: room.code })).status, 404, "code : plus rien");
  assert.equal((await outsider.s.post(`/rooms/${room.id}/join`)).status, 404, "identifiant : plus rien");
  assert.equal((await outsider.s.get(`/rooms/code/${room.code}`)).status, 404);
  assert.equal((await sql("SELECT count(*)::int AS n FROM room_invites WHERE room_id = $1::uuid", [room.id]))[0].n, 0, "invitations effacées");
  // Résultats conservés
  const detail = (await a.s.get(`/rooms/${room.id}`)).body;
  assert.equal(detail.status, "FINISHED");
  assert.equal(detail.players.find((p) => p.id === host.id).placement, 1);
  assert.equal((await sql("SELECT count(*)::int AS n FROM guesses WHERE room_id = $1::uuid", [room.id]))[0].n, 6, "réponses gardées");
  const hist = (await a.s.get("/rooms/history")).body;
  assert.ok(hist.items.some((x) => x.id === room.id), "dans l'historique");
  assert.equal((await host.s.post(`/rooms/${room.id}/rematch`)).status, 404, "revanche retirée");
});

test("10. salle d'attente vide ou fermée : supprimée de la base", async () => {
  const [host, a] = await Promise.all([vipUser("e1"), newUser("e2")]);
  let room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC" })).body;
  assert.equal((await host.s.post(`/rooms/${room.id}/leave`)).status, 204);
  assert.equal(await roomRow(room.id), undefined, "dernier joueur parti : salon supprimé");
  room = (await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE" })).body;
  await a.s.post("/rooms/join", { code: room.code });
  assert.equal((await a.s.post(`/rooms/${room.id}/leave`)).status, 204);
  assert.equal((await host.s.post(`/rooms/${room.id}/leave`)).status, 204);
  assert.equal(await roomRow(room.id), undefined, "tout le monde parti : supprimé");
  room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC" })).body;
  assert.equal((await host.s.post(`/rooms/${room.id}/close`)).status, 204);
  assert.equal(await roomRow(room.id), undefined, "fermé par l'hôte : supprimé");
  assert.equal((await host.s.get(`/rooms/${room.id}`)).status, 404);
});

test("11-12. mort subite : salons publics et privés, finalistes à égalité en tête seulement, sans VIP", async () => {
  for (const visibility of ["PUBLIC", "PRIVATE"]) {
    const [host, a, b] = await Promise.all([vipUser("s1"), newUser("s2"), newUser("s3")]);
    const room = (await host.s.post("/rooms", { game: GAME, visibility, rounds: 3, roundSec: 20, suddenDeath: true })).body;
    await a.s.post("/rooms/join", { code: room.code });
    await b.s.post("/rooms/join", { code: room.code });
    assert.equal((await host.s.post(`/rooms/${room.id}/start`)).status, 200, `${visibility} : lancé avec des joueurs gratuits`);
    // L'hôte et le joueur gratuit A à égalité en tête, B derrière
    await playRounds(room.id, [host, a, b], 3, (u) => u !== b);
    const sd = await until(async () => {
      const d = (await a.s.get(`/rooms/${room.id}`)).body;
      return d.live?.suddenDeath ? d : null;
    });
    assert.ok(sd, `${visibility} : manche décisive lancée`);
    assert.deepEqual(sd.players.filter((p) => p.finalist).map((p) => p.id).sort(), [host.id, a.id].sort(), "seuls les ex aequo en tête");
    await startNow(room.id);
    const spectator = await b.s.get(`/rooms/${room.id}/next`);
    assert.equal(spectator.body.code, "SUDDEN_DEATH_SPECTATOR", "12. joueur hors égalité : ne joue pas la manche décisive");
    // Le joueur gratuit gagne la manche décisive
    const ca = (await a.s.get(`/rooms/${room.id}/next`)).body;
    const ch = (await host.s.get(`/rooms/${room.id}/next`)).body;
    await wait(1100);
    await a.s.post("/guesses", { playToken: ca.playToken, rankId: clips.rankOf[ca.id], watchedMs: 900 });
    await host.s.post("/guesses", { playToken: ch.playToken, rankId: clips.ranks.find((x) => x.id !== clips.rankOf[ch.id]).id, watchedMs: 900 });
    const final = await until(async () => {
      const d = (await a.s.get(`/rooms/${room.id}`)).body;
      return d.status === "FINISHED" ? d : null;
    });
    assert.ok(final, `${visibility} : partie terminée`);
    assert.equal(final.decidedBy, "SUDDEN_DEATH");
    assert.equal(final.players.find((p) => p.id === a.id).placement, 1);
    assert.equal(final.players.find((p) => p.id === host.id).placement, 2);
    assert.equal(final.players.find((p) => p.id === b.id).placement, 3);
  }
});

test("12. plus de 3 joueurs à égalité : 3 finalistes, choisis par rangs exacts puis vitesse", async () => {
  const host = await vipUser("x1");
  const others = await Promise.all(["x2", "x3", "x4", "x5"].map((p) => newUser(p)));
  const players = [host, ...others];
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 3, roundSec: 20, suddenDeath: true })).body;
  for (const u of others) assert.equal((await u.s.post(`/rooms/${room.id}/join`)).status, 200);
  assert.equal((await host.s.post(`/rooms/${room.id}/start`)).status, 200);
  // Tout le monde trouve le rang exact (égalité à 5) ; temps de réponse des deux premières manches fixés : du plus rapide au plus lent
  await playRounds(room.id, players, 3, () => true, async () => {
    for (const [i, u] of players.entries()) {
      await sql("UPDATE guesses SET response_ms = $1 WHERE room_id = $2::uuid AND user_id = $3::uuid", [1000 + i * 4000, room.id, u.id]);
    }
  });
  const sd = await until(async () => {
    const d = (await host.s.get(`/rooms/${room.id}`)).body;
    return d.live?.suddenDeath ? d : null;
  });
  assert.ok(sd, "manche décisive lancée");
  const finalists = sd.players.filter((p) => p.finalist).map((p) => p.id);
  assert.equal(finalists.length, 3, "3 finalistes au plus");
  assert.deepEqual(finalists.sort(), players.slice(0, 3).map((u) => u.id).sort(), "les 3 plus rapides (même nombre de rangs exacts)");
  await startNow(room.id);
  for (const u of players.slice(3)) assert.equal((await u.s.get(`/rooms/${room.id}/next`)).body.code, "SUDDEN_DEATH_SPECTATOR");
});

test("13-14. salons par défaut : 2 salles d'attente publiques par mode, sans doublon, ouvertes aux joueurs gratuits", async () => {
  const slots = ["CLASSIC:1", "CLASSIC:2", "TEAMS_2:1", "TEAMS_2:2", "TEAMS_3:1", "TEAMS_3:2", "IMPOSTOR:1", "IMPOSTOR:2"];
  const lobbies = async () => sql("SELECT system_slot, count(*)::int AS n FROM rooms WHERE status = 'LOBBY' AND system_slot IS NOT NULL GROUP BY system_slot");
  const ready = await until(async () => {
    const rows = await lobbies();
    return slots.every((s) => rows.some((r) => r.system_slot === s && r.n === 1)) ? rows : null;
  }, 20_000);
  assert.ok(ready, `13. une salle d'attente par emplacement : ${JSON.stringify(await lobbies())}`);
  assert.ok(ready.every((r) => r.n === 1), "jamais deux salles d'attente pour un même emplacement");
  const [row] = await sql("SELECT created_by_id FROM rooms WHERE status = 'LOBBY' AND system_slot = 'CLASSIC:1'");
  assert.equal(row.created_by_id, null, "créé par le serveur, compté pour aucun joueur");
  // La base refuse un doublon, même inséré directement (demandes simultanées, plusieurs instances)
  const [game] = await sql("SELECT id FROM games WHERE slug = $1", [GAME]);
  await assert.rejects(
    sql(`INSERT INTO rooms (id, code, game_id, rounds, round_sec, expires_at, visibility, system_slot)
         VALUES (gen_random_uuid(), 'ZZTEST22', $1::uuid, 5, 30, now() + interval '1 hour', 'PUBLIC', 'CLASSIC:1')`, [game.id]),
    (e) => e.code === "23505",
    "doublon refusé par l'index unique",
  );
  // 14. Un joueur gratuit voit les salons gratuits et en rejoint un ; le premier arrivé devient hôte (sans VIP) et lance
  const [a, b, c] = await Promise.all([newUser("p1"), newUser("p2"), newUser("p3")]);
  const list = (await a.s.get("/rooms/public?mode=CLASSIC&available=true")).body.filter((x) => x.system);
  assert.ok(list.length >= 2, "salons gratuits listés");
  const target = list.find((x) => x.players === 0);
  assert.ok(target, "salon gratuit vide disponible");
  assert.equal(target.host, null, "en attente de son premier joueur");
  let r = await a.s.post(`/rooms/${target.id}/join`);
  assert.equal(r.status, 200, "gratuit : rejoint un salon par défaut");
  assert.equal(r.body.system, true);
  assert.equal(r.body.isHost, true, "premier arrivé : hôte, sans VIP");
  r = await b.s.post("/rooms/quick-play", { game: target.game.slug, mode: "CLASSIC" });
  assert.equal(r.status, 200);
  assert.ok(r.body.room && r.body.room.visibility === "PUBLIC" && r.body.room.mode === "CLASSIC", "« Jouer maintenant » : un salon public compatible");
  if (r.body.room.id !== target.id) await b.s.post(`/rooms/${r.body.room.id}/leave`);
  assert.equal((await b.s.post(`/rooms/${target.id}/join`)).status, 200, "gratuit : rejoint le salon gratuit");
  const { system_slot: slot } = await roomRow(target.id);
  const count = async (lobbyOnly) => (await sql(`SELECT count(*)::int AS n FROM rooms WHERE system_slot = $1${lobbyOnly ? " AND status = 'LOBBY'" : ""}`, [slot]))[0].n;
  const before = await count(false);
  assert.equal((await a.s.post(`/rooms/${target.id}/start`)).status, 200, "hôte gratuit : lance la partie");
  // Remplacement : le lancement et la boucle du serveur le tentent tous les deux ; un seul salon est créé
  assert.ok(await until(async () => ((await count(true)) === 1 ? true : null)), "emplacement remplacé");
  await wait(6000);
  assert.equal(await count(false), before + 1, "un seul salon de remplacement");
  assert.equal(await count(true), 1);
  // Un salon par défaut ne se ferme pas, même par son hôte (gratuit)
  const [{ id: replacement }] = await sql("SELECT id FROM rooms WHERE status = 'LOBBY' AND system_slot = $1", [slot]);
  r = await c.s.post(`/rooms/${replacement}/join`);
  assert.equal(r.body.isHost, true);
  assert.equal((await c.s.post(`/rooms/${replacement}/close`)).status, 403);
  // Parti : le salon par défaut reste ouvert, sans hôte (pas de création en boucle)
  assert.equal((await c.s.post(`/rooms/${replacement}/leave`)).status, 204);
  const left = await roomRow(replacement);
  assert.equal(left.status, "LOBBY");
  assert.equal(left.host_id, null);
});
