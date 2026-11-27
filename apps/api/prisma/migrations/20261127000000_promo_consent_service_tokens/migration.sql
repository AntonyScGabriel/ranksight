-- Promotion sur les réseaux sociaux (vidéos « Devine le rang ») :
-- - accord facultatif et révocable, donné seulement par l'auteur d'un clip proposé par un joueur, avec son historique ;
-- - vérification d'aptitude par la modération (voix, identifiants, musique) : ce n'est jamais un consentement ;
-- - jetons de service en lecture seule pour l'outil de production, traçabilité des synchronisations et des utilisations ;
-- - publications déclarées sur les comptes officiels et demandes de suppression après un retrait (30 jours).
-- Aucun clip existant n'est concerné : l'accord part à NULL et la vérification à PENDING partout.
-- Les tables de preuve n'ont pas de clé étrangère vers les clips : elles restent si un clip est supprimé.
CREATE TYPE "PromoConsentAction" AS ENUM ('GRANT', 'WITHDRAW');
CREATE TYPE "PromoReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "PromoPlatform" AS ENUM ('TIKTOK', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS');
CREATE TYPE "PromoRemovalStatus" AS ENUM ('OPEN', 'DONE');

ALTER TABLE "clips" ADD COLUMN "promo_consent_at" TIMESTAMP(3),
ADD COLUMN "promo_review_status" "PromoReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "promo_reviewed_at" TIMESTAMP(3),
ADD COLUMN "promo_reviewer_id" UUID,
ADD COLUMN "promo_review_note" VARCHAR(300),
ADD COLUMN "promo_mute_audio" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "promo_consent_events" (
    "id" UUID NOT NULL,
    "clip_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "PromoConsentAction" NOT NULL,
    "terms_version" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(100),
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
    "consent_event_id" UUID NOT NULL,
    "consent_version" VARCHAR(32) NOT NULL,
    "consent_granted_at" TIMESTAMP(3) NOT NULL,
    "discarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_uses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promo_publications" (
    "id" UUID NOT NULL,
    "use_id" UUID NOT NULL,
    "clip_id" UUID NOT NULL,
    "platform" "PromoPlatform" NOT NULL,
    "post_url" VARCHAR(300) NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promo_removal_requests" (
    "id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "clip_id" UUID NOT NULL,
    "reason" VARCHAR(100) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "PromoRemovalStatus" NOT NULL DEFAULT 'OPEN',
    "done_at" TIMESTAMP(3),
    "done_by_token_id" UUID,
    "done_by_user_id" UUID,
    "note" VARCHAR(300),
    CONSTRAINT "promo_removal_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "promo_consent_events_clip_id_created_at_idx" ON "promo_consent_events"("clip_id", "created_at");
CREATE UNIQUE INDEX "service_tokens_token_hash_key" ON "service_tokens"("token_hash");
CREATE INDEX "promo_access_logs_token_id_created_at_idx" ON "promo_access_logs"("token_id", "created_at");
CREATE INDEX "promo_uses_clip_id_created_at_idx" ON "promo_uses"("clip_id", "created_at");
CREATE INDEX "promo_publications_clip_id_idx" ON "promo_publications"("clip_id");
CREATE UNIQUE INDEX "promo_publications_use_id_platform_key" ON "promo_publications"("use_id", "platform");
CREATE UNIQUE INDEX "promo_removal_requests_publication_id_key" ON "promo_removal_requests"("publication_id");
CREATE INDEX "promo_removal_requests_status_due_at_idx" ON "promo_removal_requests"("status", "due_at");
CREATE INDEX "promo_removal_requests_clip_id_idx" ON "promo_removal_requests"("clip_id");

ALTER TABLE "promo_access_logs" ADD CONSTRAINT "promo_access_logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "service_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_uses" ADD CONSTRAINT "promo_uses_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "service_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_publications" ADD CONSTRAINT "promo_publications_use_id_fkey" FOREIGN KEY ("use_id") REFERENCES "promo_uses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_removal_requests" ADD CONSTRAINT "promo_removal_requests_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "promo_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
