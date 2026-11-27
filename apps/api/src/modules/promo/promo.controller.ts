import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { PROMO_CONSENT_LABEL, PROMO_PLATFORMS, PROMO_REMOVAL_DAYS, PROMO_TERMS_VERSION, PromoConsentInput, PromoPlatform } from "@ranksight/shared";
import { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { PromoService } from "./promo.service.js";
import { CurrentServiceToken, ServiceTokenGuard, type ServiceTokenContext } from "./service-token.js";

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z.string().uuid().optional(),
});
const StatusBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });
const UseBody = z.object({ reference: z.string().trim().min(1).max(100) });
const PublicationBody = z.object({
  platform: PromoPlatform,
  url: z.string().trim().url().startsWith("https://").max(300),
  publishedAt: z.coerce.date(),
  /** Publicité payante : jamais couverte par l'accord des joueurs (true est refusé) */
  paid: z.boolean().default(false),
});
const NoteBody = z.object({ note: z.string().trim().max(300).optional() });
const StaffNoteBody = z.object({ note: z.string().trim().min(3).max(300) });
const ReviewBody = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), muteAudio: z.boolean().default(false), note: z.string().trim().max(300).optional() });
const RemovalQuery = z.object({ status: z.enum(["OPEN", "DONE"]).default("OPEN") });
const TokenBody = z.object({ name: z.string().trim().min(2).max(60) });

/**
 * Outil de production des vidéos promotionnelles (Toon Pilot) : jeton de service uniquement.
 * Seuls les clips dont l'auteur a donné son accord et que la modération a jugés aptes sont transmis, avec le rang validé.
 */
@Controller("promo")
@Public()
@UseGuards(ServiceTokenGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  @Get("games")
  games(@CurrentServiceToken() token: ServiceTokenContext) {
    return this.promo.games(token);
  }

  @Get("clips")
  clips(@CurrentServiceToken() token: ServiceTokenContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.promo.clips(token, q.limit, q.cursor);
  }

  @Get("clips/:id")
  clip(@CurrentServiceToken() token: ServiceTokenContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.promo.clip(token, id);
  }

  @Post("clips/status")
  @HttpCode(200)
  status(@CurrentServiceToken() token: ServiceTokenContext, @Body(new ZodPipe(StatusBody)) b: z.infer<typeof StatusBody>) {
    return this.promo.status(token, b.ids);
  }

  @Post("clips/:id/uses")
  uses(@CurrentServiceToken() token: ServiceTokenContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(UseBody)) b: z.infer<typeof UseBody>) {
    return this.promo.recordUse(token, id, b.reference);
  }

  @Post("uses/:id/discard")
  @HttpCode(200)
  discard(@CurrentServiceToken() token: ServiceTokenContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.promo.discardUse(token, id);
  }

  @Post("uses/:id/publications")
  publication(@CurrentServiceToken() token: ServiceTokenContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(PublicationBody)) b: z.infer<typeof PublicationBody>) {
    return this.promo.recordPublication(token, id, b);
  }

  @Get("removals")
  removals(@CurrentServiceToken() token: ServiceTokenContext) {
    return this.promo.removals(token);
  }

  @Post("removals/:id/done")
  @HttpCode(200)
  removalDone(@CurrentServiceToken() token: ServiceTokenContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(NoteBody)) b: z.infer<typeof NoteBody>) {
    return this.promo.completeRemovalByToken(token, id, b.note);
  }
}

/** Option proposée à l'envoi d'un clip : affichée seulement une fois les nouvelles conditions validées */
@Controller("clips")
export class PromoTermsController {
  constructor(private readonly promo: PromoService) {}

  @Public()
  @Get("promo-terms")
  terms() {
    return {
      enabled: this.promo.consentEnabled,
      version: PROMO_TERMS_VERSION,
      label: PROMO_CONSENT_LABEL,
      platforms: PROMO_PLATFORMS,
      paidAds: false,
      removalDays: PROMO_REMOVAL_DAYS,
    };
  }
}

/** Accord de l'auteur sur l'un de ses clips : lui seul peut le donner ou le retirer */
@Controller("clips/mine")
export class PromoConsentController {
  constructor(private readonly promo: PromoService) {}

  @Post(":id/promo-consent")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  consent(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(PromoConsentInput)) b: PromoConsentInput) {
    return this.promo.setOwnConsent(user.sub, id, b.consent);
  }
}

/**
 * Administration : la modération vérifie l'aptitude d'un clip et traite les demandes de suppression. Elle ne peut jamais
 * donner un consentement à la place de l'auteur. Jetons de service : fondateur uniquement.
 */
@Controller("admin")
@Roles("MODERATOR")
export class PromoAdminController {
  constructor(private readonly promo: PromoService) {}

  @Get("clips/:id/promo")
  clipPromo(@Param("id", ParseUUIDPipe) id: string) {
    return this.promo.clipPromo(id);
  }

  @Post("clips/:id/promo-review")
  @HttpCode(200)
  review(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewBody)) b: z.infer<typeof ReviewBody>) {
    return this.promo.review(user.sub, id, b);
  }

  @Get("promo/removals")
  removals(@Query(new ZodPipe(RemovalQuery)) q: z.infer<typeof RemovalQuery>) {
    return this.promo.listRemovals(q.status);
  }

  @Post("promo/removals/:id/done")
  @HttpCode(200)
  removalDone(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(StaffNoteBody)) b: z.infer<typeof StaffNoteBody>) {
    return this.promo.completeRemovalByStaff(user.sub, id, b.note);
  }

  @Roles("OWNER")
  @Get("service-tokens")
  tokens() {
    return this.promo.listTokens();
  }

  @Roles("OWNER")
  @Post("service-tokens")
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TokenBody)) b: z.infer<typeof TokenBody>) {
    return this.promo.createToken(user.sub, b.name);
  }

  @Roles("OWNER")
  @Post("service-tokens/:id/revoke")
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.promo.revokeToken(user.sub, id);
  }
}
