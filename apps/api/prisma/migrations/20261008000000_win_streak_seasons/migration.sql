-- =============================================================================
-- Série de victoires (réponses exactes consécutives) et succès de saison.
-- =============================================================================

ALTER TYPE "AchievementCategory" ADD VALUE 'SEASON';

ALTER TABLE "users" ADD COLUMN "best_win_streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "win_streak" INTEGER NOT NULL DEFAULT 0;

-- Séries calculées à partir de l'historique des réponses existantes :
-- chaque réponse non exacte ouvre un nouveau groupe ; la série = nombre de réponses exactes du groupe.
WITH ordered AS (
  SELECT user_id, distance,
         SUM(CASE WHEN distance <> 0 THEN 1 ELSE 0 END) OVER (PARTITION BY user_id ORDER BY created_at, id) AS grp
  FROM guesses
), runs AS (
  SELECT user_id, grp, COUNT(*) FILTER (WHERE distance = 0) AS exact_in_row
  FROM ordered GROUP BY user_id, grp
), summary AS (
  SELECT user_id,
         MAX(exact_in_row) AS best,
         (ARRAY_AGG(exact_in_row ORDER BY grp DESC))[1] AS current
  FROM runs GROUP BY user_id
)
UPDATE "users" u SET "best_win_streak" = s.best, "win_streak" = s.current
FROM summary s WHERE s.user_id = u.id;
