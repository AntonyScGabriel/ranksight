import {
  Body, Controller, DefaultValuePipe, Delete, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  SUGGESTION_STATUS_LABEL, SUGGESTIONS_PER_DAY, SuggestionInput, SuggestionReviewInput, SuggestionStatus,
  type AdminSuggestionsDto, type SuggestionDto,
} from "@ranksight/shared";
import type { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { PushService } from "../notifications/notifications.module.js";

type Row = {
  id: string; category: SuggestionDto["category"]; text: string; status: SuggestionDto["status"];
  reply: string | null; repliedAt: Date | null; createdAt: Date;
};

const toDto = (s: Row): SuggestionDto => ({
  id: s.id,
  category: s.category,
  text: s.text,
  status: s.status,
  reply: s.reply,
  repliedAt: s.repliedAt?.toISOString() ?? null,
  createdAt: s.createdAt.toISOString(),
});

/**
 * Boîte à idées : les joueurs proposent des améliorations (5 par 24 heures au plus) et suivent leur traitement ;
 * l'équipe (modération et administration) les classe et peut répondre. L'auteur est prévenu sur son téléphone.
 */
@Injectable()
export class SuggestionsService {
  constructor(private readonly prisma: PrismaService, private readonly push: PushService, private readonly audit: AuditService) {}

  async create(userId: string, input: z.output<typeof SuggestionInput>): Promise<SuggestionDto> {
    const recent = await this.prisma.suggestion.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (recent >= SUGGESTIONS_PER_DAY) {
      throw new HttpException(
        { code: "SUGGESTION_LIMIT", message: `Tu as déjà envoyé ${SUGGESTIONS_PER_DAY} suggestions ces dernières 24 heures. Réessaie demain.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return toDto(await this.prisma.suggestion.create({ data: { userId, category: input.category, text: input.text } }));
  }

  async mine(userId: string): Promise<SuggestionDto[]> {
    const rows = await this.prisma.suggestion.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map(toDto);
  }

  /** Le joueur peut retirer une suggestion tant que l'équipe ne l'a pas traitée. */
  async withdraw(userId: string, id: string) {
    const s = await this.prisma.suggestion.findUnique({ where: { id } });
    if (!s || s.userId !== userId) throw new NotFoundException("Suggestion introuvable.");
    if (s.status !== "NEW" || s.reply) throw new ForbiddenException("Cette suggestion a déjà été traitée par l'équipe : elle ne peut plus être retirée.");
    await this.prisma.suggestion.delete({ where: { id } });
  }

  async list(opts: { status?: SuggestionStatus; limit: number; offset: number }): Promise<AdminSuggestionsDto> {
    const where = opts.status ? { status: opts.status } : {};
    const [rows, total, grouped] = await Promise.all([
      this.prisma.suggestion.findMany({
        where,
        // Les plus anciennes d'abord parmi celles en attente (file à traiter), les plus récentes d'abord sinon
        orderBy: { createdAt: opts.status === "NEW" ? "asc" : "desc" },
        skip: opts.offset,
        take: opts.limit,
        include: { user: { select: { id: true, displayName: true, status: true } }, repliedBy: { select: { displayName: true } } },
      }),
      this.prisma.suggestion.count({ where }),
      this.prisma.suggestion.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = { NEW: 0, PLANNED: 0, DONE: 0, DECLINED: 0 } as Record<SuggestionStatus, number>;
    for (const g of grouped) counts[g.status] = g._count._all;
    return {
      items: rows.map((r) => ({ ...toDto(r), author: r.user, repliedBy: r.repliedBy?.displayName ?? null })),
      total,
      counts,
    };
  }

  async review(actorId: string, id: string, input: z.output<typeof SuggestionReviewInput>): Promise<SuggestionDto> {
    const before = await this.prisma.suggestion.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Suggestion introuvable.");
    const replyChanged = (input.reply ?? null) !== before.reply;
    const updated = await this.prisma.suggestion.update({
      where: { id },
      data: {
        status: input.status,
        reply: input.reply ?? null,
        ...(replyChanged ? { repliedById: input.reply ? actorId : null, repliedAt: input.reply ? new Date() : null } : {}),
      },
    });
    await this.audit.log(actorId, "suggestion.review", "suggestion", id, { status: input.status, reply: !!input.reply }, {
      targetUserId: before.userId,
      before: { status: before.status },
      after: { status: updated.status },
    });
    if (before.status !== updated.status || (replyChanged && updated.reply)) {
      await this.push.toUsers([updated.userId], {
        title: "Ta suggestion a été traitée",
        body: updated.reply ? `${SUGGESTION_STATUS_LABEL[updated.status]} : ${updated.reply.slice(0, 120)}` : `Statut : ${SUGGESTION_STATUS_LABEL[updated.status]}`,
        data: { url: "suggestions" },
      });
    }
    return toDto(updated);
  }

  async remove(actorId: string, id: string) {
    const s = await this.prisma.suggestion.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!s) throw new NotFoundException("Suggestion introuvable.");
    await this.prisma.suggestion.delete({ where: { id } });
    await this.audit.log(actorId, "suggestion.delete", "suggestion", id, { authorId: s.userId }, { targetUserId: s.userId });
  }

  countNew() {
    return this.prisma.suggestion.count({ where: { status: "NEW" } });
  }
}

@Controller("suggestions")
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  /** POST /v1/suggestions — { category, text } */
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(SuggestionInput)) body: z.output<typeof SuggestionInput>) {
    return this.suggestions.create(user.sub, body);
  }

  /** GET /v1/suggestions/me — mes suggestions, avec leur statut et la réponse de l'équipe */
  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.suggestions.mine(user.sub);
  }

  /** DELETE /v1/suggestions/:id — retirer une suggestion pas encore traitée */
  @Delete(":id")
  @HttpCode(204)
  withdraw(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.suggestions.withdraw(user.sub, id);
  }
}

/** Traitement des suggestions par l'équipe (modération et administration) */
@Controller("admin/suggestions")
@Roles("MODERATOR")
export class SuggestionsAdminController {
  constructor(private readonly suggestions: SuggestionsService) {}

  /** GET /v1/admin/suggestions?status=NEW|PLANNED|DONE|DECLINED&limit=50&offset=0 */
  @Get()
  list(
    @Query("status", new ZodPipe(SuggestionStatus.optional())) status: SuggestionStatus | undefined,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.suggestions.list({ status, limit: Math.min(Math.max(limit, 1), 100), offset: Math.max(offset, 0) });
  }

  /** PATCH /v1/admin/suggestions/:id — { status, reply? } */
  @Patch(":id")
  review(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SuggestionReviewInput)) body: z.output<typeof SuggestionReviewInput>,
  ) {
    return this.suggestions.review(actor.sub, id, body);
  }

  /** DELETE /v1/admin/suggestions/:id — suppression (message hors sujet, abusif ou en double) */
  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.suggestions.remove(actor.sub, id);
  }
}

@Module({
  controllers: [SuggestionsController, SuggestionsAdminController],
  providers: [SuggestionsService],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
