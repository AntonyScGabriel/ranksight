-- Objets SQL présents dans la base hors schema.prisma (un par ligne, même format que sql-only-objects.txt).
-- Lecture seule. Utilisé par schema-objects.test.mjs et deploy/restore.sh.
SELECT CASE c.contype WHEN 'c' THEN 'check' ELSE 'exclude' END || ':' || t.relname || '.' || c.conname AS k
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE c.contype IN ('c', 'x') AND n.nspname = 'public'
UNION ALL
SELECT 'trigger:' || t.relname || '.' || g.tgname
  FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE NOT g.tgisinternal AND n.nspname = 'public'
UNION ALL
-- Index partiels ou sur expression (hors index portés par une contrainte d'exclusion, comptée plus haut)
SELECT 'index:' || t.relname || '.' || i.relname
  FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = i.relnamespace
 WHERE n.nspname = 'public' AND (x.indpred IS NOT NULL OR x.indexprs IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid AND c.contype = 'x')
UNION ALL
SELECT 'function:' || p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'schema:' || nspname FROM pg_namespace
 WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN ('information_schema', 'public')
ORDER BY 1;
