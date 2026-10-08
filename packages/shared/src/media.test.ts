import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMediaUrl } from "./schemas.js";

const FILE = "0f8f5a2c-1b2d-4c3e-9f00-123456789abc.webp";

test("photo de profil : rattachée à l'adresse de l'API du client", () => {
  const api = "http://192.168.1.20:4000/v1";
  assert.equal(resolveMediaUrl(`/v1/avatars/${FILE}`, api), `${api}/avatars/${FILE}`);
  assert.equal(resolveMediaUrl(`http://localhost:4000/v1/avatars/${FILE}`, api), `${api}/avatars/${FILE}`);
  assert.equal(resolveMediaUrl(`/v1/avatars/${FILE}`, "https://api.rankguess.fr/v1/"), `https://api.rankguess.fr/v1/avatars/${FILE}`);
});

test("autres médias : adresse absolue conservée, chemin relatif complété", () => {
  assert.equal(resolveMediaUrl("https://lh3.googleusercontent.com/a/photo", "http://localhost:4000/v1"), "https://lh3.googleusercontent.com/a/photo");
  assert.equal(resolveMediaUrl("/v1/media/clips/a.mp4", "http://localhost:4000/v1"), "http://localhost:4000/v1/media/clips/a.mp4");
});
