import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Durées de conservation annoncées dans la politique de confidentialité, appliquées chaque nuit (4 h UTC) :
 * - sessions (adresse IP, appareil) : supprimées 30 jours après leur fin ;
 * - liens de réinitialisation et de confirmation : 7 jours après usage ou expiration ;
 * - journal d'audit, signalements traités, messages supprimés du chat global : 1 an.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(private readonly prisma: PrismaService, @Inject(REDIS) private readonly redis: Redis) {}

  @Cron("0 4 * * *", { timeZone: "UTC" })
  async nightly() {
    if (!(await this.redis.set("retention:lock", "1", "EX", 3600, "NX"))) return;
    try {
      await this.purge();
    } finally {
      await this.redis.del("retention:lock");
    }
  }

  async purge() {
    const [sessions, resets, verifications, audit, reports, messages] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: ago(30) } }, { revokedAt: { lt: ago(30) } }] } }),
      this.prisma.passwordResetToken.deleteMany({ where: { OR: [{ usedAt: { lt: ago(7) } }, { expiresAt: { lt: ago(7) } }] } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { OR: [{ usedAt: { lt: ago(7) } }, { expiresAt: { lt: ago(7) } }] } }),
      this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: ago(365) } } }),
      this.prisma.chatReport.deleteMany({ where: { status: { not: "OPEN" }, resolvedAt: { lt: ago(365) } } }),
      this.prisma.globalMessage.deleteMany({ where: { deletedAt: { lt: ago(365) } } }),
    ]);
    const total = sessions.count + resets.count + verifications.count + audit.count + reports.count + messages.count;
    if (total) this.logger.log(`Conservation des données : ${total} enregistrement(s) expiré(s) supprimé(s)`);
    return { sessions: sessions.count, resets: resets.count, verifications: verifications.count, audit: audit.count, reports: reports.count, messages: messages.count };
  }
}

@Module({ providers: [DataRetentionService] })
export class MaintenanceModule {}
