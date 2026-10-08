import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Put, Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { PrismaService } from "../../prisma/prisma.service.js";

const MAX_ICON_BYTES = 512 * 1024;
const IconBody = z.object({ dataUrl: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Formats acceptés : PNG, JPEG ou WebP.") });

/** Reconnaît le format réel à partir des premiers octets (le type annoncé ne suffit pas). */
function sniff(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** GET /v1/ranks/:id/icon — image d'un rang (publique, mise en cache ; l'adresse change à chaque nouvelle image) */
@Controller("ranks")
export class RankIconsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get(":id/icon")
  async icon(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const icon = await this.prisma.rankIcon.findUnique({ where: { rankId: id } });
    if (!icon) throw new NotFoundException();
    res.setHeader("Content-Type", icon.mimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(Buffer.from(icon.data));
  }
}

/** Images des rangs : remplacement ou retour à l'emblème par défaut (administrateurs) */
@Controller("admin/ranks")
@Roles("ADMIN")
export class RankIconsAdminController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Put(":id/icon")
  async upload(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(IconBody)) body: z.infer<typeof IconBody>) {
    const rank = await this.prisma.rank.findUnique({ where: { id } });
    if (!rank) throw new NotFoundException("Rang introuvable.");
    const data = Buffer.from(body.dataUrl.slice(body.dataUrl.indexOf(",") + 1), "base64");
    if (data.length > MAX_ICON_BYTES) throw new BadRequestException("Image trop lourde (512 Ko maximum).");
    const mimeType = sniff(data);
    if (!mimeType) throw new BadRequestException("Ce fichier n'est pas une image PNG, JPEG ou WebP valide.");
    const icon = await this.prisma.rankIcon.upsert({ where: { rankId: id }, create: { rankId: id, mimeType, data }, update: { mimeType, data } });
    const iconUrl = `/v1/ranks/${id}/icon?v=${icon.updatedAt.getTime()}`;
    await this.prisma.rank.update({ where: { id }, data: { iconUrl } });
    await this.audit.log(u.sub, "rank.icon", "rank", id);
    return { iconUrl };
  }

  @Delete(":id/icon")
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.prisma.rankIcon.deleteMany({ where: { rankId: id } });
    await this.prisma.rank.updateMany({ where: { id }, data: { iconUrl: null } });
    await this.audit.log(u.sub, "rank.icon.reset", "rank", id);
  }
}
