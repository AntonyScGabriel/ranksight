-- Défis du jour : plusieurs clips par jeu et par jour (numéro du défi : 1, 2, 3). Les défis existants deviennent le n° 1.
DROP INDEX "daily_challenges_date_game_id_key";

ALTER TABLE "daily_challenges" ADD COLUMN     "slot" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "daily_challenges_date_game_id_slot_key" ON "daily_challenges"("date", "game_id", "slot");
