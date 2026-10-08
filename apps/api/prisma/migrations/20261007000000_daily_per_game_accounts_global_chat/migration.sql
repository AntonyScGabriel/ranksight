-- =============================================================================
-- Défis quotidiens par jeu, comptes email + mot de passe, chat global,
-- pseudo en jeu sur les clips, catalogue limité à 4 jeux.
-- =============================================================================

-- ---------- Comptes classiques ----------
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3),
ADD COLUMN "password_hash" TEXT;

-- Les comptes existants créés via Google ou Discord ont un email déjà vérifié par le fournisseur
UPDATE "users" u SET "email_verified_at" = u."created_at"
WHERE u."email" IS NOT NULL AND EXISTS (SELECT 1 FROM "oauth_accounts" o WHERE o."user_id" = u."id");

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Clips : pseudo en jeu, plateforme, région ----------
-- L'ancien champ "creator_handle" contenait déjà le pseudo du joueur filmé : il est conservé sous son nouveau nom
ALTER TABLE "clips" RENAME COLUMN "creator_handle" TO "in_game_pseudo";
ALTER TABLE "clips" ALTER COLUMN "in_game_pseudo" TYPE VARCHAR(32) USING LEFT("in_game_pseudo", 32);
ALTER TABLE "clips" ADD COLUMN "platform" VARCHAR(20),
ADD COLUMN "region" VARCHAR(20);
CREATE UNIQUE INDEX "clips_id_game_id_key" ON "clips"("id", "game_id");

-- ---------- Un défi quotidien par jeu ----------
ALTER TABLE "daily_challenges" DROP CONSTRAINT "daily_challenges_clip_id_fkey";
DROP INDEX "daily_challenges_date_key";
ALTER TABLE "daily_challenges" ADD COLUMN "game_id" UUID;
UPDATE "daily_challenges" d SET "game_id" = c."game_id" FROM "clips" c WHERE c."id" = d."clip_id";
ALTER TABLE "daily_challenges" ALTER COLUMN "game_id" SET NOT NULL;
CREATE INDEX "daily_challenges_clip_id_idx" ON "daily_challenges"("clip_id");
-- Une seule ligne par (jour, jeu) : impossible d'avoir deux défis du même jeu le même jour
CREATE UNIQUE INDEX "daily_challenges_date_game_id_key" ON "daily_challenges"("date", "game_id");
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Le clip d'un défi appartient forcément au jeu du défi
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_clip_id_game_id_fkey" FOREIGN KEY ("clip_id", "game_id") REFERENCES "clips"("id", "game_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Catalogue : League of Legends, Valorant, Rocket League, Counter-Strike 2 ----------
UPDATE "games" SET "is_active" = false WHERE "slug" NOT IN ('lol', 'valorant', 'rocket-league', 'cs2');
UPDATE "games" SET "name" = 'Counter-Strike 2' WHERE "slug" = 'cs2';

-- ---------- Chat global ----------
CREATE TABLE "global_messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,

    CONSTRAINT "global_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "global_messages_created_at_idx" ON "global_messages"("created_at" DESC);
CREATE INDEX "global_messages_user_id_created_at_idx" ON "global_messages"("user_id", "created_at" DESC);
ALTER TABLE "global_messages" ADD CONSTRAINT "global_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "global_messages" ADD CONSTRAINT "global_messages_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
