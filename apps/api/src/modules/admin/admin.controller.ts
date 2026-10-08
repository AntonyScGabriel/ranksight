import {
  Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query,
} from "@nestjs/common";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { AdminService } from "./admin.service.js";
import { MfaService } from "../auth/mfa.service.js";
import {
  AchievementBody, ConfirmTriageBody, CreateClipBody, ResolveReportBody, ReviewClipBody, ScheduleDailyBody, UpdateUserBody, UploadUrlBody,
} from "./admin.dto.js";

/**
 * Toutes les routes /v1/admin/* exigent au minimum MODERATOR.
 * Les actions sensibles (rôles, succès, planning quotidien) exigent ADMIN.
 */
@Controller("admin")
@Roles("MODERATOR")
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly mfa: MfaService) {}

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
  @Get("storage") storage() { return this.admin.storageOverview(); }

  @Roles("ADMIN") @Post("storage/cleanup") @HttpCode(200)
  cleanup(@CurrentUser() u: AuthUser) { return this.admin.storageCleanup(u.sub); }

  // ---------- Utilisateurs ----------
  @Get("users")
  users(@Query("q") q = "", @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) { return this.admin.listUsers(q, page); }

  @Roles("ADMIN") @Patch("users/:id")
  updateUser(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateUserBody)) b: z.infer<typeof UpdateUserBody>) {
    return this.admin.updateUser(u.sub, id, b);
  }

  @Roles("ADMIN") @Post("users/:id/reset-stats")
  resetStats(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.resetStats(u.sub, id);
  }

  /** POST /v1/admin/users/:id/verify-email — confirme l'adresse sans le lien envoyé par email (email non reçu, bug) */
  @Roles("ADMIN") @Post("users/:id/verify-email") @HttpCode(204)
  async verifyEmail(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.admin.verifyEmail(u.sub, id);
  }

  /** Téléphone perdu : retire la double authentification d'un compte (ADMIN) */
  @Roles("ADMIN") @Post("users/:id/mfa/reset") @HttpCode(204)
  async resetMfa(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.mfa.reset(u.sub, id);
  }

  @Roles("ADMIN") @Delete("users/:id") @HttpCode(204)
  deleteUser(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.deleteUser(u.sub, id);
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
  @Roles("ADMIN") @Get("audit")
  audit(@Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) { return this.admin.auditTrail(page); }
}
