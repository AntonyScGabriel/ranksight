import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RATING_FLOOR, RATING_K, RATING_K_NEW, RATING_PROVISIONAL_GAMES, RATING_START, RATING_TIERS, RatingScope,
  expectedScore, ratingDelta, ratingK, ratingTier, seasonResetRating, tierByKey, tierProgress,
} from "./ratings.js";

test("cote initiale : 500, au seuil de l'Or", () => {
  assert.equal(RATING_START, 500);
  assert.equal(ratingTier(RATING_START).name, "Or");
});

test("Elo : à cote égale, +16 / -16 pendant le placement, ±10 ensuite", () => {
  assert.equal(expectedScore(500, 500), 0.5);
  assert.equal(ratingDelta(500, 500, "WIN", 0), 16);
  assert.equal(ratingDelta(500, 500, "LOSS", 0), -16);
  assert.equal(ratingDelta(500, 500, "DRAW", 0), 0);
  assert.equal(ratingDelta(500, 500, "WIN", 20), 10);
});

test("coefficient : élevé sur les 20 premiers duels, normal à partir du 21e", () => {
  assert.equal(RATING_PROVISIONAL_GAMES, 20);
  assert.equal(ratingK(0), RATING_K_NEW);
  assert.equal(ratingK(19), RATING_K_NEW, "20e duel (19 déjà joués) : encore provisoire");
  assert.equal(ratingK(20), RATING_K, "21e duel : coefficient normal");
  assert.ok(RATING_K_NEW > RATING_K);
});

test("Elo : battre plus fort rapporte plus, perdre contre plus faible coûte plus", () => {
  assert.ok(ratingDelta(500, 900, "WIN", 30) > ratingDelta(500, 500, "WIN", 30));
  assert.ok(ratingDelta(900, 500, "LOSS", 30) < ratingDelta(500, 500, "LOSS", 30));
  assert.ok(ratingDelta(900, 500, "WIN", 30) >= 0 && ratingDelta(900, 500, "WIN", 30) < 5);
  // Une victoire attendue rapporte peu, mais jamais une perte
  assert.ok(ratingDelta(1500, 300, "WIN", 30) >= 0);
});

test("Elo : plancher de cote", () => {
  assert.equal(ratingDelta(RATING_FLOOR + 5, RATING_FLOOR + 5, "LOSS", 30), -5, "-10 ramené au plancher");
  assert.equal(ratingDelta(RATING_FLOOR, RATING_FLOOR, "LOSS", 30), 0);
  assert.equal(ratingDelta(500, 2000, "LOSS", 30), 0, "défaite attendue : rien à perdre");
});

test("paliers : échelle unique, seuils inclusifs", () => {
  assert.deepEqual(RATING_TIERS.map((t) => [t.name, t.min]), [["Maître", 1000], ["Diamant", 800], ["Platine", 650], ["Or", 500], ["Argent", 350], ["Bronze", 100]]);
  assert.equal(ratingTier(1000).name, "Maître");
  assert.equal(ratingTier(999).name, "Diamant");
  assert.equal(ratingTier(800).name, "Diamant");
  assert.equal(ratingTier(649).name, "Or");
  assert.equal(ratingTier(350).name, "Argent");
  assert.equal(ratingTier(349).name, "Bronze");
  assert.equal(ratingTier(RATING_FLOOR).name, "Bronze");
  assert.equal(ratingTier(0).name, "Bronze", "sous le plancher : toujours Bronze");
  assert.equal(tierByKey("DIAMOND").min, 800);
});

test("progression vers le rang suivant", () => {
  assert.deepEqual(tierProgress(575), { tier: tierByKey("GOLD"), next: tierByKey("PLATINUM"), pointsToNext: 75, progress: 0.5 });
  assert.equal(tierProgress(500).progress, 0);
  assert.equal(tierProgress(1400).next, null, "Maître : pas de rang suivant");
  assert.equal(tierProgress(1400).pointsToNext, null);
});

test("réinitialisation de saison : seuil minimal du rang atteint", () => {
  assert.equal(seasonResetRating(870, true), 800, "Diamant → seuil du Diamant");
  assert.equal(seasonResetRating(560, true), 500, "Or → seuil de l'Or");
  assert.equal(seasonResetRating(400, true), 350, "Argent → seuil de l'Argent");
  assert.equal(seasonResetRating(200, true), RATING_FLOOR, "Bronze → plancher");
  assert.equal(seasonResetRating(1450, true), 1000, "au-delà du seuil du Maître (sans plafond) : seuil du Maître");
});

test("réinitialisation de saison : frontières des seuils", () => {
  assert.equal(seasonResetRating(800, true), 800, "exactement au seuil : reste dans ce rang");
  assert.equal(seasonResetRating(799, true), 650, "1 point sous le Diamant : seuil du Platine");
  assert.equal(seasonResetRating(1000, true), 1000);
  assert.equal(seasonResetRating(999, true), 800);
  assert.equal(seasonResetRating(500, true), 500);
  assert.equal(seasonResetRating(499, true), 350);
});

test("réinitialisation de saison : joueur non classé, jamais au-dessus de la cote de départ", () => {
  assert.equal(seasonResetRating(900, false), RATING_START, "Diamant sans assez de duels : pas de rang élevé attribué");
  assert.equal(seasonResetRating(560, false), 500);
  assert.equal(seasonResetRating(420, false), 350, "sous la cote de départ : seuil de son rang");
  assert.ok(seasonResetRating(900, false) <= seasonResetRating(900, true));
  // Jamais plus haut que la cote réelle d'un joueur classé, à cote égale
  for (let r = RATING_FLOOR; r <= 1600; r += 7) assert.ok(seasonResetRating(r, false) <= seasonResetRating(r, true) && seasonResetRating(r, true) <= r);
});

test("périmètres", () => {
  assert.equal(RatingScope.safeParse("global").success, true);
  assert.equal(RatingScope.safeParse("valorant").success, true);
  assert.equal(RatingScope.safeParse("fortnite").success, false);
});
