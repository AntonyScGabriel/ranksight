// En-tête X-App-Version de l'application mobile : accepté, noté avec l'appareil de la session (repérage des anciennes
// versions), jamais exigé (l'ancienne application, qui ne l'envoie pas, continue de fonctionner).
/* global fetch */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { after, test } from "node:test";
import { API, cleanup, newUser, sql } from "./lib.mjs";

after(cleanup);
const ip = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;

const login = (u, headers = {}) =>
  fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "okhttp/4.12.0", "X-Forwarded-For": ip, ...headers },
    body: JSON.stringify({ email: `${u.pseudo.toLowerCase()}@test.invalid`, password: "motdepasse-test-1", client: "mobile" }),
  });
const lastAgent = async (userId) =>
  (await sql("SELECT user_agent FROM refresh_tokens WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 1", [userId]))[0]?.user_agent;

test("application 0.2.0 : version notée sur la session ; ancienne application sans en-tête : acceptée", async () => {
  const u = await newUser("av");
  let r = await login(u, { "X-App-Version": "0.2.0" });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.ok(body.accessToken, "jetons de l'application");
  assert.equal(await lastAgent(u.id), "RankGuess/0.2.0 okhttp/4.12.0");
  // Requête authentifiée avec l'en-tête : rien ne change pour l'API
  const me = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${body.accessToken}`, "X-App-Version": "0.2.0" } });
  assert.equal(me.status, 200);

  r = await login(u);
  assert.equal(r.status, 200, "ancienne application (0.1.0, sans en-tête)");
  assert.equal(await lastAgent(u.id), "okhttp/4.12.0");

  r = await login(u, { "X-App-Version": "<script>9.9.9" });
  assert.equal(r.status, 200, "valeur invalide ignorée, pas refusée");
  assert.equal(await lastAgent(u.id), "okhttp/4.12.0");
});
