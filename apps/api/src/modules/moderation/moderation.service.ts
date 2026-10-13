import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import { findBannedWord, GLOBAL_CHAT_EVENTS, isStaffRole, type ChatReportReason, type ReportPlayerInput } from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TokenService } from "../auth/token.service.js";
import { ChatGateway } from "../chat/chat.gateway.js";
import { ChatSettingsService } from "./chat-settings.service.js";

export const MAX_MUTE_HOURS = 24 * 30;

export interface ResolveInput {
  status: "RESOLVED" | "DISMISSED";
  resolution?: string;
  deleteMessage: boolean;
  muteHours: number;
  ban: boolean;
}

/**
 * Sécurité des échanges entre joueurs :
 * - blocage (plus de messages privés, de demandes d'ami ni de duels ; messages du chat global masqués) ;
 * - signalement d'un joueur ou d'un message, traité par l'équipe ;
 * - chat coupé temporairement par la modération ;
 * - adresse email confirmée exigée pour écrire (limite les comptes jetables).
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly gateway: ChatGateway,
    private readonly settings: ChatSettingsService,
  ) {}

  /** Peut écrire (chat global, messages privés) : compte actif, adresse confirmée (ou compte Google/Discord), chat non coupé. */
  async assertCanChat(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, emailVerifiedAt: true, chatMutedUntil: true, _count: { select: { oauthAccounts: true } } },
    });
    if (!user || user.status !== "ACTIVE") throw new ForbiddenException("Ce compte ne peut pas écrire.");
    if (user.chatMutedUntil && user.chatMutedUntil > new Date()) {
      throw new ForbiddenException({
        code: "CHAT_MUTED",
        message: `L'équipe a suspendu ton accès au chat jusqu'au ${user.chatMutedUntil.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}.`,
      });
    }
    await this.assertVerified(userId, user);
  }

  /** Adresse email confirmée (ou compte Google/Discord) : exigée pour écrire et pour proposer des clips. */
  /** Filtre de mots interdits (liste gérée par l'équipe), pour le chat global et les messages privés */
  async assertCleanText(text: string) {
    const { bannedWords } = await this.settings.get();
    if (findBannedWord(text, bannedWords)) {
      throw new BadRequestException({ code: "BANNED_WORD", message: "Ton message contient un mot interdit par le règlement du chat." });
    }
  }

  async assertVerified(userId: string, known?: { emailVerifiedAt: Date | null; _count: { oauthAccounts: number } }) {
    const user = known ?? (await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true, _count: { select: { oauthAccounts: true } } },
    }));
    if (user && !user.emailVerifiedAt && user._count.oauthAccounts === 0) {
      throw new ForbiddenException({ code: "EMAIL_NOT_VERIFIED", message: "Confirme ton adresse email (lien reçu à l'inscription) pour pouvoir faire ça." });
    }
  }

  async isBlocked(a: string, b: string) {
    return (await this.prisma.userBlock.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
  }

  /** Joueurs que `userId` a bloqués (leurs messages du chat global lui sont masqués) */
  async blockedIds(userId: string) {
    return (await this.prisma.userBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true } })).map((b) => b.blockedId);
  }

  async block(userId: string, targetId: string) {
    if (userId === targetId) throw new BadRequestException("Tu ne peux pas te bloquer toi-même.");
    const target = await this.prisma.user.findFirst({ where: { id: targetId, status: { not: "DELETED" } }, select: { id: true } });
    if (!target) throw new NotFoundException("Joueur introuvable.");
    await this.prisma.$transaction([
      this.prisma.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
        create: { blockerId: userId, blockedId: targetId },
        update: {},
      }),
      // Plus d'amitié ni de demande en cours entre eux
      this.prisma.friendship.deleteMany({ where: { OR: [{ requesterId: userId, addresseeId: targetId }, { requesterId: targetId, addresseeId: userId }] } }),
      // Invitations de duel en attente annulées
      this.prisma.versusMatch.updateMany({
        where: { status: "PENDING", OR: [{ creatorId: userId, opponentId: targetId }, { creatorId: targetId, opponentId: userId }] },
        data: { status: "CANCELED" },
      }),
    ]);
  }

  async unblock(userId: string, targetId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
  }

  async listBlocked(userId: string) {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({ ...r.blocked, blockedAt: r.createdAt.toISOString() }));
  }

  // ---------- Signalements ----------

  async report(userId: string, input: z.output<typeof ReportPlayerInput>) {
    if (input.targetUserId === userId) throw new BadRequestException("Tu ne peux pas te signaler toi-même.");
    const target = await this.prisma.user.findFirst({ where: { id: input.targetUserId, status: { not: "DELETED" } }, select: { id: true } });
    if (!target) throw new NotFoundException("Joueur introuvable.");

    let excerpt: string | null = null;
    if (input.globalMessageId) {
      const m = await this.prisma.globalMessage.findUnique({ where: { id: input.globalMessageId }, select: { userId: true, body: true } });
      if (!m || m.userId !== input.targetUserId) throw new BadRequestException("Message introuvable.");
      excerpt = m.body;
    }
    if (input.directMessageId) {
      // Un message privé ne peut être signalé que par son destinataire
      const m = await this.prisma.directMessage.findUnique({ where: { id: input.directMessageId }, select: { senderId: true, recipientId: true, body: true } });
      if (!m || m.senderId !== input.targetUserId || m.recipientId !== userId) throw new BadRequestException("Message introuvable.");
      excerpt = m.body;
    }
    const duplicate = await this.prisma.chatReport.count({
      where: {
        reporterId: userId, targetUserId: input.targetUserId, status: "OPEN",
        globalMessageId: input.globalMessageId ?? null, directMessageId: input.directMessageId ?? null,
      },
    });
    if (duplicate) throw new ConflictException("Tu as déjà signalé cela : l'équipe va le traiter.");
    await this.prisma.chatReport.create({
      data: {
        reporterId: userId,
        targetUserId: input.targetUserId,
        reason: input.reason as ChatReportReason,
        details: input.details || null,
        globalMessageId: input.globalMessageId ?? null,
        directMessageId: input.directMessageId ?? null,
        excerpt,
      },
    });
    if (input.globalMessageId) await this.autoHide(input.globalMessageId);
  }

  /**
   * Message du chat global signalé par plusieurs joueurs différents : masqué en attendant la décision de l'équipe
   * (il réapparaît si le signalement est rejeté). Les messages de l'équipe ne sont jamais masqués automatiquement.
   */
  private async autoHide(messageId: string) {
    const { autoHideReports } = await this.settings.get();
    if (!autoHideReports) return;
    const reporters = await this.prisma.chatReport.groupBy({ by: ["reporterId"], where: { globalMessageId: messageId, status: "OPEN" } });
    if (reporters.length < autoHideReports) return;
    const { count } = await this.prisma.globalMessage.updateMany({
      where: { id: messageId, deletedAt: null, user: { role: { in: ["USER", "REVIEWER"] } } },
      data: { deletedAt: new Date(), autoHidden: true },
    });
    if (count) this.gateway.emitGlobal(GLOBAL_CHAT_EVENTS.deleted, { id: messageId });
  }

  async list(status: string, page: number) {
    const take = 25;
    const where = { status: (["OPEN", "RESOLVED", "DISMISSED"].includes(status) ? status : "OPEN") as "OPEN" | "RESOLVED" | "DISMISSED" };
    const [items, total] = await Promise.all([
      this.prisma.chatReport.findMany({
        where,
        include: {
          reporter: { select: { id: true, displayName: true } },
          target: {
            select: {
              id: true, displayName: true, username: true, status: true, chatMutedUntil: true, avatarUrl: true, role: true,
              _count: { select: { chatReportsAbout: true } },
            },
          },
          resolver: { select: { displayName: true } },
          globalMessage: { select: { id: true, deletedAt: true } },
        },
        orderBy: { createdAt: where.status === "OPEN" ? "asc" : "desc" },
        take,
        skip: (Math.max(page, 1) - 1) * take,
      }),
      this.prisma.chatReport.count({ where }),
    ]);
    return { items, total, page, pageSize: take };
  }

  async resolve(actorId: string, id: string, b: ResolveInput) {
    const report = await this.prisma.chatReport.findUnique({ where: { id }, include: { target: { select: { role: true } } } });
    if (!report) throw new NotFoundException("Signalement introuvable.");
    if (report.status !== "OPEN") throw new BadRequestException("Ce signalement a déjà été traité.");
    if ((b.ban || b.muteHours) && isStaffRole(report.target.role)) throw new BadRequestException("Impossible de sanctionner un membre de l'équipe.");
    if (b.ban) {
      const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (actor?.role !== "ADMIN" && actor?.role !== "OWNER") throw new ForbiddenException("Seul un administrateur peut bannir un joueur.");
    }

    if (b.deleteMessage && report.globalMessageId) {
      const { count } = await this.prisma.globalMessage.updateMany({
        where: { id: report.globalMessageId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actorId },
      });
      if (count) this.gateway.emitGlobal(GLOBAL_CHAT_EVENTS.deleted, { id: report.globalMessageId });
      // Message déjà masqué automatiquement : la suppression est confirmée par l'équipe
      await this.prisma.globalMessage.updateMany({ where: { id: report.globalMessageId, autoHidden: true }, data: { autoHidden: false, deletedById: actorId } });
    } else if (report.globalMessageId) {
      // Message masqué automatiquement : il réapparaît si le signalement est rejeté, sinon il reste supprimé
      await this.prisma.globalMessage.updateMany({
        where: { id: report.globalMessageId, autoHidden: true },
        data: b.status === "DISMISSED" ? { autoHidden: false, deletedAt: null } : { autoHidden: false, deletedById: actorId },
      });
    }
    if (b.muteHours) await this.mute(actorId, report.targetUserId, b.muteHours, false);
    if (b.ban) {
      await this.prisma.user.update({ where: { id: report.targetUserId }, data: { status: "BANNED" } });
      await this.tokens.revokeAll(report.targetUserId);
    }
    // Les autres signalements ouverts sur le même message sont traités en même temps
    await this.prisma.chatReport.updateMany({
      where: {
        status: "OPEN",
        OR: [
          { id },
          ...(report.globalMessageId ? [{ globalMessageId: report.globalMessageId }] : []),
          ...(report.directMessageId ? [{ directMessageId: report.directMessageId }] : []),
        ],
      },
      data: { status: b.status, resolution: b.resolution || null, resolverId: actorId, resolvedAt: new Date() },
    });
    await this.audit.log(actorId, "player_report.resolve", "chat_report", id, { ...b, targetUserId: report.targetUserId }, { targetUserId: report.targetUserId });
  }

  async mute(actorId: string, userId: string, hours: number, log = true) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true, chatMutedUntil: true } });
    if (!target || target.status === "DELETED") throw new NotFoundException("Compte introuvable.");
    if (isStaffRole(target.role) && hours > 0) throw new BadRequestException("Impossible de couper le chat d'un membre de l'équipe.");
    const until = hours > 0 ? new Date(Date.now() + hours * 3_600_000) : null;
    await this.prisma.user.update({ where: { id: userId }, data: { chatMutedUntil: until } });
    if (log) {
      await this.audit.log(actorId, hours ? "user.mute" : "user.unmute", "user", userId, { hours }, {
        before: { chatMutedUntil: target.chatMutedUntil?.toISOString() ?? null },
        after: { chatMutedUntil: until?.toISOString() ?? null },
      });
    }
    return { chatMutedUntil: until?.toISOString() ?? null };
  }
}

