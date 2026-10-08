import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Chiffrement des données sensibles stockées en base (secret de double authentification) : AES-256-GCM.
 * Clé : ENCRYPTION_KEY si renseignée, sinon dérivée de JWT_REFRESH_SECRET (HKDF-SHA256).
 */
function key(): Buffer {
  const material = env().ENCRYPTION_KEY || env().JWT_REFRESH_SECRET;
  return Buffer.from(hkdfSync("sha256", material, "rankguess", "data-encryption-v1", 32));
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Donnée chiffrée invalide");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
