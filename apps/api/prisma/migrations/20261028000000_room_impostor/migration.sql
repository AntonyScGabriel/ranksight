-- Mode Intrus dans les salons privés : uniquement des ajouts.
-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "impostor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phase" VARCHAR(8) NOT NULL DEFAULT 'ANSWER';

-- AlterTable
ALTER TABLE "room_rounds" ADD COLUMN     "alt_clip_id" UUID,
ADD COLUMN     "impostor_id" UUID;

-- CreateTable
CREATE TABLE "room_votes" (
    "room_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "voter_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_votes_pkey" PRIMARY KEY ("room_id","round","voter_id")
);

-- CreateTable
CREATE TABLE "room_bonuses" (
    "room_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" VARCHAR(20) NOT NULL,

    CONSTRAINT "room_bonuses_pkey" PRIMARY KEY ("room_id","round","user_id")
);

-- AddForeignKey
ALTER TABLE "room_votes" ADD CONSTRAINT "room_votes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bonuses" ADD CONSTRAINT "room_bonuses_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_phase_check" CHECK ("phase" IN ('ANSWER', 'VOTE'));
ALTER TABLE "room_votes" ADD CONSTRAINT "room_votes_not_self_check" CHECK ("voter_id" <> "target_id");
ALTER TABLE "room_bonuses" ADD CONSTRAINT "room_bonuses_points_check" CHECK ("points" >= 0);
