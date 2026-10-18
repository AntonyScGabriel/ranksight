import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateRoomInput, JoinRoomInput, ROOM_CODE_ALPHABET, formatRoomCode, normalizeRoomCode, placements, roomRoundSec } from "./rooms.js";

test("code de salon : saisie souple, caractères ambigus refusés", () => {
  assert.equal(normalizeRoomCode("k7qm-2xpa"), "K7QM2XPA");
  assert.equal(normalizeRoomCode(" K7QM 2XPA "), "K7QM2XPA");
  assert.equal(normalizeRoomCode("K7QM2XP"), null);
  assert.equal(normalizeRoomCode("K7QM2XP0"), null, "0 n'est pas dans l'alphabet");
  assert.equal(normalizeRoomCode("K7QM2XPI"), null, "I n'est pas dans l'alphabet");
  assert.equal(formatRoomCode("K7QM2XPA"), "K7QM-2XPA");
  assert.ok(!/[01ILO]/.test(ROOM_CODE_ALPHABET));
});

test("places finales : égalités partagées", () => {
  const p = placements([{ id: "a", score: 120 }, { id: "b", score: 300 }, { id: "c", score: 120 }, { id: "d", score: 0 }]);
  assert.deepEqual([p.get("b"), p.get("a"), p.get("c"), p.get("d")], [1, 2, 2, 4]);
  const tie = placements([{ id: "a", score: 0 }, { id: "b", score: 0 }]);
  assert.deepEqual([tie.get("a"), tie.get("b")], [1, 1]);
});

test("durée de manche : jamais moins que le clip + 10 s", () => {
  assert.equal(roomRoundSec(12, 30), 30);
  assert.equal(roomRoundSec(55.2, 30), 66);
  assert.equal(roomRoundSec(5, 20), 20);
});

test("création : paramètres proposés uniquement, aucun champ ajouté par le client", () => {
  assert.deepEqual(CreateRoomInput.parse({ game: "valorant" }), { game: "valorant", visibility: "PRIVATE", rounds: 5, roundSec: 30, suddenDeath: false, teamSize: 0, impostor: false });
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", rounds: 4 }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", roundSec: 5 }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "fortnite" }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", isVip: true }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", impostor: true, teamSize: 2 }).success, false, "Intrus : chacun pour soi");
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", confidence: true }).success, false, "mode Confiance supprimé : champ refusé");
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", visibility: "PUBLIC" }).success, true);
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", visibility: "SECRET" }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", ranked: true }).success, false, "aucun champ « classé » accepté du client");
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", impostor: true }).success, true);
  assert.equal(JoinRoomInput.parse({ code: "k7qm-2xpa" }).code, "K7QM2XPA");
  assert.equal(JoinRoomInput.safeParse({ code: "nope" }).success, false);
});

test("modes de salon : déduits des paramètres et réciproques", async () => {
  const { roomMode, modeSettings, ROOM_MODES, QuickPlayInput, PublicRoomsQuery } = await import("./rooms.js");
  for (const mode of ROOM_MODES) assert.equal(roomMode({ ...modeSettings(mode), teamSize: modeSettings(mode).teamSize || null }), mode);
  assert.equal(roomMode({ teamSize: null, impostor: false }), "CLASSIC");
  assert.deepEqual(QuickPlayInput.parse({ game: "valorant" }), { game: "valorant", mode: "CLASSIC", create: false });
  assert.equal(QuickPlayInput.safeParse({ game: "valorant", visibility: "PRIVATE" }).success, false, "jamais de salon privé via « Jouer maintenant »");
  assert.deepEqual(PublicRoomsQuery.parse({ available: "true", mode: "IMPOSTOR" }), { available: true, mode: "IMPOSTOR" });
  assert.deepEqual(PublicRoomsQuery.parse({}), { available: false });
});

test("salons par défaut : un emplacement par mode et par numéro", async () => {
  const { roomSystemSlot, ROOM_MODES, ROOM_SYSTEM_SLOTS } = await import("./rooms.js");
  const slots = ROOM_MODES.flatMap((m) => Array.from({ length: ROOM_SYSTEM_SLOTS }, (_, i) => roomSystemSlot(m, i + 1)));
  assert.equal(ROOM_SYSTEM_SLOTS, 2);
  assert.equal(new Set(slots).size, ROOM_MODES.length * 2, "emplacements distincts");
  assert.ok(slots.every((s) => s.length <= 32), "tient dans la colonne system_slot");
});

test("mort subite : 3 finalistes au plus, choisis par rangs exacts, vitesse puis arrivée", async () => {
  const { pickFinalists, SUDDEN_DEATH_MAX_FINALISTS } = await import("./room-rules.js");
  const t = (s: number) => new Date(Date.UTC(2026, 9, 17, 0, 0, s));
  assert.equal(SUDDEN_DEATH_MAX_FINALISTS, 3);
  // Trois ou moins : tous
  assert.deepEqual(pickFinalists([{ id: "a", exact: 0, avgResponseMs: null, joinedAt: t(0) }, { id: "b", exact: 1, avgResponseMs: 10, joinedAt: t(1) }]), ["a", "b"]);
  const players = [
    { id: "lent", exact: 2, avgResponseMs: 9000, joinedAt: t(0) },
    { id: "exact3", exact: 3, avgResponseMs: 20000, joinedAt: t(5) },
    { id: "rapide", exact: 2, avgResponseMs: 4000, joinedAt: t(9) },
    { id: "ancien", exact: 1, avgResponseMs: 1000, joinedAt: t(1) },
    { id: "sansTemps", exact: 2, avgResponseMs: null, joinedAt: t(2) },
  ];
  assert.deepEqual(pickFinalists(players), ["exact3", "rapide", "lent"], "rangs exacts, puis temps moyen");
  // Même nombre de rangs exacts et même temps : le premier arrivé passe
  const same = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, exact: 1, avgResponseMs: 5000, joinedAt: t(10 - i) }));
  assert.deepEqual(pickFinalists(same), ["p4", "p3", "p2"]);
  // Déterministe : l'ordre d'entrée ne change rien
  assert.deepEqual(pickFinalists([...players].reverse()), pickFinalists(players));
});

test("clips nécessaires : un par manche, deux en mode Intrus", async () => {
  const { roomClipsNeeded, modeSettings, ROOM_DEFAULT_ROUNDS } = await import("./rooms.js");
  assert.equal(roomClipsNeeded({ rounds: ROOM_DEFAULT_ROUNDS, ...modeSettings("CLASSIC") }), ROOM_DEFAULT_ROUNDS);
  assert.equal(roomClipsNeeded({ rounds: 5, ...modeSettings("TEAMS_3") }), 5);
  assert.equal(roomClipsNeeded({ rounds: 5, ...modeSettings("IMPOSTOR") }), 10);
});

test("salons par défaut : rotation des jeux, jeux sans assez de clips passés", async () => {
  const { nextSystemGame } = await import("./rooms.js");
  const games = ["lol", "valorant", "rocket-league", "cs2"];
  const all = new Set(games);
  // Premier salon : décalé d'un jeu par emplacement
  assert.equal(nextSystemGame(games, all, null, 1), "lol");
  assert.equal(nextSystemGame(games, all, null, 2), "valorant");
  // Rotation : le jeu suivant celui du dernier salon, en boucle
  assert.equal(nextSystemGame(games, all, "lol", 1), "valorant");
  assert.equal(nextSystemGame(games, all, "cs2", 1), "lol");
  // Jeu sans assez de clips : passé
  assert.equal(nextSystemGame(games, new Set(["lol", "cs2"]), "lol", 1), "cs2");
  // L'autre salon du même mode propose déjà ce jeu : le suivant, s'il y en a un
  assert.equal(nextSystemGame(games, all, "lol", 1, ["valorant"]), "rocket-league");
  assert.equal(nextSystemGame(games, new Set(["valorant"]), "lol", 1, ["valorant"]), "valorant", "seul jeu jouable : proposé quand même");
  // Dernier jeu retiré ou désactivé : rotation reprise comme au premier salon
  assert.equal(nextSystemGame(games, all, "fortnite", 2), "valorant");
  // Aucun jeu jouable : pas de salon
  assert.equal(nextSystemGame(games, new Set(), "lol", 1), null);
  assert.equal(nextSystemGame([], all, null, 1), null);
  // Les quatre jeux sont proposés tour à tour
  const seen: (string | null)[] = [];
  let last: string | null = null;
  for (let i = 0; i < 4; i++) seen.push((last = nextSystemGame(games, all, last, 1)));
  assert.deepEqual([...seen].sort(), [...games].sort());
});

test("hôte perdu pendant une absence : message seulement si un autre joueur a vraiment pris le relais", async () => {
  const { hostLostNotice, ROOM_HOST_AWAY_SEC } = await import("./rooms.js");
  const me = { id: "me", displayName: "Moi", isHost: true, left: false };
  const bob = { id: "bob", displayName: "Bob", isHost: false, left: false };
  const lobby = (isHost: boolean, players: (typeof me)[], extra: Partial<{ status: "LOBBY" | "ACTIVE" | "FINISHED" | "CLOSED"; left: boolean; id: string }> = {}) =>
    ({ id: "r1", status: "LOBBY" as const, isHost, left: false, players, ...extra });
  const before = lobby(true, [me, bob]);
  const moved = lobby(false, [{ ...me, isHost: false }, { ...bob, isHost: true }]);
  const msg = hostLostNotice(before, moved, "me");
  assert.ok(msg && msg.includes("Bob") && msg.includes(`${ROOM_HOST_AWAY_SEC} secondes`), String(msg));
  // Coupure courte : toujours hôte côté serveur → aucun message
  assert.equal(hostLostNotice(before, before, "me"), null);
  // Premier chargement (aucun état connu), ou n'était pas hôte
  assert.equal(hostLostNotice(null, moved, "me"), null);
  assert.equal(hostLostNotice(lobby(false, [me, bob]), moved, "me"), null);
  // Partie lancée ou terminée entre-temps, autre salon, joueur sorti
  assert.equal(hostLostNotice(before, { ...moved, status: "ACTIVE" }, "me"), null);
  assert.equal(hostLostNotice({ ...before, status: "ACTIVE" }, moved, "me"), null);
  assert.equal(hostLostNotice(before, { ...moved, id: "r2" }, "me"), null);
  assert.equal(hostLostNotice(before, { ...moved, left: true }, "me"), null);
  assert.equal(hostLostNotice(before, lobby(false, [{ ...bob, isHost: true }]), "me"), null, "plus dans la liste des joueurs");
  // Personne d'autre n'est hôte (salon par défaut sans hôte) : rien à annoncer
  assert.equal(hostLostNotice(before, lobby(false, [{ ...me, isHost: false }, bob]), "me"), null);
});
