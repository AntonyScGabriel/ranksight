import assert from "node:assert/strict";
import { test } from "node:test";
import { finalPlacements, suddenDeathOutcome, tiedLeaders } from "./room-rules.js";

test("égalité en tête : finalistes de la mort subite", () => {
  assert.deepEqual(tiedLeaders([{ id: "a", score: 200 }, { id: "b", score: 200 }, { id: "c", score: 100 }]), ["a", "b"]);
  assert.deepEqual(tiedLeaders([{ id: "a", score: 200 }, { id: "b", score: 100 }]), []);
  assert.deepEqual(tiedLeaders([{ id: "a", score: 0 }]), []);
});

test("mort subite : meilleur score de la manche", () => {
  assert.deepEqual(suddenDeathOutcome([{ id: "a", score: 20, responseMs: 900 }, { id: "b", score: 100, responseMs: 5000 }], 1), { kind: "winner", winnerId: "b", decidedBy: "SUDDEN_DEATH" });
  assert.deepEqual(suddenDeathOutcome([{ id: "a", score: 0, responseMs: 900 }, { id: "b", score: null, responseMs: null }], 1), { kind: "winner", winnerId: "a", decidedBy: "SUDDEN_DEATH" }, "répondre (même 0) bat l'absence de réponse");
});

test("mort subite : nouvelle manche entre les seuls meilleurs, puis rapidité", () => {
  const entries = [{ id: "a", score: 100, responseMs: 4000 }, { id: "b", score: 100, responseMs: 2500 }, { id: "c", score: 20, responseMs: 100 }];
  assert.deepEqual(suddenDeathOutcome(entries, 1), { kind: "again", finalists: ["a", "b"] });
  assert.deepEqual(suddenDeathOutcome(entries, 3), { kind: "winner", winnerId: "b", decidedBy: "SPEED" });
  assert.deepEqual(suddenDeathOutcome([{ id: "a", score: null, responseMs: null }, { id: "b", score: null, responseMs: null }], 3), { kind: "shared", finalists: ["a", "b"] });
});

test("places finales", () => {
  const players = [
    { id: "a", score: 300, left: false }, { id: "b", score: 300, left: false }, { id: "c", score: 100, left: false },
    { id: "d", score: 100, left: false }, { id: "e", score: 500, left: true },
  ];
  const plain = finalPlacements(players);
  assert.deepEqual(["a", "b", "c", "d", "e"].map((id) => plain.get(id)), [1, 1, 3, 3, 5], "parti en cours de partie : après les autres");
  const sd = finalPlacements(players, { winnerId: "b", finalists: ["a", "b"] });
  assert.deepEqual(["a", "b", "c", "d", "e"].map((id) => sd.get(id)), [2, 1, 3, 3, 5]);
  const leftFinalist = finalPlacements([...players.slice(0, 4), { id: "b2", score: 300, left: true }], { winnerId: "a", finalists: ["a", "b2"] });
  assert.deepEqual(["a", "b", "c", "b2"].map((id) => leftFinalist.get(id)), [1, 2, 3, 5], "finaliste parti : classé avec les joueurs partis");
  const shared = finalPlacements(players, { sharedWinners: ["a", "b"], finalists: ["a", "b"] });
  assert.deepEqual(["a", "b", "c"].map((id) => shared.get(id)), [1, 1, 3]);
});
