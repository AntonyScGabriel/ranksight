-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "number" INTEGER,
    "name" VARCHAR(60) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "rewards_enabled" BOOLEAN NOT NULL DEFAULT true,
    "rewards" JSONB NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seasons_valid_dates" CHECK ("ends_at" > "starts_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "seasons_key_key" ON "seasons"("key");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_number_key" ON "seasons"("number");

-- CreateIndex
CREATE INDEX "seasons_starts_at_idx" ON "seasons"("starts_at");

-- Deux saisons ne peuvent pas se chevaucher (bornes incluses)
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_no_overlap" EXCLUDE USING gist (tsrange("starts_at", "ends_at", '[]') WITH &&);

-- Les saisons existantes (mois civils depuis SEASON_ONE) sont créées par l'API à son premier démarrage :
-- la saison en cours devient « Saison bêta » et la suivante « Saison 1 » (modifiables dans l'administration).
