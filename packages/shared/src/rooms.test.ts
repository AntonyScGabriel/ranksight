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
  assert.deepEqual(CreateRoomInput.parse({ game: "valorant" }), { game: "valorant", rounds: 5, roundSec: 30, suddenDeath: false, confidence: false, teamSize: 0 });
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", rounds: 4 }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", roundSec: 5 }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "fortnite" }).success, false);
  assert.equal(CreateRoomInput.safeParse({ game: "valorant", isVip: true }).success, false);
  assert.equal(JoinRoomInput.parse({ code: "k7qm-2xpa" }).code, "K7QM2XPA");
  assert.equal(JoinRoomInput.safeParse({ code: "nope" }).success, false);
});
