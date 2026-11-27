import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { PROMO_CONSENT_LABEL, PROMO_TERMS_VERSION, PromoConsentInput } from "@ranksight/shared";
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
const TokenBody = z.object({ name: z.string().trim().min(2).max(60) });

/**
 * Export pour l'outil de production des vidéos promotionnelles (Toon Pilot) : lecture seule, jeton de service uniquement.
 * Seuls les clips dont l'auteur a donné son accord sont transmis, avec le rang validé par la modération.
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
}

/** Option proposée à l'envoi d'un clip : affichée seulement une fois les nouvelles conditions validées */
@Controller("clips")
export class PromoTermsController {
  constructor(private readonly promo: PromoService) {}

  @Public()
  @Get("promo-terms")
  terms() {
    return { enabled: this.promo.consentEnabled, version: PROMO_TERMS_VERSION, label: PROMO_CONSENT_LABEL };
  }
}

/** Accord du joueur sur l'un de ses clips */
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

/** Administration : accord pour un clip ajouté par la modération, historique, jetons de service (fondateur) */
@Controller("admin")
@Roles("MODERATOR")
export class PromoAdminController {
  constructor(private readonly promo: PromoService) {}

  @Post("clips/:id/promo-consent")
  @HttpCode(200)
  consent(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(PromoConsentInput)) b: PromoConsentInput) {
    return this.promo.setStaffConsent(user.sub, id, b.consent);
  }

  @Get("clips/:id/promo")
  history(@Param("id", ParseUUIDPipe) id: string) {
    return this.promo.history(id);
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
