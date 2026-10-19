// Tchat des salons (canal d'équipe compris) et des tournois, et tournois événements de l'administration (64 places,
// visibles par tous, récompense donnée une seule fois au vainqueur).
/* global setTimeout */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addClips, cleanup, grantVip, newUser, sql } from "./lib.mjs";

const GAME = "valorant";
before(async () => {
  await addClips(GAME, 30);
});
const events = [];
const cosmetics = [];
after(async () => {
  await sql("DELETE FROM tournaments WHERE id = ANY($1::uuid[])", [events]);
  await sql("DELETE FROM cosmetics WHERE id = ANY($1::uuid[])", [cosmetics]);
  await cleanup();
});

async function vipUser(prefix) {
  const u = await newUser(prefix);
  await grantVip(u.id);
  return u;
}
async function adminUser(prefix) {
  const u = await newUser(prefix);
  await sql("UPDATE users SET role = 'ADMIN' WHERE id = $1::uuid", [u.id]);
  return u;
}

test("tchat de salon : joueurs du salon seulement, canal d'équipe réservé à l'équipe, supprimé avec le salon", async () => {
  const [host, a, b, c, outsider] = await Promise.all([vipUser("ch1"), newUser("ch2"), newUser("ch3"), newUser("ch4"), newUser("ch5")]);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE", teamSize: 2 })).body;
  assert.ok(room.id, JSON.stringify(room));
  for (const u of [a, b, c]) assert.equal((await u.s.post("/rooms/join", { code: room.code })).status, 200);

  let r = await a.s.post(`/chat/game/room/${room.id}`, { body: "Salut tout le monde" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.team, null);
  assert.equal((await outsider.s.get(`/chat/game/room/${room.id}`)).status, 404, "hors du salon : rien");
  assert.equal((await outsider.s.post(`/chat/game/room/${room.id}`, { body: "intrus" })).status, 404);

  // Canal d'équipe : seulement les coéquipiers (après le délai minimum entre deux messages)
  await new Promise((res) => setTimeout(res, 2100));
  const teams = await sql("SELECT user_id, team FROM room_players WHERE room_id = $1::uuid", [room.id]);
  const teamOf = (id) => teams.find((t) => t.user_id === id).team;
  r = await a.s.post(`/chat/game/room/${room.id}`, { body: "On joue serré", team: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.team, teamOf(a.id));
  for (const u of [host, b, c]) {
    const chat = (await u.s.get(`/chat/game/room/${room.id}`)).body;
    assert.equal(chat.open, true);
    const seesTeam = chat.messages.some((m) => m.body === "On joue serré");
    assert.equal(seesTeam, teamOf(u.id) === teamOf(a.id), `${u.pseudo} : canal d'équipe ${seesTeam ? "visible" : "caché"}`);
    assert.ok(chat.messages.some((m) => m.body === "Salut tout le monde"));
  }

  // Joueur parti : il ne peut plus écrire
  assert.equal((await c.s.post(`/rooms/${room.id}/leave`)).status < 300, true);
  assert.equal((await c.s.post(`/chat/game/room/${room.id}`, { body: "Encore là ?" })).status, 404, "plus dans le salon");
  // Salle d'attente fermée par l'hôte : le salon et son tchat sont supprimés
  assert.equal((await host.s.post(`/rooms/${room.id}/close`)).status < 300, true);
  assert.equal((await a.s.get(`/chat/game/room/${room.id}`)).status, 404);
  assert.equal((await sql("SELECT count(*)::int AS n FROM game_chat_messages WHERE room_id = $1::uuid", [room.id]))[0].n, 0);
});

test("tchat de tournoi : inscrits seulement ; filtre anti-spam", async () => {
  const [host, a, outsider] = await Promise.all([vipUser("ct1"), newUser("ct2"), newUser("ct3")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 })).body;
  assert.equal((await a.s.post("/tournaments/join", { code: t.code })).status, 200);
  let r = await a.s.post(`/chat/game/tournament/${t.id}`, { body: "Bonne chance !" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await host.s.get(`/chat/game/tournament/${t.id}`)).body.messages.at(-1).body, "Bonne chance !");
  assert.equal((await outsider.s.get(`/chat/game/tournament/${t.id}`)).status, 404);
  r = await a.s.post(`/chat/game/tournament/${t.id}`, { body: "aaaaaaaaaaaaaaaaaaaa" });
  assert.equal(r.status, 400, "caractères répétés refusés");
});

test("événement : créé par un admin seulement, 64 places, visible et rejoignable par tous, récompense au vainqueur", async () => {
  const [admin, player] = await Promise.all([adminUser("ev1"), newUser("ev2")]);
  const [cosmetic] = await sql(
    "INSERT INTO cosmetics (id, key, type, name, color) VALUES (gen_random_uuid(), 'test-event-' || gen_random_uuid(), 'TITLE', 'Champion test', '#ffcc00') RETURNING id",
  );
  cosmetics.push(cosmetic.id);
  const body = { title: "Coupe de test", game: GAME, capacity: 64, rounds: 3, roundSec: 30, rewardCosmeticId: cosmetic.id, rewardVipDays: 7 };
  assert.equal((await player.s.post("/admin/tournaments", body)).status, 403, "joueur : refusé");
  assert.equal((await player.s.post("/tournaments", { ...body, title: undefined })).status, 400, "64 places hors événement : refusé");
  let r = await admin.s.post("/admin/tournaments", body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  events.push(id);

  // Visible par tous sans inscription, avec la récompense
  r = await player.s.get("/tournaments");
  assert.ok(r.body.events.some((e) => e.id === id && e.title === "Coupe de test" && e.reward.vipDays === 7), JSON.stringify(r.body.events));
  r = await player.s.get(`/tournaments/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.member, false);
  assert.equal(r.body.isEvent, true);
  assert.equal(r.body.reward.cosmetic.name, "Champion test");
  assert.equal((await player.s.post("/tournaments/join", { code: r.body.code })).status, 200);
  assert.equal((await player.s.get(`/tournaments/${id}`)).body.member, true);

  // Fin simulée : la récompense n'est donnée qu'une fois
  const others = await Promise.all([newUser("ev3"), newUser("ev4")]);
  for (const u of others) assert.equal((await u.s.post("/tournaments/join", { code: r.body.code })).status, 200);
  assert.equal((await admin.s.post(`/tournaments/${id}/start`)).status, 403, "événement : jamais lancé hors de l'administration");
  r = await admin.s.post(`/admin/tournaments/${id}/start`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.bracketSize, 4);
  const [final] = await sql("SELECT id FROM tournament_matches WHERE tournament_id = $1::uuid AND stage = 2", [id]);
  assert.ok(final);
  // Les autres matchs sont joués : on pose directement les finalistes et on termine la finale par forfait
  await sql("UPDATE tournament_matches SET winner_id = COALESCE(player1_id, player2_id), finished_at = now(), deadline_at = NULL, decided_by = 'FORFEIT' WHERE tournament_id = $1::uuid AND stage = 1 AND winner_id IS NULL", [id]);
  await sql("UPDATE tournament_matches SET player1_id = $2::uuid, player2_id = $3::uuid, deadline_at = now() - interval '1 minute', ready1_at = now() WHERE id = $1::uuid", [final.id, player.id, others[0].id]);
  let row;
  for (let i = 0; i < 20; i++) {
    [row] = await sql("SELECT status, reward_granted_at FROM tournaments WHERE id = $1::uuid", [id]);
    if (row.reward_granted_at) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  assert.equal(row.status, "FINISHED");
  assert.ok(row.reward_granted_at, "récompense donnée");
  const owned = await sql("SELECT 1 FROM user_cosmetics WHERE user_id = $1::uuid AND cosmetic_id = $2::uuid", [player.id, cosmetic.id]);
  assert.equal(owned.length, 1, "titre donné au vainqueur");
  const [sub] = await sql("SELECT status FROM subscriptions WHERE user_id = $1::uuid", [player.id]);
  assert.equal(sub?.status, "ACTIVE", "jours de VIP donnés");
});

test("tournoi public : listé et consultable sans code ; un seul tournoi en attente par créateur", async () => {
  const [host, other] = await Promise.all([vipUser("tp1"), newUser("tp2")]);
  let r = await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3, visibility: "PUBLIC" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = r.body;
  assert.equal(t.visibility, "PUBLIC");
  r = await other.s.get("/tournaments");
  assert.ok(r.body.public.some((x) => x.id === t.id), "listé dans les tournois publics");
  r = await other.s.get(`/tournaments/${t.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.member, false);
  // Le créateur quitte son tournoi (resté ouvert grâce à l'autre inscrit) : il ne peut pas en recréer un
  assert.equal((await other.s.post("/tournaments/join", { code: t.code })).status, 200);
  assert.equal((await host.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  r = await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 });
  assert.equal(r.status, 409, "un seul tournoi en attente");
  assert.equal(r.body.code, "TOURNAMENT_ALREADY_WAITING");
});

test("modération du tchat de tournoi : l'organisateur supprime un message et réduit un joueur au silence", async () => {
  const [host, a, b] = await Promise.all([vipUser("tm1"), newUser("tm2"), newUser("tm3")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 })).body;
  for (const u of [a, b]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200);
  const msg = (await a.s.post(`/chat/game/tournament/${t.id}`, { body: "Message à retirer" })).body;
  assert.equal((await b.s.del(`/chat/game/tournament/${t.id}/messages/${msg.id}`)).status, 403, "un joueur ne supprime pas le message d'un autre");
  assert.equal((await host.s.del(`/chat/game/tournament/${t.id}/messages/${msg.id}`)).status, 204);
  assert.ok(!(await b.s.get(`/chat/game/tournament/${t.id}`)).body.messages.some((m) => m.id === msg.id), "message retiré");

  assert.equal((await b.s.post(`/chat/game/tournament/${t.id}/mute/${a.id}`, { muted: true })).status, 403, "un joueur ne réduit personne au silence");
  assert.equal((await host.s.post(`/chat/game/tournament/${t.id}/mute/${a.id}`, { muted: true })).status, 200);
  let chat = (await a.s.get(`/chat/game/tournament/${t.id}`)).body;
  assert.equal(chat.muted, true);
  assert.equal(chat.open, false);
  assert.equal((await a.s.post(`/chat/game/tournament/${t.id}`, { body: "Je peux parler ?" })).status, 403);
  assert.equal((await host.s.get(`/tournaments/${t.id}`)).body.players.find((p) => p.id === a.id).chatMuted, true);
  assert.equal((await host.s.post(`/chat/game/tournament/${t.id}/mute/${a.id}`, { muted: false })).status, 200);
  chat = (await a.s.get(`/chat/game/tournament/${t.id}`)).body;
  assert.equal(chat.muted, false);
  assert.equal(chat.canModerate, false);
  assert.equal((await host.s.get(`/chat/game/tournament/${t.id}`)).body.canModerate, true);
});
test("événement : un inscrit VIP ne prend jamais l'organisation à la place de l'administration", async () => {
  const [admin, vip] = await Promise.all([adminUser("eh1"), vipUser("eh2")]);
  const r = await admin.s.post("/admin/tournaments", { title: "Coupe organisée", game: GAME, capacity: 8, rounds: 3, roundSec: 30 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  events.push(r.body.id);
  assert.equal((await vip.s.post("/tournaments/join", { code: r.body.code })).status, 200);
  const claim = await vip.s.post(`/tournaments/${r.body.id}/claim-host`);
  assert.equal(claim.status, 409, JSON.stringify(claim.body));
  assert.equal((await vip.s.get(`/chat/game/tournament/${r.body.id}`)).body.canModerate, false);
  assert.equal((await admin.s.get(`/chat/game/tournament/${r.body.id}`)).body.canModerate, true, "l'organisateur de l'événement modère toujours");
});

test("tchat de tournoi : silence gardé après un départ puis un retour ; l'organisateur parti perd ses droits", async () => {
  const [host, a, b] = await Promise.all([vipUser("tq1"), newUser("tq2"), newUser("tq3")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 })).body;
  for (const u of [a, b]) assert.equal((await u.s.post("/tournaments/join", { code: t.code })).status, 200);
  assert.equal((await host.s.post(`/chat/game/tournament/${t.id}/mute/${a.id}`, { muted: true })).status, 200);
  assert.equal((await a.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  assert.equal((await a.s.post("/tournaments/join", { code: t.code })).status, 200);
  assert.equal((await a.s.get(`/chat/game/tournament/${t.id}`)).body.muted, true, "toujours réduit au silence");
  assert.equal((await a.s.post(`/chat/game/tournament/${t.id}`, { body: "Me revoilà" })).status, 403);

  // L'organisateur part sans inscrit VIP pour le remplacer : il ne lit plus, n'écrit plus et ne modère plus le tchat
  const msg = (await b.s.post(`/chat/game/tournament/${t.id}`, { body: "Message de b" })).body;
  assert.equal((await host.s.post(`/tournaments/${t.id}/leave`)).status, 204);
  assert.equal((await host.s.get(`/chat/game/tournament/${t.id}`)).status, 404);
  assert.equal((await host.s.post(`/chat/game/tournament/${t.id}`, { body: "Toujours là" })).status, 404);
  assert.equal((await host.s.del(`/chat/game/tournament/${t.id}/messages/${msg.id}`)).status, 404);
  assert.equal((await host.s.post(`/chat/game/tournament/${t.id}/mute/${b.id}`, { muted: true })).status, 403);
});

test("tchat de salon : l'équipe de modération lit et supprime un message sans être dans le salon", async () => {
  const [host, mod] = await Promise.all([vipUser("rm1"), adminUser("rm2")]);
  const room = (await host.s.post("/rooms", { game: GAME, visibility: "PRIVATE" })).body;
  assert.ok(room.id, JSON.stringify(room));
  const msg = (await host.s.post(`/chat/game/room/${room.id}`, { body: "Message à modérer" })).body;
  assert.equal((await mod.s.get(`/chat/game/room/${room.id}`)).status, 200);
  assert.equal((await mod.s.post(`/chat/game/room/${room.id}`, { body: "Je n'y joue pas" })).status, 403, "lecture seule pour l'équipe");
  assert.equal((await mod.s.del(`/chat/game/room/${room.id}/messages/${msg.id}`)).status, 204);
  assert.equal((await host.s.del(`/rooms/${room.id}/active`)).status, 204, "écran du salon quitté");
});

test("un seul tournoi à la fois : inscription refusée tant qu'on participe à un autre tournoi", async () => {
  const [h1, h2, p] = await Promise.all([vipUser("to1"), vipUser("to2"), newUser("to3")]);
  const t1 = (await h1.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3, visibility: "PUBLIC" })).body;
  const t2 = (await h2.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3, visibility: "PUBLIC" })).body;
  assert.equal((await p.s.post("/tournaments/join", { code: t1.code })).status, 200);
  const r = await p.s.post("/tournaments/join", { code: t2.code });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "ALREADY_IN_TOURNAMENT");
  // Après avoir quitté le premier : inscription possible
  assert.equal((await p.s.post(`/tournaments/${t1.id}/leave`)).status, 204);
  assert.equal((await p.s.post("/tournaments/join", { code: t2.code })).status, 200);
  // Un créateur inscrit à un autre tournoi ne peut pas en créer un
  assert.equal((await h1.s.post("/tournaments/join", { code: t2.code })).status, 409, "h1 participe déjà à son propre tournoi");
});
test("événement programmé : lancé tout seul à l'heure prévue, fermé s'il manque des inscrits", async () => {
  const admin = await adminUser("es1");
  const startsAt = new Date(Date.now() + 10 * 60_000).toISOString();
  let r = await admin.s.post("/admin/tournaments", { title: "Programmé", game: GAME, capacity: 8, rounds: 3, roundSec: 30, startsAt });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const full = r.body;
  events.push(full.id);
  r = await admin.s.post("/admin/tournaments", { title: "Trop tôt", game: GAME, capacity: 8, rounds: 3, roundSec: 30, startsAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(r.status, 400, "début dans moins de 5 minutes : refusé");
  const empty = (await admin.s.post("/admin/tournaments", { title: "Vide", game: GAME, capacity: 8, rounds: 3, roundSec: 30, startsAt })).body;
  events.push(empty.id);

  const players = await Promise.all([newUser("es2"), newUser("es3"), newUser("es4")]);
  for (const p of players) assert.equal((await p.s.post("/tournaments/join", { code: full.code })).status, 200);
  assert.equal((await players[0].s.get(`/tournaments/${full.id}`)).body.startsAt, startsAt);
  // L'heure arrive (avancée en base pour le test)
  await sql("UPDATE tournaments SET starts_at = now() - interval '1 second' WHERE id = ANY($1::uuid[])", [[full.id, empty.id]]);
  let a, b;
  for (let i = 0; i < 20; i++) {
    [a] = await sql("SELECT status FROM tournaments WHERE id = $1::uuid", [full.id]);
    [b] = await sql("SELECT status FROM tournaments WHERE id = $1::uuid", [empty.id]);
    if (a.status !== "LOBBY" && b.status !== "LOBBY") break;
    await new Promise((res) => setTimeout(res, 500));
  }
  assert.equal(a.status, "ACTIVE", "3 inscrits : lancé à l'heure");
  assert.equal(b.status, "CLOSED", "aucun inscrit : fermé");
});

test("signaler un message du tchat de tournoi : par un inscrit, avec la copie du message", async () => {
  const [host, a, outsider] = await Promise.all([vipUser("rp1"), newUser("rp2"), newUser("rp3")]);
  const t = (await host.s.post("/tournaments", { game: GAME, capacity: 4, rounds: 3 })).body;
  assert.equal((await a.s.post("/tournaments/join", { code: t.code })).status, 200);
  const msg = (await a.s.post(`/chat/game/tournament/${t.id}`, { body: "Message signalé" })).body;
  let r = await outsider.s.post("/reports/players", { targetUserId: a.id, reason: "HARASSMENT", gameMessageId: msg.id });
  assert.equal(r.status, 400, "hors du tournoi : refusé");
  r = await host.s.post("/reports/players", { targetUserId: a.id, reason: "HARASSMENT", gameMessageId: msg.id });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  const [report] = await sql("SELECT excerpt, game_message_id FROM chat_reports WHERE reporter_id = $1::uuid", [host.id]);
  assert.equal(report.excerpt, "Message signalé");
  assert.equal(report.game_message_id, msg.id);
  await sql("DELETE FROM chat_reports WHERE reporter_id = $1::uuid", [host.id]);
});