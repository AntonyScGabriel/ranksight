-- AlterTable
ALTER TABLE "guesses" ADD COLUMN     "response_ms" INTEGER;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB,
ADD COLUMN     "reason" VARCHAR(500),
ADD COLUMN     "target_user_id" UUID,
ALTER COLUMN "actor_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "audit_logs_target_user_id_created_at_idx" ON "audit_logs"("target_user_id", "created_at" DESC);

-- Journal existant : le joueur concerné par les actions déjà enregistrées sur un compte
UPDATE "audit_logs" SET "target_user_id" = "entity_id"::uuid
WHERE "entity_type" = 'user' AND "entity_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
UPDATE "audit_logs" SET "target_user_id" = ("metadata"->>'targetUserId')::uuid
WHERE "target_user_id" IS NULL AND "action" = 'player_report.resolve'
  AND "metadata"->>'targetUserId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Journal en ajout seulement : aucune modification, aucune suppression d'une entrée de moins d'un an
-- (la purge automatique des entrées de plus d'un an reste possible)
CREATE OR REPLACE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Le journal d''audit ne peut pas être modifié.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."created_at" > (now() AT TIME ZONE 'utc') - INTERVAL '365 days' THEN
    RAISE EXCEPTION 'Une entrée du journal d''audit de moins d''un an ne peut pas être supprimée.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
