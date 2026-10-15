-- Mort subite dans les salons privés : uniquement des ajouts (valeurs par défaut pour les salons existants).
-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "decided_by" VARCHAR(16),
ADD COLUMN     "sudden_death" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sudden_death_rounds" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "room_players" ADD COLUMN     "finalist" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "room_rounds" ADD COLUMN     "sudden_death" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_sudden_death_rounds_check" CHECK ("sudden_death_rounds" BETWEEN 0 AND 3);
