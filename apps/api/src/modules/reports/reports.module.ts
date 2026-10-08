import { Body, ConflictException, Controller, Module, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CreateReportInput } from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { PrismaService } from "../../prisma/prisma.service.js";

const AUTO_HIDE_THRESHOLD = 5; // un clip signalé par 5 joueurs distincts repasse en revue

@Controller("reports")
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /v1/reports — { clipId, reason, details? } ; 1 signalement par joueur et par clip */
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateReportInput)) body: CreateReportInput) {
    try {
      const report = await this.prisma.report.create({ data: { ...body, reporterId: user.sub } });
      const clip = await this.prisma.clip.update({
        where: { id: body.clipId },
        data: { reportCount: { increment: 1 } },
      });
      if (clip.reportCount >= AUTO_HIDE_THRESHOLD && clip.status === "APPROVED") {
        await this.prisma.clip.update({ where: { id: clip.id }, data: { status: "PENDING_REVIEW" } });
      }
      return { id: report.id };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException({ code: "ALREADY_REPORTED", message: "Tu as déjà signalé ce clip." });
      throw e;
    }
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
