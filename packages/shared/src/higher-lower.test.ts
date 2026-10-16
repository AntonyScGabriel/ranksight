import assert from "node:assert/strict";
import { test } from "node:test";
import { AnswerHigherLowerInput, higherLowerCorrect } from "./higher-lower.js";

test("plus haut / plus bas : comparaison des rangs", () => {
  assert.equal(higherLowerCorrect(3, 5, "higher"), true);
  assert.equal(higherLowerCorrect(3, 5, "lower"), false);
  assert.equal(higherLowerCorrect(5, 3, "lower"), true);
  assert.equal(higherLowerCorrect(5, 3, "higher"), false);
});

test("plus haut / plus bas : réponse stricte", () => {
  assert.equal(AnswerHigherLowerInput.safeParse({ round: 1, choice: "higher" }).success, true);
  assert.equal(AnswerHigherLowerInput.safeParse({ round: 0, choice: "higher" }).success, false);
  assert.equal(AnswerHigherLowerInput.safeParse({ round: 1, choice: "same" }).success, false);
  assert.equal(AnswerHigherLowerInput.safeParse({ round: 1, choice: "higher", correct: true }).success, false);
});
