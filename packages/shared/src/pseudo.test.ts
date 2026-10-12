import assert from "node:assert/strict";
import { test } from "node:test";
import { Pseudo, pseudoKey } from "./schemas.js";

test("pseudo : accents et caractères spéciaux autorisés", () => {
  for (const p of ["Éric", "Chloé_42", "Zoë.B", "jean-luc", "Ñandú", "Мария"]) assert.equal(Pseudo.safeParse(p).success, true, p);
  for (const p of ["ab", "a b", "___", "x<script>", "abcdefghijklmnopqrstu"]) assert.equal(Pseudo.safeParse(p).success, false, p);
});

test("clé d'unicité : sans accents ni majuscules", () => {
  assert.equal(pseudoKey("Éric"), "eric");
  assert.equal(pseudoKey("ERIC"), pseudoKey("éric"));
  assert.equal(pseudoKey("Chloé_42"), "chloe_42");
  // Lettre accentuée écrite en deux caractères (e + accent) : même clé que la lettre précomposée
  assert.equal(pseudoKey("Éric"), "eric");
});
