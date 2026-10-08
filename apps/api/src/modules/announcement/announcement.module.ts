import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Put } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { randomUUID } from "node:crypto";
import { AnnouncementInput, type AnnouncementDto } from "@ranksight/shared";
import type { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { PrismaService } from "../../prisma/prisma.service.js";

const KEY = "announcement";
/** Relue au plus toutes les 30 secondes (plusieurs instances de l'API peuvent tourner) */
const CACHE_MS = 30_000;

/**
 * Annonce affichée en haut du site et de l'application : maintenance prévue, nouvelle saison, événement…
 * Une seule annonce à la fois, avec une fin d'affichage facultative. Chaque nouvelle annonce a un identifiant
 * neuf : un joueur qui avait fermé la précédente voit la nouvelle.
 */
@Injectable()
export class AnnouncementService {
  private cache: { value: AnnouncementDto | null; at: number } | null = null;

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async current(): Promise<AnnouncementDto | null> {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
      this.cache = { value: (row?.value as AnnouncementDto | null) ?? null, at: Date.now() };
    }
    const a = this.cache.value;
    if (!a || (a.until && new Date(a.until) <= new Date())) return null;
    return a;
  }

  async set(actorId: string, input: z.output<typeof AnnouncementInput>) {
    const value: AnnouncementDto = {
      id: randomUUID(),
      text: input.text,
      tone: input.tone,
      link: input.link || null,
      until: input.until ? new Date(input.until).toISOString() : null,
    };
    await this.prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedById: actorId }, update: { value, updatedById: actorId } });
    this.cache = { value, at: Date.now() };
    await this.audit.log(actorId, "announcement.set", "app_setting", KEY, { text: value.text, tone: value.tone, until: value.until });
    return value;
  }

  async clear(actorId: string) {
    await this.prisma.appSetting.deleteMany({ where: { key: KEY } });
    this.cache = { value: null, at: Date.now() };
    await this.audit.log(actorId, "announcement.clear", "app_setting", KEY);
  }
}

@Controller()
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  /** GET /v1/announcement — annonce en cours (null s'il n'y en a pas) */
  @Public()
  @SkipThrottle()
  @Get("announcement")
  async current() {
    return { announcement: await this.announcements.current() };
  }

  /** PUT /v1/admin/announcement — { text, tone, link?, until? } */
  @Roles("MODERATOR")
  @Put("admin/announcement")
  set(@CurrentUser() u: AuthUser, @Body(new ZodPipe(AnnouncementInput)) body: z.output<typeof AnnouncementInput>) {
    return this.announcements.set(u.sub, body);
  }

  @Roles("MODERATOR")
  @Delete("admin/announcement")
  @HttpCode(204)
  async clear(@CurrentUser() u: AuthUser) {
    await this.announcements.clear(u.sub);
  }
}

@Module({ controllers: [AnnouncementController], providers: [AnnouncementService] })
export class AnnouncementModule {}
