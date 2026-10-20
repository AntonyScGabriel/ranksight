-- Événements programmés : heure de lancement automatique et rappel aux inscrits
ALTER TABLE "tournaments" ADD COLUMN "starts_at" TIMESTAMP(3),
ADD COLUMN "reminder_sent_at" TIMESTAMP(3);
CREATE INDEX "tournaments_status_starts_at_idx" ON "tournaments"("status", "starts_at");
