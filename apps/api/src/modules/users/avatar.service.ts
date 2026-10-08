import {
  BadRequestException, Controller, Delete, Get, HttpCode, Injectable, Logger, NotFoundException, Param, PayloadTooLargeException, Put, Req, Res,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { AVATAR_MAX_BYTES, AVATAR_TYPES } from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { StorageService } from "../storage/storage.service.js";
import { assertCanManage } from "../../common/staff-policy.js";

const AVATAR_SIZE = 256;
const FILE_PATTERN = /^[0-9a-f-]{36}\.webp$/;

/** Lit le corps brut de la requête (image) sans dépasser la taille autorisée. */
async function readBody(req: Request, max: number): Promise<Buffer> {
  const tooLarge = () => {
    // Le reste de l'envoi n'est pas lu : la connexion est fermée après la réponse
    req.res?.setHeader("Connection", "close");
    return new PayloadTooLargeException(`Image trop lourde (${Math.round(max / 1024 / 1024)} Mo maximum).`);
  };
  if (Number(req.headers["content-length"] ?? 0) > max) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Photos de profil : l'image envoyée est recadrée en carré 256 × 256 et réencodée en WebP (les métadonnées,
 * dont la position GPS d'une photo prise au téléphone, sont supprimées). Elle est servie par l'API avec un nom
 * aléatoire, sans exposer le stockage. L'ancienne photo est supprimée à chaque changement.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
  ) {}

  async upload(userId: string, contentType: string, body: Buffer) {
    await this.moderation.assertVerified(userId);
    if (!(AVATAR_TYPES as readonly string[]).includes(contentType)) {
      throw new UnsupportedMediaTypeException("Formats acceptés : JPEG, PNG ou WebP.");
    }
    if (!body.length) throw new BadRequestException("Image vide.");
    let image: Buffer;
    try {
      const input = sharp(body, { limitInputPixels: 40_000_000, failOn: "error" });
      const meta = await input.metadata();
      if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new Error(`format ${meta.format}`);
      image = await input
        .rotate() // orientation de la photo du téléphone
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (e) {
      this.logger.warn(`Photo de profil refusée : ${(e as Error).message}`);
      throw new BadRequestException("Cette image n'a pas pu être lue. Essaie une autre photo (JPEG, PNG ou WebP).");
    }
    const file = `${randomUUID()}.webp`;
    const key = `avatars/${file}`;
    await this.storage.uploadBuffer(key, image, "image/webp");
    // Chemin relatif : chaque client le complète avec l'adresse de l'API qu'il utilise
    const avatarUrl = `/v1/avatars/${file}`;
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarKey: true } });
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl, avatarKey: key } });
    if (previous.avatarKey) await this.storage.delete(previous.avatarKey).catch(() => undefined);
    return { avatarUrl };
  }

  /** Retire la photo (le joueur lui-même, ou la modération si elle est inappropriée). */
  async remove(userId: string, actorId?: string) {
    if (actorId) await assertCanManage(this.prisma, actorId, userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true, avatarUrl: true, displayName: true } });
    if (!user) throw new NotFoundException("Joueur introuvable.");
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null, avatarKey: null } });
    if (user.avatarKey) await this.storage.delete(user.avatarKey).catch(() => undefined);
    if (actorId) await this.audit.log(actorId, "user.avatar_remove", "user", userId, { displayName: user.displayName });
  }
}

@Controller()
export class AvatarController {
  constructor(private readonly avatars: AvatarService, private readonly storage: StorageService) {}

  /** PUT /v1/users/me/avatar — corps : l'image (Content-Type image/jpeg, image/png ou image/webp, 5 Mo max) */
  @Put("users/me/avatar")
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  async upload(@CurrentUser() u: AuthUser, @Req() req: Request) {
    const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    return this.avatars.upload(u.sub, contentType, await readBody(req, AVATAR_MAX_BYTES));
  }

  @Delete("users/me/avatar")
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser) {
    await this.avatars.remove(u.sub);
  }

  /** DELETE /v1/admin/users/:id/avatar — photo inappropriée retirée par la modération (journalisé) */
  @Roles("MODERATOR")
  @Delete("admin/users/:id/avatar")
  @HttpCode(204)
  async moderate(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    await this.avatars.remove(id, u.sub);
  }

  /** GET /v1/avatars/:file — photo de profil (nom aléatoire, jamais modifiée : mise en cache longue) */
  @Public()
  @SkipThrottle()
  @Get("avatars/:file")
  async serve(@Param("file") file: string, @Res() res: Response) {
    if (!FILE_PATTERN.test(file)) throw new NotFoundException();
    const stream = await this.storage.read(`avatars/${file}`);
    if (!stream) throw new NotFoundException();
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // Affichée par le site et l'administration (autres domaines)
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    stream.pipe(res);
  }
}
