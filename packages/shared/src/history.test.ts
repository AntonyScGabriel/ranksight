import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerHistoryQuery, guessResultOf } from "./history.js";
import { scoreForDistance } from "./scoring.js";

test("résultat d'une réponse : exact, proche (des points), manqué (0 point)", () => {
  assert.equal(guessResultOf(0), "exact");
  for (const d of [1, 2]) {
    assert.equal(guessResultOf(d), "close");
    assert.ok(scoreForDistance(d) > 0);
  }
  for (const d of [3, 7]) {
    assert.equal(guessResultOf(d), "miss");
    assert.equal(scoreForDistance(d), 0);
  }
});

test("filtres de l'historique : valeurs par défaut et validation", () => {
  assert.deepEqual(PlayerHistoryQuery.parse({}), { page: 1 });
  const q = PlayerHistoryQuery.parse({ page: "3", game: "lol", mode: "DAILY", result: "exact", from: "2026-10-01", to: "2026-10-13" });
  assert.equal(q.page, 3);
  assert.equal(q.mode, "DAILY");
  for (const bad of [{ page: "0" }, { result: "bof" }, { mode: "RANKED" }, { game: "fortnite" }, { from: "13/10/2026" }, { from: "2026-10-13", to: "2026-10-01" }]) {
    assert.equal(PlayerHistoryQuery.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("filtres de l'historique : réponses citées par un indicateur", () => {
  const a = "01a10ea0-9084-70fb-90c3-e71b95e204c3", b = "01a10ea0-909d-76fa-9a39-a431419e5b2f";
  assert.deepEqual(PlayerHistoryQuery.parse({ ids: `${a}, ${b}` }).ids, [a, b]);
  assert.equal(PlayerHistoryQuery.safeParse({ ids: "pas-un-identifiant" }).success, false);
});
