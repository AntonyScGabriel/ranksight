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

test("accès VIP des salons : public classique gratuit, privé, mode VIP et options avancées réservés", async () => {
  const { roomVipRules, ROOM_DEFAULT_ROUNDS, ROOM_DEFAULT_TIME } = await import("./rooms.js");
  const std = { rounds: ROOM_DEFAULT_ROUNDS, roundSec: ROOM_DEFAULT_TIME };
  assert.deepEqual(roomVipRules({ visibility: "PUBLIC", suddenDeath: false, ...std }), { vipMode: false, advanced: false, hostVip: false }, "public classique : gratuit");
  assert.deepEqual(roomVipRules({ visibility: "PRIVATE", suddenDeath: false, ...std }), { vipMode: false, advanced: false, hostVip: true }, "privé : hôte VIP, invités gratuits");
  assert.deepEqual(roomVipRules({ visibility: "PUBLIC", suddenDeath: true, ...std }), { vipMode: true, advanced: false, hostVip: true }, "mort subite : mode VIP même en public");
  assert.equal(roomVipRules({ visibility: "PUBLIC", suddenDeath: false, rounds: 10, roundSec: ROOM_DEFAULT_TIME }).hostVip, true, "manches : option avancée");
  assert.equal(roomVipRules({ visibility: "PUBLIC", suddenDeath: false, rounds: ROOM_DEFAULT_ROUNDS, roundSec: 60 }).advanced, true, "temps : option avancée");
  assert.equal(roomVipRules({ visibility: "PRIVATE", suddenDeath: true, ...std, tournament: true }).vipMode, false, "match de tournoi : règles du tournoi");
});
