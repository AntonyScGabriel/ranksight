-- Promotion sur les réseaux sociaux : consentement facultatif et révocable par clip, jetons de service en lecture seule
-- pour l'outil de production (Toon Pilot), traçabilité des synchronisations et des utilisations. Aucun clip existant
-- n'est concerné : le consentement part à NULL partout.
CREATE TYPE "PromoConsentAction" AS ENUM ('GRANT', 'WITHDRAW');

ALTER TABLE "clips" ADD COLUMN "promo_consent_at" TIMESTAMP(3);

CREATE TABLE "promo_consent_events" (
    "id" UUID NOT NULL,
    "clip_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "PromoConsentAction" NOT NULL,
    "terms_version" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_consent_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_tokens" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "prefix" VARCHAR(12) NOT NULL,
    "scopes" TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    CONSTRAINT "service_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promo_access_logs" (
    "id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "clip_ids" UUID[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_access_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promo_uses" (
    "id" UUID NOT NULL,
    "clip_id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "rank_id" UUID NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_uses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "promo_consent_events_clip_id_created_at_idx" ON "promo_consent_events"("clip_id", "created_at");
CREATE UNIQUE INDEX "service_tokens_token_hash_key" ON "service_tokens"("token_hash");
CREATE INDEX "promo_access_logs_token_id_created_at_idx" ON "promo_access_logs"("token_id", "created_at");
CREATE INDEX "promo_uses_clip_id_created_at_idx" ON "promo_uses"("clip_id", "created_at");

ALTER TABLE "promo_consent_events" ADD CONSTRAINT "promo_consent_events_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_access_logs" ADD CONSTRAINT "promo_access_logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "service_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_uses" ADD CONSTRAINT "promo_uses_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_uses" ADD CONSTRAINT "promo_uses_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "service_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
