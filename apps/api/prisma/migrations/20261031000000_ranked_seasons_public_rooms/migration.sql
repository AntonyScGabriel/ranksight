-- Refonte du classement compétitif, salons publics et privés, suppression des jetons virtuels.
-- Aucune donnée de joueur n'est effacée :
--   * les jetons virtuels (soldes, journal, mises) sont déplacés dans le schéma "archive", hors de l'application ;
--   * les cotes existantes passent à la nouvelle échelle (départ 500 au lieu de 1000) : même rang pour chacun ;
--   * les salons existants restent privés.

-- ---------------------------------------------------------------------------
-- 1. Jetons virtuels et mode Confiance : archivés puis retirés de l'application
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "archive";

-- Plus de solde de départ pour les nouveaux comptes
DROP TRIGGER IF EXISTS "token_welcome" ON "users";
DROP FUNCTION IF EXISTS "token_welcome"();

-- Soldes au moment de la suppression (supprimés avec le compte, comme le reste des données du joueur)
CREATE TABLE "archive"."token_balances" (
    "user_id" UUID NOT NULL,
    "token_balance" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_balances_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "token_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "archive"."token_balances" ("user_id", "token_balance", "archived_at")
SELECT "id", "token_balance", (now() AT TIME ZONE 'UTC') FROM "public"."users";

-- Salons joués en mode Confiance
CREATE TABLE "archive"."confidence_rooms" (
    "room_id" UUID NOT NULL,
    CONSTRAINT "confidence_rooms_pkey" PRIMARY KEY ("room_id"),
    CONSTRAINT "confidence_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "archive"."confidence_rooms" ("room_id") SELECT "id" FROM "public"."rooms" WHERE "confidence";

-- Journal des mouvements et mises : tables déplacées telles quelles (clés étrangères conservées)
ALTER TABLE "public"."token_transactions" SET SCHEMA "archive";
ALTER TABLE "public"."room_stakes" SET SCHEMA "archive";
ALTER TYPE "public"."TokenReason" SET SCHEMA "archive";

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_token_balance_check";
ALTER TABLE "users" DROP COLUMN "token_balance";
ALTER TABLE "rooms" DROP COLUMN "confidence";

-- ---------------------------------------------------------------------------
-- 2. Salons publics et privés, revanche
-- ---------------------------------------------------------------------------
-- CreateEnum
CREATE TYPE "RoomVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "rematch_of_id" UUID,
ADD COLUMN     "visibility" "RoomVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE UNIQUE INDEX "rooms_rematch_of_id_key" ON "rooms"("rematch_of_id");

-- CreateIndex
CREATE INDEX "rooms_visibility_status_game_id_created_at_idx" ON "rooms"("visibility", "status", "game_id", "created_at");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_rematch_of_id_fkey" FOREIGN KEY ("rematch_of_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Une revanche ne rejoue jamais elle-même
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_rematch_check" CHECK ("rematch_of_id" IS NULL OR "rematch_of_id" <> "id");

-- ---------------------------------------------------------------------------
-- 3. Classement compétitif : nouvelle échelle, saisons
-- ---------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "competitive_ratings" ADD COLUMN     "career_games" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "rating" SET DEFAULT 500,
ALTER COLUMN "peak" SET DEFAULT 500;

-- AlterTable
ALTER TABLE "rating_changes" ADD COLUMN     "reason" VARCHAR(16);

-- AlterTable
ALTER TABLE "seasons" ADD COLUMN     "competitive_reset_at" TIMESTAMP(3);

-- Cotes existantes : même rang sur la nouvelle échelle (écart de 500 points, plancher à 100) ;
-- les duels déjà comptés deviennent des duels de carrière (coefficient de placement)
UPDATE "competitive_ratings" SET
  "rating" = GREATEST(100, "rating" - 500),
  "peak" = GREATEST(100, "peak" - 500),
  "career_games" = "games";
UPDATE "rating_changes" SET
  "before" = GREATEST(100, "before" - 500),
  "after" = GREATEST(100, "after" - 500),
  "delta" = GREATEST(100, "after" - 500) - GREATEST(100, "before" - 500);
UPDATE "rating_changes" SET "reason" = 'PAIR_LIMIT' WHERE NOT "counted";

ALTER TABLE "competitive_ratings" ADD CONSTRAINT "competitive_ratings_career_check" CHECK ("career_games" >= "games");
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_reason_check"
  CHECK (("counted" AND "reason" IS NULL) OR (NOT "counted" AND "reason" IN ('PAIR_LIMIT', 'EARLY_FORFEIT')));

-- Saisons déjà terminées : elles sont antérieures au classement compétitif par saison, rien à réinitialiser
UPDATE "seasons" SET "competitive_reset_at" = (now() AT TIME ZONE 'UTC') WHERE "ends_at" < (now() AT TIME ZONE 'UTC');

-- CreateTable
CREATE TABLE "competitive_season_results" (
    "season_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "rating" INTEGER NOT NULL,
    "peak" INTEGER NOT NULL,
    "tier" VARCHAR(12) NOT NULL,
    "placement" INTEGER,
    "games" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "draws" INTEGER NOT NULL,
    "reset_to" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitive_season_results_pkey" PRIMARY KEY ("season_id","user_id","scope")
);

-- CreateIndex
CREATE INDEX "competitive_season_results_season_id_scope_placement_idx" ON "competitive_season_results"("season_id", "scope", "placement");

-- CreateIndex
CREATE INDEX "competitive_season_results_user_id_idx" ON "competitive_season_results"("user_id");

-- AddForeignKey
ALTER TABLE "competitive_season_results" ADD CONSTRAINT "competitive_season_results_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitive_season_results" ADD CONSTRAINT "competitive_season_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "competitive_season_results" ADD CONSTRAINT "competitive_season_results_check"
  CHECK ("tier" IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER') AND ("placement" IS NULL OR "placement" > 0)
    AND "reset_to" >= 100 AND "wins" + "losses" + "draws" = "games");
