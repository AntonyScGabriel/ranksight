import { Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { currentIp } from "../request-context.js";

/** Adresse IP valide pour la colonne inet (sans le préfixe IPv4 mappé en IPv6) */
const cleanIp = (ip?: string) => (ip ? ip.replace(/^::ffff:/, "") : undefined);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(actorId: string, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue) {
    return this.prisma.auditLog.create({ data: { actorId, action, entityType, entityId, metadata, ip: cleanIp(currentIp()) } });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
