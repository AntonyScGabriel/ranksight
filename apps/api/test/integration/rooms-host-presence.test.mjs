// Hôte d'une salle d'attente et connexion temps réel (application en arrière-plan, réseau coupé, onglet fermé) :
// une coupure de moins de 30 s ne change rien et ne déclenche aucun message ; au-delà, le rôle passe à un joueur
// connecté, l'ancien hôte reste dans le salon et, à son retour, l'état relu sur le serveur produit le message
// « Tu n'es plus l'hôte » (règle partagée `hostLostNotice`, celle du site et de l'application).
/* global URL */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { io } from "socket.io-client";
import { ROOM_HOST_AWAY_SEC, hostLostNotice } from "@ranksight/shared";
import { API, addClips, cleanup, grantVip, newUser, sql, wait } from "./lib.mjs";

const GAME = "valorant";
before(async () => {
  await addClips(GAME, 10);
});
after(cleanup);

function connect(user) {
  const socket = io(`${new URL(API).origin}/ws/chat`, { transports: ["websocket"], auth: { token: user.s.token() }, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}
const hostOf = async (id) => (await sql("SELECT host_id FROM rooms WHERE id = $1::uuid", [id]))[0]?.host_id;

async function lobbyWithHost(prefix) {
  const host = await newUser(`${prefix}h`);
  await grantVip(host.id);
  const a = await newUser(`${prefix}a`);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE" })).body;
  assert.equal((await a.s.post("/rooms/join", { code: room.code })).status, 200);
  const sockets = await Promise.all([connect(host), connect(a)]);
  const seen = (await host.s.get(`/rooms/${room.id}`)).body; // dernier état connu de l'hôte
  assert.equal(seen.isHost, true);
  return { host, a, room, sockets, seen };
}

test(`coupure de moins de ${ROOM_HOST_AWAY_SEC} s (arrière-plan, réseau) : toujours hôte, aucun message`, { timeout: 120_000 }, async () => {
  const { host, room, sockets: [hs, as], seen } = await lobbyWithHost("p1");
  // Deux coupures courtes successives (réseau instable), puis plus de 30 s au total depuis la première
  hs.disconnect();
  await wait(12_000);
  let back = await connect(host);
  await wait(6_000); // au moins un passage de la vérification de présence pendant la reconnexion
  back.disconnect();
  await wait(12_000);
  back = await connect(host);
  await wait(8_000);
  assert.equal(await hostOf(room.id), host.id, "le rôle n'a pas été transféré");
  const now = (await host.s.get(`/rooms/${room.id}`)).body;
  assert.equal(now.isHost, true);
  assert.equal(hostLostNotice(seen, now, host.id), null, "aucun message « Tu n'es plus l'hôte »");
  back.disconnect();
  as.disconnect();
});

test(`absence de plus de ${ROOM_HOST_AWAY_SEC} s : rôle transféré, message au retour, l'ancien hôte reste joueur`, { timeout: 120_000 }, async () => {
  const { host, a, room, sockets: [hs, as], seen } = await lobbyWithHost("p2");
  hs.disconnect();
  let moved = false;
  for (let t = 0; t < 60_000 && !moved; t += 500) {
    moved = (await hostOf(room.id)) === a.id;
    if (!moved) await wait(500);
  }
  assert.ok(moved, "rôle passé au joueur connecté");
  // Retour de l'ancien hôte (application rouverte) : l'écran relit l'état et affiche le message
  const back = await connect(host);
  const now = (await host.s.get(`/rooms/${room.id}`)).body;
  assert.equal(now.isHost, false);
  assert.equal(now.status, "LOBBY");
  assert.ok(now.players.some((p) => p.id === host.id && !p.left), "toujours dans le salon");
  const msg = hostLostNotice(seen, now, host.id);
  assert.ok(msg && msg.includes(a.pseudo), `message : ${msg}`);
  // Le nouvel hôte ne reçoit aucun message ; la reconnexion ne rend pas le rôle à l'ancien hôte
  const aSeen = (await a.s.get(`/rooms/${room.id}`)).body;
  assert.equal(hostLostNotice(aSeen, aSeen, a.id), null);
  await wait(6_000);
  assert.equal(await hostOf(room.id), a.id);
  // Seul le nouvel hôte peut lancer
  assert.equal((await host.s.post(`/rooms/${room.id}/start`)).status, 403);
  back.disconnect();
  as.disconnect();
});
