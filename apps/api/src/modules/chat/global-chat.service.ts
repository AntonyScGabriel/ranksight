import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException,
} from "@nestjs/common";
import type { Redis } from "ioredis";
import { GLOBAL_CHAT_EVENTS, isStaffRole, type GlobalMessageDto, type UserRole } from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { isVip, vipSelect } from "../shop/vip.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { ChatSettingsService } from "../moderation/chat-settings.service.js";
import { ChatGateway } from "./chat.gateway.js";

/** Intervalle minimum entre deux messages d'un même joueur (le mode lent de la modération peut l'allonger). */
const SLOW_MODE_SEC = 3;
/** Délai maximum du mode lent réglable par la modération */
const MAX_SLOW_MODE_SEC = 600;
/** Renvoie le temps d'attente restant (ms), sinon enregistre l'heure du message et renvoie 0 */
const SLOW_MODE_SCRIPT = `
local last = redis.call("GET", KEYS[1])
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
if last and now - tonumber(last) < gap then return gap - (now - tonumber(last)) end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[3])
return 0`;
/** Rafale maximale : 8 messages par minute. */
const BURST_LIMIT = 8;
const BURST_WINDOW_SEC = 60;
/** Un message identique au précédent est refusé pendant 2 minutes. */
const DUPLICATE_WINDOW_SEC = 120;
const MAX_LINKS = 1;

const authorSelect = { id: true, displayName: true, avatarUrl: true, role: true, ...vipSelect, ...flairSelect } as const;

type Row = {
  id: string; body: string; createdAt: Date;
  user: {
    id: string; displayName: string; avatarUrl: string | null; role: UserRole;
    subscription: { status: string; currentPeriodEnd: Date } | null;
  } & Parameters<typeof toFlair>[0];
};

const toDto = ({ user: { subscription, title, badge, frame, ...author }, ...m }: Row): GlobalMessageDto => ({
  id: m.id,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
  author: { ...author, vip: isVip(subscription), flair: toFlair({ title, badge, frame }) },
});

class TooFastException extends HttpException {
  constructor(message: string, retryAfter: number) {
    super({ code: "SLOW_DOWN", message, retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Chat global : un salon public commun à tous les joueurs connectés, distinct de la messagerie privée.
 * Envoi par l'API REST (validation, anti-spam, persistance), diffusion en direct par Socket.IO
 * aux clients qui ont rejoint la salle "global" du namespace /ws/chat.
 */
@Injectable()
export class GlobalChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ChatGateway,
    private readonly audit: AuditService,
    private readonly moderation: ModerationService,
    private readonly settings: ChatSettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Réglages visibles par les joueurs (mode lent en cours) */
  async publicSettings() {
    const { slowModeSec } = await this.settings.get();
    return { slowModeSec };
  }

  /** Messages récents, du plus ancien au plus récent. `before` permet de remonter l'historique. */
  async recent(before?: string, limit = 50, viewerId?: string): Promise<GlobalMessageDto[]> {
    const beforeDate = before ? new Date(before) : undefined;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) throw new BadRequestException("Date invalide.");
    // Les messages des joueurs bloqués par le lecteur ne lui sont pas envoyés
    const blocked = viewerId ? await this.moderation.blockedIds(viewerId) : [];
    const rows = await this.prisma.globalMessage.findMany({
      where: {
        deletedAt: null, user: { status: "ACTIVE" },
        ...(blocked.length ? { userId: { notIn: blocked } } : {}),
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      include: { user: { select: authorSelect } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.reverse().map(toDto);
  }

  async send(userId: string, rawBody: string): Promise<GlobalMessageDto> {
    await this.moderation.assertCanChat(userId);

    const body = rawBody.replace(/\s+/g, " ").trim();
    this.assertNotSpam(body);
    await this.moderation.assertCleanText(body);
    // Mode lent : ne s'applique pas à l'équipe
    const author = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    const { slowModeSec } = await this.settings.get();
    await this.assertRate(userId, body, isStaffRole(author.role) ? SLOW_MODE_SEC : Math.max(SLOW_MODE_SEC, slowModeSec));

    const message = toDto(
      await this.prisma.globalMessage.create({ data: { userId, body }, include: { user: { select: authorSelect } } }),
    );
    this.gateway.emitGlobal(GLOBAL_CHAT_EVENTS.message, message);
    return message;
  }

  /** Suppression : l'auteur pour ses propres messages, un modérateur ou un administrateur pour tous. */
  async remove(actorId: string, messageId: string) {
    const [message, actor] = await Promise.all([
      this.prisma.globalMessage.findUnique({ where: { id: messageId }, select: { id: true, userId: true, deletedAt: true } }),
      this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } }),
    ]);
    if (!message || message.deletedAt) throw new NotFoundException("Message introuvable.");
    const isModerator = actor?.status === "ACTIVE" && isStaffRole(actor.role);
    if (message.userId !== actorId && !isModerator) throw new ForbiddenException("Tu ne peux supprimer que tes propres messages.");

    await this.prisma.globalMessage.update({ where: { id: message.id }, data: { deletedAt: new Date(), deletedById: actorId } });
    if (message.userId !== actorId) await this.audit.log(actorId, "chat.delete", "global_message", message.id, { authorId: message.userId });
    this.gateway.emitGlobal(GLOBAL_CHAT_EVENTS.deleted, { id: message.id });
  }

  /**
   * Efface d'un coup les messages récents d'un joueur (spam, insultes en série), depuis le chat ou l'administration.
   * Les messages de l'équipe ne peuvent pas être effacés ainsi.
   */
  async purge(actorId: string, userId: string, hours: number) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, displayName: true } });
    if (!target) throw new NotFoundException("Joueur introuvable.");
    if (isStaffRole(target.role)) throw new BadRequestException("Impossible d'effacer les messages d'un membre de l'équipe.");
    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await this.prisma.globalMessage.findMany({ where: { userId, deletedAt: null, createdAt: { gte: since } }, select: { id: true } });
    if (rows.length) {
      await this.prisma.globalMessage.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: new Date(), deletedById: actorId } });
      for (const r of rows) this.gateway.emitGlobal(GLOBAL_CHAT_EVENTS.deleted, { id: r.id });
    }
    await this.audit.log(actorId, "chat.purge", "user", userId, { displayName: target.displayName, hours, deleted: rows.length });
    return { deleted: rows.length };
  }

  /** Historique de modération (administration) : messages supprimés inclus. */
  async moderationList(page: number) {
    const take = 50;
    const [items, total] = await Promise.all([
      this.prisma.globalMessage.findMany({
        include: { user: { select: { ...authorSelect, username: true } }, deletedBy: { select: { displayName: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip: (Math.max(page, 1) - 1) * take,
      }),
      this.prisma.globalMessage.count(),
    ]);
    return { items, total, page, pageSize: take };
  }

  /** Spam évident : caractères répétés, liens multiples, message tout en majuscules. */
  private assertNotSpam(body: string) {
    if (!body) throw new BadRequestException("Message vide.");
    if (/(.)\1{9,}/u.test(body)) throw new BadRequestException("Message refusé : trop de caractères répétés.");
    if ((body.match(/(https?:\/\/|www\.)\S+/gi) ?? []).length > MAX_LINKS) {
      throw new BadRequestException("Message refusé : un seul lien par message.");
    }
    const letters = body.replace(/[^\p{L}]/gu, "");
    if (letters.length >= 12 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
      throw new BadRequestException("Évite d'écrire tout en majuscules.");
    }
  }

  /** Limite de fréquence par joueur (Redis : partagée entre toutes les instances de l'API). */
  private async assertRate(userId: string, body: string, slowSec: number) {
    // Heure du dernier message comparée au délai en vigueur : si la modération raccourcit ou coupe le mode lent,
    // le changement s'applique tout de suite (vérification et enregistrement atomiques)
    const waitMs = Number(await this.redis.eval(SLOW_MODE_SCRIPT, 1, `gchat:slow:${userId}`, Date.now(), slowSec * 1000, MAX_SLOW_MODE_SEC));
    if (waitMs > 0) {
      const sec = Math.max(Math.ceil(waitMs / 1000), 1);
      throw new TooFastException(`Patiente ${sec} s avant d'envoyer un nouveau message.`, sec);
    }
    const burstKey = `gchat:burst:${userId}`;
    const [[, count]] = (await this.redis.multi().incr(burstKey).expire(burstKey, BURST_WINDOW_SEC, "NX").exec()) as [[null, number]];
    if (count > BURST_LIMIT) {
      const ttl = await this.redis.ttl(burstKey);
      throw new TooFastException(`Trop de messages en peu de temps. Réessaie dans ${Math.max(ttl, 1)} s.`, Math.max(ttl, 1));
    }
    const normalized = body.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const last = await this.redis.set(`gchat:last:${userId}`, normalized, "EX", DUPLICATE_WINDOW_SEC, "GET");
    if (last !== null && last === normalized) throw new BadRequestException("Tu viens déjà d'envoyer ce message.");
  }
}
