import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateTournamentInput, bracketSize, eliminatedPlacement, firstRoundPairs, nextSlot, seedOrder, stageCount } from "./tournaments.js";

test("tableau : taille, ordre des têtes de série, tours", () => {
  assert.deepEqual([3, 4, 5, 8, 9, 16].map(bracketSize), [4, 4, 8, 8, 16, 16]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.equal(seedOrder(16).length, 16);
  assert.deepEqual([...seedOrder(16)].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual([4, 8, 16].map(stageCount), [2, 3, 4]);
});

test("premier tour : les meilleures têtes de série sont qualifiées d'office", () => {
  assert.deepEqual(firstRoundPairs(3), [[1, null], [2, 3]]);
  assert.deepEqual(firstRoundPairs(5), [[1, null], [4, 5], [2, null], [3, null]]);
  const full = firstRoundPairs(8);
  assert.ok(full.every(([a, b]) => a !== null && b !== null));
  // Jamais deux places vides face à face
  for (let n = 3; n <= 16; n++) assert.ok(firstRoundPairs(n).every(([a, b]) => a !== null || b !== null), `n=${n}`);
});

test("places des éliminés et match suivant", () => {
  assert.deepEqual([1, 2, 3].map((s) => eliminatedPlacement(8, s)), [5, 3, 2]);
  assert.deepEqual([1, 2].map((s) => eliminatedPlacement(4, s)), [3, 2]);
  assert.deepEqual(nextSlot(1, 0), { stage: 2, slot: 0, side: 1 });
  assert.deepEqual(nextSlot(1, 3), { stage: 2, slot: 1, side: 2 });
});

test("création : réglages proposés uniquement", () => {
  assert.deepEqual(CreateTournamentInput.parse({ game: "lol" }), { game: "lol", capacity: 8, rounds: 3, roundSec: 30 });
  assert.equal(CreateTournamentInput.safeParse({ game: "lol", capacity: 6 }).success, false);
  assert.equal(CreateTournamentInput.safeParse({ game: "lol", rounds: 7 }).success, false);
  assert.equal(CreateTournamentInput.safeParse({ game: "lol", isVip: true }).success, false);
});
