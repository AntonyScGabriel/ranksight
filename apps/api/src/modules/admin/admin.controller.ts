import {
  Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query,
} from "@nestjs/common";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { PlayerHistoryQuery } from "@ranksight/shared";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AdminService } from "./admin.service.js";
import { PlayerHistoryService } from "./player-history.service.js";
import { MfaService } from "../auth/mfa.service.js";
import { AuthService } from "../auth/auth.service.js";
import {
  AchievementBody, ConfirmTriageBody, CreateClipBody, ResetStatsBody, ResolveReportBody, ReviewClipBody, ScheduleDailyBody, UpdateUserBody,
  UploadUrlBody,
} from "./admin.dto.js";

/**
 * Toutes les routes /v1/admin/* exigent au minimum MODERATOR.
 * Les actions sensibles (rôles, succès, planning quotidien) exigent ADMIN.
 */
@Controller("admin")
@Roles("MODERATOR")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
    private readonly history: PlayerHistoryService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- Statistiques ----------
  @Get("stats/overview") overview() { return this.admin.overview(); }

  // ---------- Clips ----------
  @Post("clips/upload-url")
  uploadUrl(@Body(new ZodPipe(UploadUrlBody)) b: z.infer<typeof UploadUrlBody>) { return this.admin.uploadUrl(b); }

  @Post("clips")
  createClip(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateClipBody)) b: z.infer<typeof CreateClipBody>) {
    return this.admin.createClip(u.sub, b);
  }

  @Get("clips")
  listClips(
    @Query("status") status = "PENDING_REVIEW",
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("game") game?: string,
  ) { return this.admin.listClips(status, page, game); }

  @Get("clips/:id")
  clip(@Param("id", ParseUUIDPipe) id: string) { return this.admin.clipDetail(id); }

  @Post("clips/:id/review")
  review(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewClipBody)) b: z.infer<typeof ReviewClipBody>) {
    return this.admin.reviewClip(u.sub, id, b);
  }

  /** POST /v1/admin/clips/confirm-triage — { ids } : confirme les avis des trieurs (50 clips au plus) */
  @Post("clips/confirm-triage")
  @HttpCode(200)
  confirmTriage(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ConfirmTriageBody)) b: z.infer<typeof ConfirmTriageBody>) {
    return this.admin.confirmTriage(u.sub, b.ids);
  }

  @Post("clips/:id/unpublish")
  unpublish(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.unpublishClip(u.sub, id);
  }

  @Delete("clips/:id") @HttpCode(204)
  deleteClip(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.deleteClip(u.sub, id);
  }

  @Roles("ADMIN") @Put("daily")
  scheduleDaily(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ScheduleDailyBody)) b: z.infer<typeof ScheduleDailyBody>) {
    return this.admin.scheduleDaily(u.sub, b);
  }

  @Roles("ADMIN") @Delete("daily/:id") @HttpCode(204)
  unscheduleDaily(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.unscheduleDaily(u.sub, id);
  }

  @Get("daily") dailyCalendar() { return this.admin.dailyCalendar(); }

  // ---------- Stockage ----------
  @Roles("OWNER") @Get("storage") storage() { return this.admin.storageOverview(); }

  @Roles("OWNER") @Post("storage/cleanup") @HttpCode(200)
  cleanup(@CurrentUser() u: AuthUser) { return this.admin.storageCleanup(u.sub); }

  // ---------- Utilisateurs ----------
  @Get("users")
  users(@Query("q") q = "", @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) { return this.admin.listUsers(q, page); }

  @Roles("ADMIN") @Patch("users/:id")
  updateUser(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateUserBody)) b: z.infer<typeof UpdateUserBody>) {
    return this.admin.updateUser(u.sub, id, b);
  }

  @Roles("ADMIN") @Post("users/:id/reset-stats")
  resetStats(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(ResetStatsBody)) b: z.infer<typeof ResetStatsBody>) {
    return this.admin.resetStats(u.sub, id, b?.reason);
  }

  /** POST /v1/admin/users/:id/verify-email — confirme l'adresse sans le lien envoyé par email (email non reçu, bug) */
  @Roles("ADMIN") @Post("users/:id/verify-email") @HttpCode(204)
  async verifyEmail(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.admin.verifyEmail(u.sub, id);
  }

  /** POST /v1/admin/users/:id/password-reset — envoie le lien « Mot de passe oublié » au joueur (il n'a pas reçu le sien) */
  @Roles("ADMIN") @Post("users/:id/password-reset")
  @HttpCode(200)
  async sendPasswordReset(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.admin.assertManageable(u.sub, id);
    const sent = await this.auth.sendPasswordResetFor(id);
    if (sent) await this.admin.logAction(u.sub, "user.password_reset_sent", id);
    return { sent };
  }

  /** Téléphone perdu : retire la double authentification d'un compte (fondateur) */
  @Roles("OWNER") @Post("users/:id/mfa/reset") @HttpCode(204)
  async resetMfa(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.mfa.reset(u.sub, id);
  }

  /** Suppression définitive d'un compte (fondateur) ; les administrateurs peuvent bannir */
  @Roles("OWNER") @Delete("users/:id") @HttpCode(204)
  deleteUser(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.deleteUser(u.sub, id);
  }

  // ---------- Historique d'un joueur (enquête, modération) ----------

  /** GET /v1/admin/users/:id/history?page=1&game=lol&mode=DAILY&result=exact&from=AAAA-MM-JJ&to=AAAA-MM-JJ — parties, 50 par page */
  @Get("users/:id/history")
  playerHistory(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodPipe(PlayerHistoryQuery)) q: z.output<typeof PlayerHistoryQuery>) {
    return this.history.history(id, q);
  }

  /** GET /v1/admin/users/:id/stats — records, statistiques par mode et par jeu, parties terminées, évolution */
  @Get("users/:id/stats")
  playerStats(@Param("id", ParseUUIDPipe) id: string) {
    return this.history.stats(id);
  }

  /** GET /v1/admin/users/:id/audit?page=1 — journal d'audit du joueur (adresse IP visible par le fondateur seulement) */
  @Get("users/:id/audit")
  async playerAudit(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) {
    // Rôle lu en base (celui du jeton peut dater d'avant une promotion)
    const role = (await this.prisma.user.findUnique({ where: { id: u.sub }, select: { role: true } }))?.role;
    const showIp = role === "OWNER" || (role === "ADMIN" && (await this.prisma.user.count({ where: { role: "OWNER" } })) === 0);
    return this.history.audit(id, page, { showIp });
  }

  /** GET /v1/admin/users/:id/indicators — indicateurs explicables (aide à l'enquête, aucune sanction automatique) */
  @Get("users/:id/indicators")
  playerIndicators(@Param("id", ParseUUIDPipe) id: string) {
    return this.history.indicators(id);
  }

  // ---------- Signalements ----------
  @Get("reports")
  reports(@Query("status") status = "OPEN", @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.admin.listReports(status, page);
  }

  @Post("reports/:id/resolve")
  resolve(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(ResolveReportBody)) b: z.infer<typeof ResolveReportBody>) {
    return this.admin.resolveReport(u.sub, id, b);
  }

  // ---------- Succès ----------
  @Roles("ADMIN") @Post("achievements")
  createAchievement(@CurrentUser() u: AuthUser, @Body(new ZodPipe(AchievementBody)) b: z.infer<typeof AchievementBody>) {
    return this.admin.upsertAchievement(u.sub, undefined, b);
  }

  @Roles("ADMIN") @Put("achievements/:id")
  updateAchievement(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(AchievementBody)) b: z.infer<typeof AchievementBody>) {
    return this.admin.upsertAchievement(u.sub, id, b);
  }

  // ---------- Audit ----------
  @Roles("OWNER") @Get("audit")
  audit(@Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) { return this.admin.auditTrail(page); }
}
