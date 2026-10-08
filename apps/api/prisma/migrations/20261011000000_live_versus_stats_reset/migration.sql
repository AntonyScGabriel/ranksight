-- Duels en direct (manches synchronisées) et remise à zéro des statistiques par l'équipe

-- Les duels asynchrones encore ouverts ne sont pas compatibles avec le mode en direct : ils sont annulés
UPDATE "versus_matches" SET "status" = 'CANCELED' WHERE "status" IN ('OPEN', 'PENDING', 'ACTIVE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "stats_reset_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "versus_matches" DROP COLUMN "creator_finished_at",
DROP COLUMN "opponent_finished_at",
ADD COLUMN     "current_round" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "forfeited_by_id" UUID,
ADD COLUMN     "round_ends_at" TIMESTAMP(3),
ADD COLUMN     "round_starts_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "versus_matches_status_round_ends_at_idx" ON "versus_matches"("status", "round_ends_at");
