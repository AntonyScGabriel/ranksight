import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Redis } from "ioredis";
import { createHash, randomInt } from "node:crypto";
import type { AdminGiftCodeDto, CreateGiftCodesInput } from "@ranksight/shared";
import type { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { decrypt, encrypt } from "../../common/crypto.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { extendVip, vipSelect, vipStatus } from "./vip.js";

/** Caractères des codes : sans 0/O ni 1/I/L, pour éviter les erreurs de recopie */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
/** Codes inexistants saisis par un même compte avant blocage temporaire */
const MAX_FAILED = 10;
const FAILED_WINDOW_SEC = 3600;

/** Code saisi → forme canonique (majuscules, sans espaces ni tirets, sans le préfixe RG) */
export function normalizeGiftCode(raw: string) {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === CODE_LENGTH + 2 && compact.startsWith("RG") ? compact.slice(2) : compact;
}
const hashCode = (normalized: string) => createHash("sha256").update(`gift:${normalized}`).digest("hex");
const formatCode = (normalized: string) => `RG-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8)}`;

/**
 * Codes cadeaux VIP : achetés pour être offerts (un usage) ou créés par l'équipe (concours, créateurs : plusieurs usages,
 * date de fin facultative). 31 caractères possibles sur 12 positions : un code ne peut pas être deviné.
 */
@Injectable()
export class GiftsService {
  private readonly logger = new Logger(GiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly moderation: ModerationService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Code inexistant : compté par compte (pas par adresse IP, partagée dans une école ou une box) */
  private async invalid(userId: string): Promise<never> {
    const key = `gift:failed:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, FAILED_WINDOW_SEC);
    throw new NotFoundException({ code: "GIFT_CODE_INVALID", message: "Ce code n'existe pas. Vérifie-le et réessaie." });
  }

  private newCode() {
    let normalized = "";
    for (let i = 0; i < CODE_LENGTH; i++) normalized += ALPHABET[randomInt(ALPHABET.length)];
    return normalized;
  }

  /** Crée un code (dans une transaction) et renvoie sa forme lisible : RG-XXXX-XXXX-XXXX */
  async create(
    tx: Prisma.TransactionClient,
    data: { days: number; maxUses?: number; expiresAt?: Date | null; purchaseId?: string; createdById?: string; note?: string | null },
  ) {
    const normalized = this.newCode();
    const code = formatCode(normalized);
    await tx.giftCode.create({
      data: {
        codeHash: hashCode(normalized), codeEnc: encrypt(code), days: data.days, maxUses: data.maxUses ?? 1,
        expiresAt: data.expiresAt ?? null, purchaseId: data.purchaseId ?? null, createdById: data.createdById ?? null, note: data.note ?? null,
      },
    });
    return code;
  }

  readable(codeEnc: string) {
    return decrypt(codeEnc);
  }

  /** Utiliser un code : le VIP est prolongé de la durée du code. Un même joueur ne peut utiliser un code qu'une fois. */
  async redeem(userId: string, raw: string) {
    await this.moderation.assertVerified(userId);
    if (Number(await this.redis.get(`gift:failed:${userId}`)) >= MAX_FAILED) {
      throw new HttpException({ code: "TOO_MANY_ATTEMPTS", message: "Trop de codes incorrects. Réessaie dans une heure." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const normalized = normalizeGiftCode(raw);
    if (normalized.length !== CODE_LENGTH) return this.invalid(userId);
    const code = await this.prisma.giftCode.findUnique({
      where: { codeHash: hashCode(normalized) },
      include: { purchase: { select: { user: { select: { id: true, displayName: true } } } } },
    });
    if (!code) return this.invalid(userId);
    if (code.disabledAt) throw new BadRequestException({ code: "GIFT_CODE_DISABLED", message: "Ce code n'est plus valable." });
    if (code.expiresAt && code.expiresAt <= new Date()) throw new BadRequestException({ code: "GIFT_CODE_EXPIRED", message: "Ce code a expiré." });

    const until = await this.prisma.$transaction(async (tx) => {
      try {
        await tx.giftRedemption.create({ data: { codeId: code.id, userId } });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") throw new ConflictException({ code: "GIFT_CODE_ALREADY_USED_BY_YOU", message: "Tu as déjà utilisé ce code." });
        throw e;
      }
      // Compteur incrémenté seulement s'il reste des utilisations (deux joueurs en même temps : un seul passe)
      const { count } = await tx.giftCode.updateMany({ where: { id: code.id, uses: { lt: code.maxUses } }, data: { uses: { increment: 1 } } });
      if (count === 0) throw new ConflictException({ code: "GIFT_CODE_USED", message: "Ce code a déjà été utilisé." });
      await tx.purchase.create({
        data: { userId, product: "gift_code", days: code.days, amountCents: 0, provider: "MANUAL", status: "PAID", paidAt: new Date() },
      });
      return extendVip(tx, userId, code.days, "MANUAL", "gift_code");
    });
    await this.audit.log(userId, "gift_code.redeem", "gift_code", code.id, { days: code.days }, { targetUserId: userId });
    const from = code.purchase?.user && code.purchase.user.id !== userId ? code.purchase.user.displayName : null;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: vipSelect });
    return { days: code.days, until: until.toISOString(), from, vip: vipStatus(user.subscription) };
  }

  // ---------- Administration ----------

  async createBatch(actorId: string, input: z.output<typeof CreateGiftCodesInput>) {
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException("La date de fin doit être dans le futur.");
    const codes = await this.prisma.$transaction(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < input.count; i++) {
        out.push(await this.create(tx, { days: input.days, maxUses: input.maxUses, expiresAt, createdById: actorId, note: input.note || null }));
      }
      return out;
    });
    await this.audit.log(actorId, "gift_code.create", "gift_code", "batch", { count: input.count, days: input.days, maxUses: input.maxUses, note: input.note ?? null });
    return { codes };
  }

  async list(): Promise<AdminGiftCodeDto[]> {
    const rows = await this.prisma.giftCode.findMany({
      include: { createdBy: { select: { displayName: true } }, purchase: { select: { user: { select: { displayName: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return rows.map((c) => ({
      id: c.id, code: this.readable(c.codeEnc), days: c.days, maxUses: c.maxUses, uses: c.uses,
      expiresAt: c.expiresAt?.toISOString() ?? null, disabled: !!c.disabledAt,
      boughtBy: c.purchase?.user.displayName ?? null, createdBy: c.createdBy?.displayName ?? null, note: c.note, createdAt: c.createdAt.toISOString(),
    }));
  }

  async disable(actorId: string, id: string) {
    const { count } = await this.prisma.giftCode.updateMany({ where: { id, disabledAt: null }, data: { disabledAt: new Date() } });
    if (!count) throw new NotFoundException("Code introuvable ou déjà désactivé.");
    await this.audit.log(actorId, "gift_code.disable", "gift_code", id);
  }
}
