// Salons par défaut : personne ne peut y être retiré, et l'hôte (désigné automatiquement) ne choisit pas l'équipe des
// autres. Les salons créés par un VIP (publics ou privés) gardent l'expulsion et le placement par l'hôte. Les requêtes
// sont envoyées directement à l'API, comme le ferait un client modifié.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addClips, cleanup, grantVip, newUser, sql, wait } from "./lib.mjs";

const GAME = "valorant";
before(async () => {
  await addClips(GAME, 30);
});
after(cleanup);

async function vipUser(prefix) {
  const u = await newUser(prefix);
  await grantVip(u.id);
  return u;
}
const seated = async (roomId, userId) =>
  (await sql("SELECT count(*)::int AS n FROM room_players WHERE room_id = $1::uuid AND user_id = $2::uuid AND left_at IS NULL", [roomId, userId]))[0].n === 1;
const teamOf = async (roomId, userId) =>
  (await sql("SELECT team FROM room_players WHERE room_id = $1::uuid AND user_id = $2::uuid", [roomId, userId]))[0]?.team;

/** Salle d'attente par défaut encore vide pour un mode (le serveur les entretient toutes les 5 s) */
async function emptySystemLobby(mode) {
  for (let t = 0; t < 20_000; t += 300) {
    const [row] = await sql(
      `SELECT r.id FROM rooms r WHERE r.status = 'LOBBY' AND r.system_slot LIKE $1
         AND NOT EXISTS (SELECT 1 FROM room_players p WHERE p.room_id = r.id AND p.left_at IS NULL)
       ORDER BY r.system_slot LIMIT 1`,
      [`${mode}:%`],
    );
    if (row) return row.id;
    await wait(300);
  }
  throw new Error(`Aucun salon par défaut libre pour ${mode}`);
}

test("salon par défaut : l'hôte (gratuit ou VIP) ne peut retirer personne, même par une requête directe", async () => {
  const roomId = await emptySystemLobby("CLASSIC");
  const [host, b, vip] = await Promise.all([newUser("m1"), newUser("m2"), vipUser("m3")]);
  let r = await host.s.post(`/rooms/${roomId}/join`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.system, true);
  assert.equal(r.body.isHost, true, "premier arrivé : hôte");
  for (const u of [b, vip]) assert.equal((await u.s.post(`/rooms/${roomId}/join`)).status, 200);

  r = await host.s.post(`/rooms/${roomId}/kick/${b.id}`);
  assert.equal(r.status, 403, "hôte gratuit : expulsion refusée");
  assert.equal(r.body.code, "SYSTEM_ROOM");
  assert.ok(await seated(roomId, b.id), "le joueur visé reste dans le salon");

  // Un VIP devenu hôte n'a pas plus de droits dans un salon par défaut
  assert.equal((await host.s.post(`/rooms/${roomId}/leave`)).status, 204);
  r = await b.s.get(`/rooms/${roomId}`);
  const newHost = r.body.players.find((p) => p.isHost).id === vip.id ? vip : b;
  const other = newHost === vip ? b : vip;
  r = await newHost.s.post(`/rooms/${roomId}/kick/${other.id}`);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "SYSTEM_ROOM");
  // Un simple joueur non plus, et le refus ne dépend pas de la cible
  r = await other.s.post(`/rooms/${roomId}/kick/${newHost.id}`);
  assert.equal(r.status, 403);
  r = await newHost.s.post(`/rooms/${roomId}/kick/00000000-0000-4000-8000-000000000000`);
  assert.equal(r.status, 403);
  assert.ok(await seated(roomId, other.id) && await seated(roomId, newHost.id), "personne n'a été retiré");
  // Rien n'a été inscrit dans la liste des joueurs retirés : le joueur parti peut revenir
  assert.equal((await host.s.post(`/rooms/${roomId}/join`)).status, 200, "un joueur parti revient librement");
});

test("salon par défaut par équipes : chacun choisit son équipe, l'hôte ne déplace personne", async () => {
  const roomId = await emptySystemLobby("TEAMS_2");
  const [host, b] = await Promise.all([newUser("e1"), newUser("e2")]);
  assert.equal((await host.s.post(`/rooms/${roomId}/join`)).body.isHost, true);
  assert.equal((await b.s.post(`/rooms/${roomId}/join`)).status, 200);
  const before = await teamOf(roomId, b.id);
  const other = before === 1 ? 2 : 1;
  let r = await host.s.post(`/rooms/${roomId}/team`, { team: other, userId: b.id });
  assert.equal(r.status, 403, `déplacement par l'hôte refusé : ${JSON.stringify(r.body)}`);
  assert.equal(r.body.code, "SYSTEM_ROOM");
  assert.equal(await teamOf(roomId, b.id), before, "équipe inchangée");
  r = await b.s.post(`/rooms/${roomId}/kick/${host.id}`);
  assert.equal(r.status, 403);
  // Le joueur change lui-même d'équipe
  r = await b.s.post(`/rooms/${roomId}/team`, { team: other });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await teamOf(roomId, b.id), other);
  // Se désigner soi-même explicitement reste permis
  r = await b.s.post(`/rooms/${roomId}/team`, { team: before, userId: b.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("salons créés par un VIP (public et privé) : l'hôte retire un joueur, qui ne peut plus revenir", async () => {
  for (const visibility of ["PUBLIC", "PRIVATE"]) {
    const [host, a, b] = await Promise.all([vipUser(`k${visibility[1]}1`), newUser(`k${visibility[1]}2`), newUser(`k${visibility[1]}3`)]);
    const room = (await host.s.post("/rooms", { game: GAME, visibility })).body;
    assert.equal(room.system, false);
    for (const u of [a, b]) assert.equal((await u.s.post("/rooms/join", { code: room.code })).status, 200);
    let r = await a.s.post(`/rooms/${room.id}/kick/${b.id}`);
    assert.equal(r.status, 403, `${visibility} : un joueur qui n'est pas hôte ne retire personne`);
    assert.equal(r.body.code, "NOT_HOST");
    r = await host.s.post(`/rooms/${room.id}/kick/${b.id}`);
    assert.equal(r.status, 200, `${visibility} : l'hôte retire un joueur ${JSON.stringify(r.body)}`);
    assert.ok(!(await seated(room.id, b.id)));
    r = await b.s.post("/rooms/join", { code: room.code });
    assert.ok(r.status >= 400, `${visibility} : le joueur retiré ne revient pas (${r.status})`);
  }
});

test("salon par équipes créé par un VIP : l'hôte place les joueurs, un joueur ne place que lui-même", async () => {
  const [host, a, b] = await Promise.all([vipUser("q1"), newUser("q2"), newUser("q3")]);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE", teamSize: 2 })).body;
  for (const u of [a, b]) assert.equal((await u.s.post("/rooms/join", { code: room.code })).status, 200);
  const team = await teamOf(room.id, a.id);
  const other = team === 1 ? 2 : 1;
  let r = await b.s.post(`/rooms/${room.id}/team`, { team: other, userId: a.id });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "NOT_HOST");
  assert.equal(await teamOf(room.id, a.id), team);
  // Libère une place dans l'autre équipe (deux joueurs par équipe), puis l'hôte déplace le joueur
  assert.equal((await b.s.post(`/rooms/${room.id}/leave`)).status, 204);
  r = await host.s.post(`/rooms/${room.id}/team`, { team: other, userId: a.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await teamOf(room.id, a.id), other, "l'hôte a déplacé le joueur");
});
