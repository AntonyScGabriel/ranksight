import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";

export interface PlayClaims {
  jti: string;
  uid: string;
  cid: string; // clip
  mode: "DAILY" | "INFINITE" | "VERSUS";
  did?: string; // daily challenge
  rid?: string; // infinite run
  vid?: string; // versus (duel)
  iat?: number;
}

/**
 * Jeton de partie signé, à usage unique : lie un joueur à un clip précis.
 * Empêche de répondre pour un clip non servi, de rejouer une réponse,
 * et sert à vérifier la cohérence du temps de visionnage.
 */
@Injectable()
export class PlayTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(claims: Omit<PlayClaims, "jti" | "iat">) {
    return this.jwt.signAsync(
      { ...claims, jti: randomUUID() },
      { secret: env().JWT_ACCESS_SECRET, audience: "play", expiresIn: "30m" },
    );
  }

  async verify(token: string, userId: string): Promise<PlayClaims & { iat: number }> {
    try {
      const claims = await this.jwt.verifyAsync<PlayClaims & { iat: number }>(token, {
        secret: env().JWT_ACCESS_SECRET,
        audience: "play",
      });
      if (claims.uid !== userId) throw new Error("mismatch");
      return claims;
    } catch {
      throw new UnauthorizedException({ code: "INVALID_PLAY_TOKEN" });
    }
  }
}
