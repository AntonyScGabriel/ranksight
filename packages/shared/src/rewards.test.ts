import { test } from "node:test";
import assert from "node:assert/strict";
import { findBannedWord, isReservedPseudo, normalizeForFilter, pseudoBannedWord } from "./rewards.js";

test("normalisation : accents, majuscules, chiffres et lettres répétées", () => {
  assert.equal(normalizeForFilter("CRÉÉÉTIN"), "cretin");
  assert.equal(normalizeForFilter("n00b"), "nob");
});

test("filtre de mots : mot entier, variantes et faux positifs", () => {
  const banned = ["crétin", "gros naze"];
  assert.equal(findBannedWord("t'es un CR3TIN", banned), "crétin");
  assert.equal(findBannedWord("c.r.e.t.i.n !", banned), "crétin");
  assert.equal(findBannedWord("un gros   naze", banned), "gros naze");
  assert.equal(findBannedWord("une crétinerie", banned), null);
  assert.equal(findBannedWord("bien joué", banned), null);
  assert.equal(findBannedWord("n'importe quoi", []), null);
});

test("pseudos réservés", () => {
  for (const p of ["Admin", "ADM1N", "RankGuess_Officiel", "Modo", "Paul_Modo", "Administrateur", "Staff42"]) assert.equal(isReservedPseudo(p), true, p);
  for (const p of ["Commodore", "Paul", "Badminton", "Moderne", "Teamspirit", "Robotnik"]) assert.equal(isReservedPseudo(p), false, p);
});

test("mots interdits dans un pseudo", () => {
  assert.equal(pseudoBannedWord("XxCr3tinxX", ["crétin"]), "crétin");
  assert.equal(pseudoBannedWord("Connor", ["con"]), null);
  assert.equal(pseudoBannedWord("Con", ["con"]), "con");
});
