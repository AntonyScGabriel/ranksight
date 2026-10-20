// Profil : changement du mot de passe (l'actuel exigé, sessions fermées) et de l'adresse email (remplacée seulement
// une fois la nouvelle confirmée) ; administration : envoi du lien « Mot de passe oublié » à un joueur.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { cleanup, newUser, session, sql } from "./lib.mjs";

after(cleanup);

const OLD = "motdepasse-test-1";
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

test("mot de passe : l'actuel est exigé ; après le changement, les sessions sont fermées et le nouveau fonctionne", async () => {
  const u = await newUser("pw");
  const [{ email }] = await sql("SELECT email FROM users WHERE id = $1::uuid", [u.id]);
  let r = await u.s.post("/auth/password/change", { currentPassword: "mauvais-1", password: "nouveau-mdp-2", passwordConfirm: "nouveau-mdp-2" });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, "WRONG_PASSWORD");
  r = await u.s.post("/auth/password/change", { currentPassword: OLD, password: "nouveau-mdp-2", passwordConfirm: "autre-mdp-3" });
  assert.equal(r.status, 400, "confirmation différente");
  r = await u.s.post("/auth/password/change", { currentPassword: OLD, password: "nouveau-mdp-2", passwordConfirm: "nouveau-mdp-2" });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.equal((await u.s.get("/users/me")).status, 401, "session fermée");

  const s = session();
  assert.equal((await s.post("/auth/login", { email, password: OLD })).status, 401, "ancien mot de passe refusé");
  assert.equal((await s.post("/auth/login", { email, password: "nouveau-mdp-2" })).status, 200);
  assert.equal((await s.get("/users/me")).status, 200);
});

test("email : une adresse confirmée n'est remplacée qu'une fois la nouvelle confirmée par son lien", async () => {
  const [u, other] = await Promise.all([newUser("em"), newUser("eo")]);
  const [{ email: before }] = await sql("SELECT email FROM users WHERE id = $1::uuid", [u.id]);
  const [{ email: taken }] = await sql("SELECT email FROM users WHERE id = $1::uuid", [other.id]);
  const next = `nouvelle-${randomBytes(3).toString("hex")}@test.invalid`;

  assert.equal((await u.s.post("/auth/email/change", { email: next, password: "mauvais-1" })).status, 400, "mot de passe exigé");
  assert.equal((await u.s.post("/auth/email/change", { email: taken, password: OLD })).status, 409, "adresse d'un autre compte");
  let r = await u.s.post("/auth/email/change", { email: next, password: OLD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.pending, true);
  assert.equal((await u.s.get("/users/me")).body.email, before, "inchangée tant que le lien n'est pas ouvert");

  // Le jeton n'est conservé que sous forme de hash : on pose un jeton connu sur la demande envoyée
  const token = randomBytes(32).toString("base64url");
  const updated = await sql("UPDATE email_verification_tokens SET token_hash = $3 WHERE user_id = $1::uuid AND email = $2 AND used_at IS NULL RETURNING id", [u.id, next, sha256(token)]);
  assert.equal(updated.length, 1);
  assert.equal((await session().post("/auth/email/verify", { token })).status, 204);
  const me = (await u.s.get("/users/me")).body;
  assert.equal(me.email, next);
  assert.equal(me.emailVerified, true);
  assert.equal((await session().post("/auth/email/verify", { token })).status, 400, "lien à usage unique");
});

test("administration : envoi du lien « Mot de passe oublié » à un joueur, une fois par minute", async () => {
  const [admin, player, other] = await Promise.all([newUser("pa"), newUser("pp"), newUser("po")]);
  await sql("UPDATE users SET role = 'ADMIN' WHERE id = $1::uuid", [admin.id]);
  assert.equal((await other.s.post(`/admin/users/${player.id}/password-reset`)).status, 403, "joueur : refusé");
  let r = await admin.s.post(`/admin/users/${player.id}/password-reset`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, true);
  const tokens = await sql("SELECT 1 FROM password_reset_tokens WHERE user_id = $1::uuid AND used_at IS NULL", [player.id]);
  assert.equal(tokens.length, 1, "lien créé");
  r = await admin.s.post(`/admin/users/${player.id}/password-reset`);
  assert.equal(r.body.sent, false, "délai d'une minute entre deux envois");
  const [log] = await sql("SELECT 1 FROM audit_logs WHERE actor_id = $1::uuid AND action = 'user.password_reset_sent'", [admin.id]);
  assert.ok(log, "inscrit au journal d'audit");
});

test("appareils connectés : listés, celui-ci en premier ; un autre appareil se déconnecte aussitôt", async () => {
  const u = await newUser("dv");
  const [{ email }] = await sql("SELECT email FROM users WHERE id = $1::uuid", [u.id]);
  const other = session();
  assert.equal((await other.post("/auth/login", { email, password: OLD })).status, 200);
  let r = await u.s.get("/auth/sessions");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.length, 2);
  assert.equal(r.body[0].current, true, "cet appareil en premier");
  assert.equal(r.body[1].current, false);
  assert.ok(r.body[1].device);

  assert.equal((await u.s.del(`/auth/sessions/${r.body[0].id}`)).status, 400, "pas l'appareil en cours");
  assert.equal((await u.s.del("/auth/sessions/00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await other.get("/users/me")).status, 200);
  assert.equal((await u.s.del(`/auth/sessions/${r.body[1].id}`)).status, 204);
  assert.equal((await other.get("/users/me")).status, 401, "jeton d'accès de l'autre appareil refusé tout de suite");
  r = await u.s.get("/auth/sessions");
  assert.equal(r.body.length, 1);
  assert.equal((await u.s.get("/users/me")).status, 200, "cet appareil reste connecté");
});
