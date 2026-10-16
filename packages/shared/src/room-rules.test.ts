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

test("équipes : totaux, mort subite et places", async () => {
  const { teamTotals, teamSuddenDeathEntry, teamPlacements, suddenDeathOutcome } = await import("./room-rules.js");
  const totals = teamTotals([{ team: 1, score: 100 }, { team: 1, score: 20 }, { team: 2, score: 100 }, { team: 2, score: 5 }, { team: null, score: 999 }]);
  assert.deepEqual(totals, [{ id: "1", score: 120 }, { id: "2", score: 105 }]);
  assert.deepEqual([...teamPlacements(totals)], [["1", 1], ["2", 2]]);
  assert.deepEqual([...teamPlacements([{ id: "1", score: 50 }, { id: "2", score: 50 }])], [["1", 1], ["2", 1]], "égalité : match nul");
  assert.deepEqual([...teamPlacements(totals, { winnerId: "2" })], [["1", 2], ["2", 1]]);
  const a = teamSuddenDeathEntry("1", [{ score: 100, responseMs: 2000 }, { score: 0, responseMs: 4000 }]);
  const b = teamSuddenDeathEntry("2", [{ score: 20, responseMs: 1000 }, { score: 80, responseMs: 1000 }]);
  assert.deepEqual(a, { id: "1", score: 100, responseMs: 3000 });
  assert.equal(teamSuddenDeathEntry("2", []).score, null);
  assert.deepEqual(suddenDeathOutcome([a, { ...b, score: 100 }], 3), { kind: "winner", winnerId: "2", decidedBy: "SPEED" }, "égalité : temps moyen le plus court");
});

test("Intrus : démasqué ou non", async () => {
  const { impostorBonuses, pickImpostor } = await import("./room-rules.js");
  const caught = impostorBonuses("x", [{ voterId: "a", targetId: "x" }, { voterId: "b", targetId: "x" }, { voterId: "c", targetId: "a" }, { voterId: "x", targetId: "b" }]);
  assert.equal(caught.caught, true);
  assert.deepEqual(caught.bonuses.map((b) => [b.userId, b.points]), [["a", 100], ["b", 100]]);
  const tie = impostorBonuses("x", [{ voterId: "a", targetId: "x" }, { voterId: "b", targetId: "c" }, { voterId: "c", targetId: "a" }, { voterId: "x", targetId: "c" }]);
  assert.equal(tie.caught, false, "égalité de votes avec un autre joueur : pas démasqué");
  assert.deepEqual(tie.bonuses, [{ userId: "x", points: 200, reason: "IMPOSTOR_HIDDEN" }]);
  assert.equal(impostorBonuses("x", []).caught, false, "aucun vote : pas démasqué");
  assert.equal(impostorBonuses("x", [{ voterId: "x", targetId: "x" }]).caught, false, "vote pour soi ignoré");
  // Rotation : personne n'est intrus deux fois tant que d'autres ne l'ont pas été
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) seen.push(pickImpostor(["a", "b", "c", "d"], seen, () => 0.99));
  assert.deepEqual([...seen].sort(), ["a", "b", "c", "d"]);
  assert.equal(pickImpostor(["a", "b"], ["a"], () => 0), "b");
});
