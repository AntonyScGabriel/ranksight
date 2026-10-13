import { Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { currentIp } from "../request-context.js";

/** Adresse IP valide pour la colonne inet (sans le préfixe IPv4 mappé en IPv6) */
const cleanIp = (ip?: string) => (ip ? ip.replace(/^::ffff:/, "") : undefined);

export interface AuditDetails {
  /** Joueur concerné (par défaut : l'entité elle-même quand c'est un compte) */
  targetUserId?: string | null;
  /** Valeurs avant et après la modification */
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  /** Motif donné par l'équipe */
  reason?: string | null;
}

/**
 * Journal d'audit, en ajout seulement : la base refuse toute modification et toute suppression d'une entrée de moins
 * d'un an (déclencheur `audit_logs_append_only`). Acteur NULL = action du système (tâche automatique).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(actorId: string | null, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue, details: AuditDetails = {}) {
    const targetUserId = details.targetUserId !== undefined ? details.targetUserId : entityType === "user" ? entityId : null;
    return this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        entityType,
        entityId,
        metadata,
        targetUserId,
        before: details.before,
        after: details.after,
        reason: details.reason?.trim() || null,
        ip: actorId ? cleanIp(currentIp()) : undefined,
      },
    });
  }

  /** Action du système (tâche automatique, record établi en jouant) */
  system(action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue, details: AuditDetails = {}) {
    return this.log(null, action, entityType, entityId, metadata, details);
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
