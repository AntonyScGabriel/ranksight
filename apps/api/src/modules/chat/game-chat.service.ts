import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Redis } from "ioredis";
import { GAME_CHAT_EVENT, isStaffRole, type GameChatDto, type GameChatEvent, type GameChatMessageDto, type GameChatScope, type UserRole } from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { isVip, vipSelect } from "../shop/vip.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { ChatGateway } from "./chat.gateway.js";
import { assertChatRate, assertNotSpam } from "./global-chat.service.js";

/** Intervalle minimum entre deux messages d'un même joueur dans un tchat de salon ou de tournoi */
const SLOW_SEC = 2;
const HISTORY = 100;

const authorSelect = { id: true, displayName: true, avatarUrl: true, role: true, ...vipSelect, ...flairSelect } as const;
type Row = {
  id: string; body: string; createdAt: Date; team: number | null;
  user: { id: string; displayName: string; avatarUrl: string | null; role: UserRole; subscription: { status: string; currentPeriodEnd: Date } | null } & Parameters<typeof toFlair>[0];
};
const toDto = ({ user: { subscription, title, badge, frame, ...author }, ...m }: Row): GameChatMessageDto => ({
  id: m.id, body: m.body, createdAt: m.createdAt.toISOString(), team: m.team,
  author: { ...author, vip: isVip(subscription), flair: toFlair({ title, badge, frame }) },
});

/** Droits d'un joueur sur un tchat, et à qui diffuser */
type Access = {
  open: boolean; myTeam: number | null; canRead: boolean; canWrite: boolean; canModerate: boolean; muted: boolean;
  hostId: string | null; recipients: { userId: string; team: number | null }[];
  /** Organisateur d'un événement, qui n'y joue pas mais suit son tchat */
  watcherId: string | null;
};

/**
 * Tchat d'un salon (tous ses joueurs, et un canal par équipe en duel par équipes) ou d'un tournoi (tous les inscrits).
 * Ouvert tant que le salon est en attente ou en partie et tant que le tournoi n'est pas terminé ; lisible ensuite par
 * ceux qui y ont participé. Mêmes protections que le chat global : sanction en cours, filtre de mots, anti-spam.
 * Modération : l'organisateur d'un tournoi et l'équipe de modération suppriment des messages et réduisent un joueur au
 * silence dans le tchat du tournoi ; l'équipe de modération supprime aussi les messages des salons.
 */
@Injectable()
export class GameChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ChatGateway,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async history(userId: string, scope: GameChatScope, id: string): Promise<GameChatDto> {
    const a = await this.access(userId, scope, id);
    if (!a.canRead) throw this.notFound(scope);
    const blocked = await this.moderation.blockedIds(userId);
    const rows = await this.prisma.gameChatMessage.findMany({
      where: {
        ...(scope === "room" ? { roomId: id } : { tournamentId: id }),
        deletedAt: null,
        // Canal d'équipe : seulement celui de sa propre équipe
        OR: [{ team: null }, ...(a.myTeam ? [{ team: a.myTeam }] : [])],
        ...(blocked.length ? { userId: { notIn: blocked } } : {}),
      },
      include: { user: { select: authorSelect } },
      orderBy: { createdAt: "desc" },
      take: HISTORY,
    });
    return { messages: rows.reverse().map(toDto), open: a.open && a.canWrite && !a.muted, myTeam: a.myTeam, canModerate: a.canModerate, muted: a.muted };
  }

  async send(userId: string, scope: GameChatScope, id: string, rawBody: string, toTeam: boolean): Promise<GameChatMessageDto> {
    const a = await this.access(userId, scope, id);
    if (!a.canRead) throw this.notFound(scope);
    if (!a.open || !a.canWrite) throw new ForbiddenException({ code: "CHAT_CLOSED", message: scope === "room" ? "Le tchat de ce salon est fermé." : "Le tchat de ce tournoi est fermé." });
    if (a.muted) throw new ForbiddenException({ code: "CHAT_MUTED", message: "Tu as été réduit au silence dans le tchat de ce tournoi." });
    if (toTeam && !a.myTeam) throw new ForbiddenException({ code: "NO_TEAM", message: "Tu n'as pas d'équipe dans ce salon." });
    await this.moderation.assertCanChat(userId);
    const body = rawBody.replace(/\s+/g, " ").trim();
    assertNotSpam(body);
    await this.moderation.assertCleanText(body);
    await assertChatRate(this.redis, `gamechat:${id}`, userId, body, SLOW_SEC);

    const team = toTeam ? a.myTeam : null;
    const message = toDto(await this.prisma.gameChatMessage.create({
      data: { ...(scope === "room" ? { roomId: id } : { tournamentId: id }), userId, team, body },
      include: { user: { select: authorSelect } },
    }));
    // Comme l'historique : ceux qui ont bloqué l'auteur ne reçoivent pas ses messages en direct
    const blockers = await this.prisma.userBlock.findMany({ where: { blockedId: userId }, select: { blockerId: true } });
    this.broadcast(a, scope, id, { scope, id, message }, team, new Set(blockers.map((b) => b.blockerId)));
    return message;
  }

  /** Suppression : son propre message, ou n'importe lequel pour l'organisateur du tournoi et l'équipe de modération */
  async remove(userId: string, scope: GameChatScope, id: string, messageId: string) {
    const a = await this.access(userId, scope, id);
    const m = await this.prisma.gameChatMessage.findUnique({ where: { id: messageId }, select: { userId: true, team: true, roomId: true, tournamentId: true, deletedAt: true } });
    if (!a.canRead || !m || m.deletedAt || (scope === "room" ? m.roomId : m.tournamentId) !== id) throw new NotFoundException("Message introuvable.");
    if (m.userId !== userId && !a.canModerate) throw new ForbiddenException("Tu ne peux supprimer que tes propres messages.");
    await this.prisma.gameChatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedById: userId } });
    if (m.userId !== userId) await this.audit.log(userId, "gamechat.delete", "game_chat_message", messageId, { scope, id, authorId: m.userId }, { targetUserId: m.userId });
    this.broadcast(a, scope, id, { scope, id, deletedId: messageId }, m.team);
  }

  /** Tchat d'un tournoi : réduire un inscrit au silence (ou le lui rendre) ; jamais l'organisateur ni l'équipe */
  async mute(actorId: string, tournamentId: string, targetId: string, muted: boolean) {
    const a = await this.access(actorId, "tournament", tournamentId);
    if (!a.canModerate) throw new ForbiddenException("Seuls l'organisateur du tournoi et l'équipe de modération peuvent faire ça.");
    const target = await this.prisma.tournamentPlayer.findUnique({
      where: { tournamentId_userId: { tournamentId, userId: targetId } },
      select: { user: { select: { role: true } } },
    });
    if (!target) throw new NotFoundException("Joueur introuvable dans ce tournoi.");
    if (targetId === a.hostId || isStaffRole(target.user.role)) throw new BadRequestException("Impossible de réduire au silence l'organisateur ou un membre de l'équipe.");
    await this.prisma.tournamentPlayer.update({ where: { tournamentId_userId: { tournamentId, userId: targetId } }, data: { chatMuted: muted } });
    await this.audit.log(actorId, muted ? "gamechat.mute" : "gamechat.unmute", "tournament", tournamentId, { userId: targetId }, { targetUserId: targetId });
    return { muted };
  }

  private broadcast(a: Access, scope: GameChatScope, id: string, event: GameChatEvent, team: number | null, exclude?: Set<string>) {
    const to = new Set(a.recipients.filter((r) => team === null || r.team === team).map((r) => r.userId));
    // Organisateur d'un événement (sans y jouer) : il suit le tchat de son tournoi
    if (scope === "tournament" && a.watcherId && team === null) to.add(a.watcherId);
    for (const userId of to) if (!exclude?.has(userId)) this.gateway.emitToUser(userId, GAME_CHAT_EVENT, event);
  }

  private notFound(scope: GameChatScope) {
    return new NotFoundException(scope === "room" ? "Salon introuvable." : "Tournoi introuvable.");
  }

  private async access(userId: string, scope: GameChatScope, id: string): Promise<Access> {
    const viewer = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
    const staff = viewer?.status === "ACTIVE" && isStaffRole(viewer.role);
    if (scope === "room") {
      const room = await this.prisma.room.findUnique({ where: { id }, select: { status: true, hostId: true, players: { select: { userId: true, team: true, leftAt: true } } } });
      if (!room) throw this.notFound(scope);
      const me = room.players.find((p) => p.userId === userId);
      return {
        open: room.status === "LOBBY" || room.status === "ACTIVE",
        myTeam: me?.team ?? null,
        // L'équipe de modération lit (et peut supprimer) les messages d'un salon sans y jouer
        canRead: !!me || staff,
        canWrite: !!me && !me.leftAt,
        canModerate: staff,
        muted: false,
        hostId: room.hostId,
        watcherId: null,
        recipients: room.players.filter((p) => !p.leftAt).map((p) => ({ userId: p.userId, team: p.team })),
      };
    }
    const t = await this.prisma.tournament.findUnique({ where: { id }, select: { status: true, hostId: true, isEvent: true, players: { select: { userId: true, leftAt: true, chatMuted: true } } } });
    if (!t) throw this.notFound(scope);
    const me = t.players.find((p) => p.userId === userId);
    // Organisateur : celui d'un événement (qui n'y joue pas), ou celui d'un tournoi de joueurs tant qu'il y est inscrit
    const hosting = t.hostId === userId && (t.isEvent || (!!me && !me.leftAt));
    const moderator = staff || hosting;
    return {
      open: t.status === "LOBBY" || t.status === "ACTIVE",
      myTeam: null,
      canRead: !!me || moderator,
      // L'organisateur d'un événement (qui n'y joue pas) peut aussi écrire : annonces, consignes
      canWrite: (!!me && !me.leftAt) || moderator,
      canModerate: moderator,
      muted: !!me?.chatMuted,
      hostId: t.hostId,
      watcherId: t.isEvent ? t.hostId : null,
      recipients: t.players.filter((p) => !p.leftAt).map((p) => ({ userId: p.userId, team: null })),
    };
  }
}
