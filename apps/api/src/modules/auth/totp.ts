import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Mots de passe à usage unique basés sur le temps (RFC 6238) : compatibles Google Authenticator, Authy, 1Password… */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) throw new Error("Secret invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

/** Vérifie un code (tolérance d'une période avant/après). Renvoie le compteur accepté, pour interdire sa réutilisation. */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  const current = Math.floor(now / 1000 / TOTP_PERIOD);
  for (const delta of [0, -1, 1]) {
    const expected = Buffer.from(totpAt(secret, current + delta));
    const given = Buffer.from(code.padEnd(DIGITS, " ").slice(0, DIGITS));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return current + delta;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "RankGuess") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_PERIOD}`;
}

/** Codes de secours : 8 codes « XXXX-XXXX » à usage unique */
export function recoveryCodes(n = 8): string[] {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => chars[x % chars.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
