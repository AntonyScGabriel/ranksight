-- Tournois événements (administration) : visibles par tous, jusqu'à 64 places, récompense pour le vainqueur.
-- Les tournois existants deviennent des tournois de joueurs (is_event = false) ; aucune donnée modifiée.
ALTER TABLE "tournaments" ADD COLUMN "is_event" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "title" VARCHAR(60),
ADD COLUMN "reward_cosmetic_id" UUID,
ADD COLUMN "reward_vip_days" INTEGER,
ADD COLUMN "reward_granted_at" TIMESTAMP(3);

CREATE INDEX "tournaments_is_event_status_idx" ON "tournaments"("is_event", "status");
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_reward_cosmetic_id_fkey" FOREIGN KEY ("reward_cosmetic_id") REFERENCES "cosmetics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 32 et 64 places, réservées aux événements
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_capacity_check";
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_capacity_check" CHECK ("capacity" IN (4, 8, 16) OR ("is_event" AND "capacity" IN (32, 64)));
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_bracket_size_check";
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_bracket_size_check" CHECK ("bracket_size" IS NULL OR "bracket_size" IN (4, 8, 16, 32, 64));
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_reward_vip_days_check" CHECK ("reward_vip_days" IS NULL OR "reward_vip_days" BETWEEN 1 AND 365);