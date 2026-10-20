// Salons gratuits par défaut et jeux : seuls les jeux qui ont assez de clips acceptés pour le mode sont proposés
// (un clip par manche, deux en mode Intrus), les deux salons d'un même mode proposent des jeux différents quand c'est
// possible, la rotation passe au jeu suivant, une salle d'attente vide devenue injouable est remplacée (une salle occupée
// reste en place), et l'administration affiche les clips acceptés par jeu. Les quatre jeux sont couverts : League of
// Legends, Valorant, Rocket League, Counter-Strike 2.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ROOM_DEFAULT_ROUNDS, ROOM_MODES, modeSettings, nextSystemGame, roomClipsNeeded } from "@ranksight/shared";
import { addClips, cleanup, grantVip, newUser, sql, wait } from "./lib.mjs";

after(cleanup);

const GAMES = ["lol", "valorant", "rocket-league", "cs2"];
const NEED_CLASSIC = roomClipsNeeded({ rounds: ROOM_DEFAULT_ROUNDS, ...modeSettings("CLASSIC") });
const NEED_IMPOSTOR = roomClipsNeeded({ rounds: ROOM_DEFAULT_ROUNDS, ...modeSettings("IMPOSTOR") });
// Clips ajoutés par jeu : lol et cs2 jouables partout, valorant sans le mode Intrus, rocket-league dans aucun mode
const TARGET = { lol: NEED_IMPOSTOR + 2, valorant: NEED_CLASSIC + 1, "rocket-league": NEED_CLASSIC - 2, cs2: NEED_IMPOSTOR };
const expectedModes = (n) => ROOM_MODES.filter((m) => n >= roomClipsNeeded({ rounds: ROOM_DEFAULT_ROUNDS, ...modeSettings(m) }));

let ids; // slug → id
let order; // ids des jeux actifs, dans l'ordre d'affichage
const added = {}; // slug → clips ajoutés par ce fichier
const until = async (check, ms = 20_000) => {
  for (let t = 0; t < ms; t += 300) {
    const v = await check();
    if (v) return v;
    await wait(300);
  }
  return check();
};
const approved = async () => Object.fromEntries((await sql(
  `SELECT g.slug, count(c.id) FILTER (WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL)::int AS n
     FROM games g LEFT JOIN clips c ON c.game_id = g.id WHERE g.is_active GROUP BY g.slug`,
)).map((r) => [r.slug, r.n]));
const lobbies = () => sql(
  `SELECT r.id, r.system_slot AS slot, g.slug, (SELECT count(*)::int FROM room_players p WHERE p.room_id = r.id) AS players
     FROM rooms r JOIN games g ON g.id = r.game_id WHERE r.status = 'LOBBY' AND r.system_slot IS NOT NULL ORDER BY r.system_slot`,
);
const SLOTS = ROOM_MODES.flatMap((m) => [`${m}:1`, `${m}:2`]);
const modeOfSlot = (slot) => slot.split(":")[0];
/** Salles d'attente vides des salons par défaut : retirées pour repartir d'un état connu (le serveur les recrée) */
const resetEmptyLobbies = () => sql(
  "DELETE FROM rooms r WHERE r.status = 'LOBBY' AND r.system_slot IS NOT NULL AND NOT EXISTS (SELECT 1 FROM room_players p WHERE p.room_id = r.id)",
);
/** Un salon par emplacement jouable, chacun sur un jeu jouable pour son mode */
const playableSlots = (counts) => SLOTS.filter((s) => GAMES.some((g) => expectedModes(counts[g] ?? 0).includes(modeOfSlot(s))));

before(async () => {
  const games = await sql("SELECT id, slug FROM games WHERE is_active ORDER BY sort_order");
  ids = Object.fromEntries(games.map((g) => [g.slug, g.id]));
  order = games.map((g) => g.id);
  assert.deepEqual([...games.map((g) => g.slug)].sort(), [...GAMES].sort(), "les quatre jeux sont actifs");
  const base = await approved();
  for (const g of GAMES) assert.equal(base[g] ?? 0, 0, `base de test sans clip accepté sur ${g} (fichiers lancés l'un après l'autre)`);
  for (const g of GAMES) added[g] = await addClips(g, TARGET[g]);
  // Deux passages : un salon créé pendant l'ajout des clips (état intermédiaire) est retiré par le second
  await resetEmptyLobbies();
  await wait(5500);
  await resetEmptyLobbies();
});

test("chaque mode n'ouvre de salons gratuits que sur des jeux qui ont assez de clips ; deux jeux différents par mode", async () => {
  const counts = await approved();
  const expected = playableSlots(counts);
  assert.equal(expected.length, SLOTS.length, "tous les modes ont au moins un jeu jouable");
  const rows = await until(async () => {
    const r = await lobbies();
    return expected.every((s) => r.some((x) => x.slot === s)) ? r : null;
  });
  assert.ok(rows, `salons recréés : ${JSON.stringify(await lobbies())}`);
  for (const r of rows) {
    const mode = modeOfSlot(r.slot);
    assert.ok(expectedModes(counts[r.slug]).includes(mode), `${r.slot} sur ${r.slug} (${counts[r.slug]} clips) : jeu injouable pour ${mode}`);
    assert.notEqual(r.slug, "rocket-league", "Rocket League n'a pas assez de clips");
    if (mode === "IMPOSTOR") assert.ok(["lol", "cs2"].includes(r.slug), `Intrus : ${r.slug} n'a pas deux clips par manche`);
  }
  for (const mode of ROOM_MODES) {
    const pair = rows.filter((r) => modeOfSlot(r.slot) === mode).map((r) => r.slug);
    assert.equal(pair.length, 2, mode);
    assert.notEqual(pair[0], pair[1], `${mode} : deux salons sur deux jeux différents (${pair.join(", ")})`);
  }
});

test("administration : clips acceptés par jeu et modes jouables (quatre jeux)", async () => {
  const mod = await newUser("adm");
  await sql("UPDATE users SET role = 'MODERATOR' WHERE id = $1::uuid", [mod.id]);
  const free = await newUser("adf");
  assert.equal((await free.s.get("/admin/stats/overview")).status, 403, "réservé à l'équipe");
  const r = await mod.s.get("/admin/stats/overview");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const counts = await approved();
  const open = await lobbies();
  for (const slug of GAMES) {
    const g = r.body.games.find((x) => x.slug === slug);
    assert.ok(g, `${slug} affiché`);
    assert.equal(g.approvedClips, TARGET[slug], `${slug} : clips acceptés`);
    assert.equal(g.approvedClips, counts[slug]);
    assert.deepEqual(g.playableModes, expectedModes(TARGET[slug]), `${slug} : modes jouables`);
    assert.equal(g.systemLobbies, open.filter((x) => x.slug === slug).length, `${slug} : salons gratuits en attente`);
    assert.equal(typeof g.name, "string");
  }
  assert.deepEqual(r.body.games.find((x) => x.slug === "rocket-league").playableModes, []);
  assert.deepEqual(r.body.games.find((x) => x.slug === "valorant").playableModes, ["CLASSIC", "TEAMS_2", "TEAMS_3"]);
});

test("rotation : un salon par défaut lancé est remplacé sur le jeu suivant jouable", async () => {
  const rows = await lobbies();
  const target = rows.find((r) => r.slot === "CLASSIC:1");
  assert.ok(target && target.players === 0);
  const sibling = rows.find((r) => r.slot === "CLASSIC:2");
  const [a, b] = await Promise.all([newUser("ro1"), newUser("ro2")]);
  for (const u of [a, b]) assert.equal((await u.s.post(`/rooms/${target.id}/join`)).status, 200);
  const r = await a.s.post(`/rooms/${target.id}/start`);
  assert.equal(r.status, 200, `lancement : ${JSON.stringify(r.body)}`);
  const counts = await approved();
  const playable = new Set(GAMES.filter((g) => expectedModes(counts[g]).includes("CLASSIC")).map((g) => ids[g]));
  const want = nextSystemGame(order, playable, ids[target.slug], 1, sibling ? [ids[sibling.slug]] : []);
  const replacement = await until(async () => (await lobbies()).find((x) => x.slot === "CLASSIC:1") ?? null);
  assert.ok(replacement, "emplacement remplacé");
  assert.equal(ids[replacement.slug], want, `jeu suivant de la rotation (lancé : ${target.slug}, autre salon : ${sibling?.slug})`);
  assert.notEqual(replacement.slug, target.slug);
  assert.notEqual(replacement.slug, "rocket-league");
});

test("jeu qui perd ses clips : salles d'attente vides remplacées, salle occupée gardée, jamais de salon injouable", async () => {
  const before = await lobbies();
  const onCs2 = before.filter((r) => r.slug === "cs2" && r.players === 0);
  assert.ok(onCs2.length >= 1, `au moins un salon par défaut sur CS2 : ${JSON.stringify(before)}`);
  // Un joueur attend dans l'un d'eux : son salon reste en place
  const kept = onCs2[0];
  const waiting = await newUser("cs1");
  assert.equal((await waiting.s.post(`/rooms/${kept.id}/join`)).status, 200);
  // CS2 tombe sous le minimum de tous les modes (clips retirés par la modération)
  const ours = Object.keys(added.cs2.rankOf);
  await sql("UPDATE clips SET deleted_at = now() WHERE id = ANY($1::uuid[])", [ours.slice(0, ours.length - (NEED_CLASSIC - 1))]);
  assert.equal((await approved()).cs2, NEED_CLASSIC - 1);
  const settled = await until(async () => {
    const r = await lobbies();
    const emptyOnCs2 = r.filter((x) => x.slug === "cs2" && x.players === 0);
    return !emptyOnCs2.length && SLOTS.every((s) => r.some((x) => x.slot === s)) ? r : null;
  });
  assert.ok(settled, `salles vides sur CS2 remplacées : ${JSON.stringify(await lobbies())}`);
  assert.ok(settled.some((x) => x.id === kept.id), "la salle d'attente occupée est gardée");
  for (const r of settled.filter((x) => x.id !== kept.id)) {
    assert.ok(["lol", "valorant"].includes(r.slug) || (modeOfSlot(r.slot) === "IMPOSTOR" && r.slug === "lol"), `${r.slot} : ${r.slug}`);
    if (modeOfSlot(r.slot) === "IMPOSTOR") assert.equal(r.slug, "lol", "Intrus : seul jeu encore jouable");
  }
  // Le lancement de la salle occupée signale le manque de clips au lieu de démarrer une partie incomplète
  const other = await newUser("cs2");
  assert.equal((await other.s.post(`/rooms/${kept.id}/join`)).status, 200);
  if (modeOfSlot(kept.slot) === "CLASSIC") {
    const r = await waiting.s.post(`/rooms/${kept.id}/start`);
    assert.equal(r.status, 404);
    assert.equal(r.body.code, "NOT_ENOUGH_CLIPS");
  }
  // Une fois vide, elle est remplacée à son tour
  for (const u of [waiting, other]) assert.equal((await u.s.post(`/rooms/${kept.id}/leave`)).status, 204);
  const gone = await until(async () => ((await sql("SELECT 1 FROM rooms WHERE id = $1::uuid", [kept.id])).length ? null : true));
  assert.ok(gone, "salle vide et injouable retirée");
  assert.ok(await until(async () => ((await lobbies()).some((x) => x.slot === kept.slot && x.slug !== "cs2") ? true : null)), "emplacement recréé sur un jeu jouable");
});

test("création par un VIP : le mode Intrus exige deux clips par manche", async () => {
  const vip = await newUser("vi1");
  await grantVip(vip.id);
  // Valorant : assez pour 5 manches classiques, pas pour 5 manches d'Intrus
  let r = await vip.s.post("/rooms", { game: "valorant", visibility: "PRIVATE", impostor: true, rounds: ROOM_DEFAULT_ROUNDS });
  assert.equal(r.status, 404, JSON.stringify(r.body));
  assert.equal(r.body.code, "NOT_ENOUGH_CLIPS");
  r = await vip.s.post("/rooms", { game: "valorant", visibility: "PRIVATE", rounds: ROOM_DEFAULT_ROUNDS });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await vip.s.post("/rooms", { game: "rocket-league", visibility: "PRIVATE", rounds: ROOM_DEFAULT_ROUNDS });
  assert.equal(r.status, 404, "Rocket League : pas assez de clips");
});
