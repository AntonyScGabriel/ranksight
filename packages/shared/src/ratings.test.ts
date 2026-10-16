import assert from "node:assert/strict";
import { test } from "node:test";
import { RATING_FLOOR, RatingScope, expectedScore, ratingDelta, ratingTier } from "./ratings.js";

test("Elo : à cote égale, +16 / -16 en provisoire, ±10 ensuite", () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  assert.equal(ratingDelta(1000, 1000, "WIN", 0), 16);
  assert.equal(ratingDelta(1000, 1000, "LOSS", 0), -16);
  assert.equal(ratingDelta(1000, 1000, "DRAW", 0), 0);
  assert.equal(ratingDelta(1000, 1000, "WIN", 20), 10);
});

test("Elo : battre plus fort rapporte plus, perdre contre plus faible coûte plus", () => {
  assert.ok(ratingDelta(1000, 1400, "WIN", 30) > ratingDelta(1000, 1000, "WIN", 30));
  assert.ok(ratingDelta(1400, 1000, "LOSS", 30) < ratingDelta(1000, 1000, "LOSS", 30));
  assert.ok(ratingDelta(1400, 1000, "WIN", 30) >= 0 && ratingDelta(1400, 1000, "WIN", 30) < 5);
  // Une victoire attendue rapporte peu, mais jamais une perte
  assert.ok(ratingDelta(2000, 800, "WIN", 30) >= 0);
});

test("Elo : plancher de cote", () => {
  assert.equal(ratingDelta(RATING_FLOOR + 5, RATING_FLOOR + 5, "LOSS", 30), -5, "-10 ramené au plancher");
  assert.equal(ratingDelta(RATING_FLOOR, RATING_FLOOR, "LOSS", 30), 0);
  assert.equal(ratingDelta(1000, 2500, "LOSS", 30), 0, "défaite attendue : rien à perdre");
});

test("paliers et périmètres", () => {
  assert.equal(ratingTier(1000).name, "Or");
  assert.equal(ratingTier(1550).name, "Maître");
  assert.equal(ratingTier(120).name, "Bronze");
  assert.equal(RatingScope.safeParse("global").success, true);
  assert.equal(RatingScope.safeParse("valorant").success, true);
  assert.equal(RatingScope.safeParse("fortnite").success, false);
});
