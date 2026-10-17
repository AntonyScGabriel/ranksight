// Salons publics et privés (création VIP), « Jouer maintenant », capacité, historique ; aucun effet sur la cote compétitive.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addClips, cleanup, grantVip, newUser, sql, wait } from "./lib.mjs";

const GAME = "valorant";
let clips;
before(async () => {
  clips = await addClips(GAME, 30);
});
after(cleanup);

const ratingsOf = async (ids) => (await sql("SELECT count(*)::int AS n FROM competitive_ratings WHERE user_id = ANY($1::uuid[])", [ids]))[0].n;

test("création : réservée aux VIP (vérifié par le serveur), champs inconnus refusés", async () => {
  const free = await newUser("pub");
  for (const visibility of ["PRIVATE", "PUBLIC"]) {
    const res = await free.s.post("/rooms", { game: GAME, visibility });
    assert.equal(res.status, 402, `${visibility} sans VIP refusé`);
    assert.equal(res.body.code, "PREMIUM_REQUIRED");
  }
  const vip = await newUser("vip");
  await grantVip(vip.id);
  let r = await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.visibility, "PUBLIC");
  assert.equal(r.body.mode, "CLASSIC");
  r = await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC", confidence: true });
  assert.equal(r.status, 400, "mode Confiance supprimé : champ refusé");
  r = await vip.s.post("/rooms", { game: GAME, visibility: "PUBLIC", ranked: true });
  assert.equal(r.status, 400, "aucun champ « classé » accepté du client");
  r = await vip.s.post("/rooms", { game: GAME, visibility: "PRIVATE" });
  assert.equal(r.status, 201);
  assert.equal(r.body.visibility, "PRIVATE");
  r = await vip.s.post(`/rooms/${r.body.id}/close`);
  assert.equal(r.status, 204);
});

test("visibilité : le salon privé n'apparaît dans aucune liste et ne se rejoint pas sans code ni invitation", async () => {
  const host = await newUser("hst");
  await grantVip(host.id);
  const priv = (await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE" })).body;
  const other = await newUser("oth");
  const list = (await other.s.get(`/rooms/public?game=${GAME}`)).body;
  assert.ok(Array.isArray(list));
  assert.ok(!list.some((r) => r.id === priv.id), "privé absent de la liste");
  assert.ok(list.every((r) => !("code" in r)), "la liste ne donne aucun code");
  let r = await other.s.post(`/rooms/${priv.id}/join`);
  assert.equal(r.status, 404, "accès direct à un salon privé refusé");
  r = await other.s.get(`/rooms/${priv.id}`);
  assert.equal(r.status, 404, "détail d'un salon privé refusé à un non-membre");
  r = await other.s.post("/rooms/join", { code: priv.code });
  assert.equal(r.status, 200, "avec le code : accepté");
  // Code faux et code d'un salon fermé
  r = await other.s.post("/rooms/join", { code: "ZZZZ2222" });
  assert.equal(r.status, 404);
  r = await other.s.post("/rooms/join", { code: "abc" });
  assert.equal(r.status, 400, "code invalide");
  await host.s.post(`/rooms/${priv.id}/close`);
  const third = await newUser("thd");
  r = await third.s.post("/rooms/join", { code: priv.code });
  assert.equal(r.status, 404, "salon fermé : code expiré");
  // Salon public : visible, filtrable, rejoignable sans code
  const pub = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC", teamSize: 2 })).body;
  const filtered = (await third.s.get(`/rooms/public?game=${GAME}&mode=TEAMS_2&available=true`)).body;
  const entry = filtered.find((x) => x.id === pub.id);
  assert.ok(entry, "public visible avec le bon filtre");
  assert.equal(entry.mode, "TEAMS_2");
  assert.equal(entry.maxPlayers, 4);
  assert.ok(!(await third.s.get(`/rooms/public?game=${GAME}&mode=IMPOSTOR`)).body.some((x) => x.id === pub.id), "filtre de mode respecté");
  r = await third.s.post(`/rooms/${pub.id}/join`);
  assert.equal(r.status, 200);
  assert.equal(r.body.players.length, 2);
  r = await third.s.post(`/rooms/${pub.id}/join`);
  assert.equal(r.status, 200, "double clic : même salon");
  assert.equal(r.body.players.length, 2, "pas de double inscription");
});

test("capacité : la dernière place n'est attribuée qu'une fois (demandes simultanées)", async () => {
  const host = await newUser("cap");
  await grantVip(host.id);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC", teamSize: 2 })).body; // 4 places
  const two = await newUser("cp2");
  await two.s.post(`/rooms/${room.id}/join`);
  const three = await newUser("cp3");
  await three.s.post(`/rooms/${room.id}/join`);
  const rush = await Promise.all(Array.from({ length: 6 }, () => newUser("rsh")));
  const res = await Promise.all(rush.map((u) => u.s.post(`/rooms/${room.id}/join`)));
  assert.equal(res.filter((x) => x.status === 200).length, 1, res.map((x) => x.status).join(","));
  assert.ok(res.filter((x) => x.status !== 200).every((x) => x.body.code === "ROOM_FULL"));
  const [{ n }] = await sql("SELECT count(*)::int AS n FROM room_players WHERE room_id = $1 AND left_at IS NULL", [room.id]);
  assert.equal(n, 4, "jamais plus de joueurs que de places");
  const late = await newUser("lat");
  const full = await late.s.post(`/rooms/${room.id}/join`);
  assert.equal(full.status, 409);
  assert.equal(full.body.code, "ROOM_FULL");
});

test("Jouer maintenant : salon public compatible (salons gratuits compris), jamais un privé ni un autre mode, capacité tenue", async () => {
  // Un salon privé compatible n'est jamais proposé
  const vip = await newUser("qpv");
  await grantVip(vip.id);
  const priv = (await vip.s.post("/rooms", { game: GAME, visibility: "PRIVATE", teamSize: 3 })).body;
  const solo = await newUser("qp0");
  let r = await solo.s.post("/rooms/quick-play", { game: GAME, mode: "TEAMS_3" });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.room?.id, priv.id, "le salon privé n'est pas proposé");
  if (r.body.room) {
    assert.equal(r.body.room.visibility, "PUBLIC");
    assert.equal(r.body.room.mode, "TEAMS_3");
    await solo.s.post(`/rooms/${r.body.room.id}/leave`);
  }
  await vip.s.post(`/rooms/${priv.id}/close`);
  // Beaucoup de joueurs en même temps : jamais plus de joueurs que de places, jamais deux fois le même joueur
  const crowd = await Promise.all(Array.from({ length: 14 }, () => newUser("qpc")));
  const results = await Promise.all(crowd.map((u) => u.s.post("/rooms/quick-play", { game: GAME, mode: "TEAMS_3" })));
  assert.ok(results.every((x) => x.status === 200), results.map((x) => `${x.status}:${x.body.code ?? ""}`).join(","));
  const rooms = [...new Set(results.filter((x) => x.body.room).map((x) => x.body.room.id))];
  for (const id of rooms) {
    const [{ n, max, size, vis }] = await sql(
      "SELECT (SELECT count(*)::int FROM room_players p WHERE p.room_id = r.id AND p.left_at IS NULL) AS n, r.max_players AS max, r.team_size AS size, r.visibility::text AS vis FROM rooms r WHERE r.id = $1",
      [id],
    );
    assert.ok(n <= max, `jamais plus de joueurs que de places (${n}/${max})`);
    assert.equal(size, 3, "jamais un autre mode");
    assert.equal(vis, "PUBLIC");
  }
  const [{ dup }] = await sql(
    "SELECT count(*)::int AS dup FROM (SELECT user_id FROM room_players WHERE user_id = ANY($1::uuid[]) AND left_at IS NULL GROUP BY user_id HAVING count(*) > 1) d",
    [crowd.map((u) => u.id)],
  );
  assert.equal(dup, 0, "aucun joueur inscrit dans deux salons");
  // Sans VIP, « Jouer maintenant » ne crée jamais de salon
  const other = await newUser("qpo");
  r = await other.s.post("/rooms/quick-play", { game: GAME, mode: "IMPOSTOR", create: true });
  assert.equal(r.status, 402);
  r = await other.s.post("/rooms/quick-play", { game: GAME, visibility: "PRIVATE" });
  assert.equal(r.status, 400, "« Jouer maintenant » n'accepte pas de visibilité");
});

test("départ du créateur, expulsion, fermeture", async () => {
  const host = await newUser("dep");
  await grantVip(host.id);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC" })).body;
  const [b, c] = await Promise.all([newUser("dpb"), newUser("dpc")]);
  await b.s.post(`/rooms/${room.id}/join`);
  await c.s.post(`/rooms/${room.id}/join`);
  let r = await b.s.post(`/rooms/${room.id}/kick/${c.id}`);
  assert.equal(r.status, 403, "seul l'hôte expulse");
  r = await host.s.post(`/rooms/${room.id}/kick/${c.id}`);
  assert.equal(r.status, 200);
  r = await c.s.post(`/rooms/${room.id}/join`);
  assert.equal(r.status, 403, "expulsé : ne peut pas revenir");
  r = await c.s.post("/rooms/quick-play", { game: GAME, mode: "CLASSIC" });
  assert.notEqual(r.body.room?.id, room.id, "ni par « Jouer maintenant »");
  r = await host.s.post(`/rooms/${room.id}/leave`);
  assert.equal(r.status, 204);
  r = await b.s.get(`/rooms/${room.id}`);
  assert.equal(r.body.isHost, true, "l'hôte parti : le joueur suivant devient hôte");
  r = await b.s.post(`/rooms/${room.id}/close`);
  assert.equal(r.status, 204);
  r = await b.s.get(`/rooms/${room.id}`);
  assert.equal(r.status, 404, "salle d'attente fermée : supprimée");
});

test("partie complète : résultats, historique, aucun effet sur la cote", async () => {
  const host = await newUser("ply");
  await grantVip(host.id); // créer un salon est réservé aux VIP
  const guest = await newUser("plg");
  let room = (await host.s.post("/rooms", { game: GAME, visibility: "PUBLIC", rounds: 3, roundSec: 20 })).body;
  await guest.s.post(`/rooms/${room.id}/join`);
  let r = await host.s.post(`/rooms/${room.id}/start`);
  assert.equal(r.status, 200);
  for (let round = 1; round <= 3; round++) {
    await sql("UPDATE rooms SET round_starts_at = (now() at time zone 'utc') - interval '1 second' WHERE id = $1", [room.id]);
    for (const [u, exact] of [[host, true], [guest, false]]) {
      const c = await u.s.get(`/rooms/${room.id}/next`);
      assert.equal(c.status, 200, JSON.stringify(c.body));
      await wait(1100);
      const rankId = exact ? clips.rankOf[c.body.id] : clips.ranks.find((x) => x.id !== clips.rankOf[c.body.id]).id;
      r = await u.s.post("/guesses", { playToken: c.body.playToken, rankId, watchedMs: 900 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.pending, true, "réponse en direct : rien n'est dévoilé");
    }
    await wait(300);
  }
  for (let i = 0; i < 20 && (await host.s.get(`/rooms/${room.id}`)).body.status !== "FINISHED"; i++) await wait(500);
  room = (await host.s.get(`/rooms/${room.id}`)).body;
  assert.equal(room.status, "FINISHED");
  assert.equal(room.players.find((p) => p.id === host.id).placement, 1);
  assert.equal(room.details.length, 3, "toutes les manches dévoilées à la fin");
  assert.equal(await ratingsOf([host.id, guest.id]), 0, "un salon ne crée ni ne modifie aucune cote");
  // Historique et statistiques (hors cote compétitive)
  const hist = (await host.s.get("/rooms/history")).body;
  assert.equal(hist.stats.played, 1);
  assert.equal(hist.stats.wins, 1);
  assert.deepEqual(hist.stats.byMode, [{ mode: "CLASSIC", played: 1, wins: 1 }]);
  assert.equal(hist.items[0].id, room.id);
  assert.equal(hist.items[0].placement, 1);
  const lost = (await guest.s.get("/rooms/history")).body;
  assert.equal(lost.stats.wins, 0);
});
