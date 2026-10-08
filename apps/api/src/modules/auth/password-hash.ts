import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hash des mots de passe avec scrypt (fonction lente et gourmande en mémoire, recommandée par l'OWASP).
 * Format stocké : scrypt$N$r$p$<sel base64>$<hash base64>. Le mot de passe en clair n'est jamais conservé.
 * Les paramètres sont enregistrés avec le hash : ils peuvent être renforcés plus tard sans invalider les comptes.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

const maxmem = (N: number, r: number) => 128 * N * r * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...PARAMS, maxmem: maxmem(PARAMS.N, PARAMS.r) });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const N = Number(n), R = Number(r), P = Number(p);
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
