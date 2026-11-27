import { Module } from "@nestjs/common";
import { PromoAdminController, PromoConsentController, PromoController, PromoTermsController } from "./promo.controller.js";
import { PromoService } from "./promo.service.js";
import { ServiceTokenGuard } from "./service-token.js";

@Module({
  controllers: [PromoController, PromoTermsController, PromoConsentController, PromoAdminController],
  providers: [PromoService, ServiceTokenGuard],
  exports: [PromoService],
})
export class PromoModule {}
