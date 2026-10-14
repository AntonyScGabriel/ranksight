import assert from "node:assert/strict";
import { test } from "node:test";
import { SeasonInput, SeasonKey, defaultSeasonRewards } from "./schemas.js";

test("récompenses proposées d'après le nom de la saison", () => {
  const r = defaultSeasonRewards("Saison 1");
  assert.equal(r.champion.name, "Champion saison 1");
  assert.equal(r.top10.name, "Top 10 saison 1");
  assert.equal(defaultSeasonRewards("Tournoi d'été").contributor.name, "Contributeur Tournoi d'été");
});

test("saison : dates, nom et récompenses validés", () => {
  const base = { name: "Saison 2", number: 2, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-30T23:59:59.999Z", rewardsEnabled: true, rewards: defaultSeasonRewards("Saison 2") };
  assert.equal(SeasonInput.safeParse(base).success, true);
  assert.equal(SeasonInput.safeParse({ ...base, number: null }).success, true);
  assert.equal(SeasonInput.safeParse({ ...base, endsAt: "2026-10-01T00:00:00.000Z" }).success, false);
  assert.equal(SeasonInput.safeParse({ ...base, name: "S" }).success, false);
  assert.equal(SeasonInput.safeParse({ ...base, rewards: { ...base.rewards, podium: { name: "Podium", color: "rouge" } } }).success, false);
});

test("clé de saison : anciennes clés mensuelles et nouvelles clés", () => {
  for (const k of ["2026-10", "saison-1", "saison-d-hiver"]) assert.equal(SeasonKey.safeParse(k).success, true, k);
  for (const k of ["Saison 1", "", "-saison", "a".repeat(33)]) assert.equal(SeasonKey.safeParse(k).success, false, k);
});
