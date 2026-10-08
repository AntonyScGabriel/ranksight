import { test } from "node:test";
import assert from "node:assert/strict";
import { levelFromXp, scoreForDistance, scoreGuess, scoreTable, xpForGuess } from "./scoring.js";

// Positions League of Legends : Iron 0, Bronze 1, Silver 2, Gold 3, Platinum 4, Emerald 5, Diamond 6,
// Master 7, Grandmaster 8, Challenger 9
const IRON = 0, BRONZE = 1, SILVER = 2, GOLD = 3, PLATINUM = 4, EMERALD = 5, DIAMOND = 6, CHALLENGER = 9;

test("clip Bronze", () => {
  assert.equal(scoreGuess(BRONZE, BRONZE).score, 100);
  assert.equal(scoreGuess(SILVER, BRONZE).score, 20);
  assert.equal(scoreGuess(IRON, BRONZE).score, 20);
  assert.equal(scoreGuess(GOLD, BRONZE).score, 5);
  assert.equal(scoreGuess(PLATINUM, BRONZE).score, 0);
  assert.equal(scoreGuess(CHALLENGER, BRONZE).score, 0);
});

test("clip Gold", () => {
  assert.equal(scoreGuess(GOLD, GOLD).score, 100);
  assert.equal(scoreGuess(SILVER, GOLD).score, 20);
  assert.equal(scoreGuess(PLATINUM, GOLD).score, 20);
  assert.equal(scoreGuess(BRONZE, GOLD).score, 5);
  assert.equal(scoreGuess(EMERALD, GOLD).score, 5);
  assert.equal(scoreGuess(DIAMOND, GOLD).score, 0);
  assert.equal(scoreGuess(IRON, GOLD).score, 0);
});

test("même règle pour toutes les échelles (Valorant, Rocket League, Counter-Strike 2)", () => {
  // Valorant : Immortal 7, Radiant 8
  assert.equal(scoreGuess(7, 8).score, 20);
  assert.equal(scoreGuess(5, 8).score, 0);
  // Rocket League : Supersonic Legend 7, Champion 5
  assert.equal(scoreGuess(5, 7).score, 5);
  // Counter-Strike 2 : paliers 0 → 6
  assert.equal(scoreGuess(0, 6).score, 0);
  assert.equal(scoreGuess(6, 6).distance, 0);
});

test("barème", () => {
  assert.deepEqual(scoreTable(), [100, 20, 5]);
  assert.equal(scoreForDistance(-2), 5);
  assert.equal(scoreForDistance(3), 0);
  assert.equal(scoreForDistance(12), 0);
});

test("bonus de série plafonné à +50 %", () => {
  assert.equal(xpForGuess(100, 0), 100);
  assert.equal(xpForGuess(100, 7), 135);
  assert.equal(xpForGuess(100, 99), 150);
  assert.equal(xpForGuess(0, 10), 0);
});

test("niveaux", () => {
  assert.equal(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(250).level, 2);
});
