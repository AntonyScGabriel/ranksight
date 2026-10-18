#!/bin/sh
# Test de deploy/elo-rehearsal.sh et des requêtes deploy/sql/elo-*.sql, sur des bases jetables locales :
# base « avant conversion » construite avec les migrations du dépôt jusqu'à 20261030 et des cotes d'exemple
# (sous 600, à 600, au-dessus, records, historique compté ou non), sauvegarde, répétition sur une copie,
# comparaison exacte, base source intacte, détection d'une conversion fausse, audit sans écriture.
#
#   PGHOST=localhost PGUSER=ranksight PGPASSWORD=ranksight sh deploy/tests/elo-rehearsal-test.sh
#
# Ne crée et ne supprime que des bases nommées elotest_<horodatage>_*.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
PG_EXEC=${PG_EXEC-}
USER_=${PGUSER:-ranksight}
RUN=elotest_$(date -u +%Y%m%d%H%M%S)
work=$(mktemp -d)
case "${PGHOST:-localhost}" in localhost | 127.0.0.1 | /*) ;; *) [ "${CI:-}" = "true" ] || { echo "Refusé : serveur PostgreSQL distant"; exit 1; } ;; esac

pg() { $PG_EXEC "$@"; }
q() { _q_db=$1; shift; pg psql -X -q -v ON_ERROR_STOP=1 -U "$USER_" -d "$_q_db" -At "$@"; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $*"; }
fail() { echo "not ok - $*" >&2; exit 1; }
cleanup() {
  for d in $(q postgres -c "SELECT datname FROM pg_database WHERE datname LIKE '${RUN}%'"); do q postgres -c "DROP DATABASE IF EXISTS \"$d\"" || true; done
  rm -rf "$work"
}
trap cleanup EXIT

# Applique les migrations du dépôt dont le nom est compris entre $2 et $3 (inclus), dans l'ordre
cat > "$work/apply.sh" << 'EOF'
#!/bin/sh
set -eu
db=$1; from=$2; to=$3; dir=$4
for m in $(ls "$dir" | grep -E '^[0-9]{14}_' | sort); do
  if [ "$m" \< "$from" ] || [ "$m" \> "$to" ]; then continue; fi
  $PG_EXEC psql -X -q -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$db" -f - < "$dir/$m/migration.sql" > /dev/null 2>&1 || { echo "échec $m"; exit 1; }
  echo "appliquée : $m"
done
EOF
migrations="$root/apps/api/prisma/migrations"
export PG_EXEC PGUSER="$USER_"

# 1. Base « avant conversion » et cotes d'exemple
q postgres -c "CREATE DATABASE ${RUN}_src"
sh "$work/apply.sh" "${RUN}_src" 0 20261030999999 "$migrations" > /dev/null
q "${RUN}_src" << 'SQL'
INSERT INTO games (id, slug, name) VALUES ('00000000-0000-4000-8000-0000000000a1', 'elo-test', 'Jeu de test');
INSERT INTO users (id, username, display_name, updated_at)
SELECT ('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'elo' || i, 'Joueur ' || i, now() FROM generate_series(1, 9) i;
-- Cote, record : 100 (plancher), 450, 599 (sous 600), 600 (limite), 601, 1000, 1210, 1700 ; record sous 600 aussi
INSERT INTO competitive_ratings (user_id, scope, rating, peak, games, wins, losses, draws, updated_at) VALUES
  ('00000000-0000-4000-8000-000000000101', 'global', 100, 100, 4, 0, 4, 0, now()),
  ('00000000-0000-4000-8000-000000000102', 'global', 450, 580, 6, 1, 5, 0, now()),
  ('00000000-0000-4000-8000-000000000103', 'global', 599, 640, 3, 1, 2, 0, now()),
  ('00000000-0000-4000-8000-000000000104', 'global', 600, 600, 2, 1, 1, 0, now()),
  ('00000000-0000-4000-8000-000000000105', 'global', 601, 700, 5, 2, 2, 1, now()),
  ('00000000-0000-4000-8000-000000000106', 'global', 1000, 1000, 0, 0, 0, 0, now()),
  ('00000000-0000-4000-8000-000000000107', 'global', 1210, 1300, 9, 6, 3, 0, now()),
  ('00000000-0000-4000-8000-000000000108', 'global', 1700, 1750, 20, 15, 5, 0, now()),
  ('00000000-0000-4000-8000-000000000108', 'elo-test', 1500, 1500, 3, 3, 0, 0, now()),
  ('00000000-0000-4000-8000-000000000109', 'elo-test', 850, 900, 2, 1, 1, 0, now());
-- Historique : écarts qui traversent 600, ligne non comptée (limite par adversaire)
INSERT INTO rating_changes (id, user_id, scope, match_id, opponent_id, result, before, after, delta, counted) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000102', 'global', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000105', 'LOSS', 610, 590, -20, true),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000105', 'global', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000102', 'WIN', 581, 601, 20, true),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000108', 'global', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000107', 'WIN', 1700, 1700, 0, false),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000107', 'global', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000108', 'LOSS', 1215, 1210, -5, true);
SQL
pg pg_dump -U "$USER_" -d "${RUN}_src" -Fc > "$work/src.dump"
before=$(q "${RUN}_src" -c "SELECT string_agg(user_id || scope || rating || '/' || peak, ',' ORDER BY user_id, scope) FROM competitive_ratings")
ok "base avant conversion : migrations jusqu'à 20261030 et cotes d'exemple"

# 2. Audit en lecture seule : aucune instruction d'écriture, transaction READ ONLY, résultats attendus
code=$(sed -e 's/--.*$//' "$root/deploy/sql/elo-audit.sql" | grep -v '^\\' | tr 'a-z' 'A-Z')
if printf '%s' "$code" | grep -Eq '\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|VACUUM)\b'; then fail "instruction d'écriture dans elo-audit.sql"; fi
grep -q "READ ONLY" "$root/deploy/sql/elo-audit.sql" || fail "transaction en lecture seule"
pg psql -X -v ON_ERROR_STOP=1 -U "$USER_" -d "${RUN}_src" -f - < "$root/deploy/sql/elo-audit.sql" > "$work/audit.txt"
grep -q "avant conversion" "$work/audit.txt" || fail "état détecté"
# Sous 600 (cote ou record) : joueurs 101, 102, 103 (global) ; la ligne « global » de la section 3 compte 3 joueurs
sed -n '/== 3\./,/Détail/p' "$work/audit.txt" | grep -Eq '^ *global *\| *3 *\|' || { cat "$work/audit.txt"; fail "décompte des cotes sous 600"; }
[ "$(q "${RUN}_src" -c "SELECT string_agg(user_id || scope || rating || '/' || peak, ',' ORDER BY user_id, scope) FROM competitive_ratings")" = "$before" ] || fail "audit : données modifiées"
if printf 'BEGIN TRANSACTION READ ONLY;\nUPDATE competitive_ratings SET rating = rating;\nROLLBACK;\n' | pg psql -X -v ON_ERROR_STOP=1 -U "$USER_" -d "${RUN}_src" -f - > /dev/null 2>&1; then fail "écriture acceptée en lecture seule"; fi
ok "audit : lecture seule (aucune écriture possible), 3 joueurs sous 600 détectés, base inchangée"

# 3. Répétition sur une copie isolée : conversion conforme
q postgres -c "CREATE DATABASE ${RUN}_copy"
(cd "$root/deploy" && REHEARSAL_OUT="$work/out1" REHEARSAL_PG_EXEC="$PG_EXEC" REHEARSAL_DB="${RUN}_copy" REHEARSAL_PGUSER="$USER_" \
  MIGRATE_CMD="sh $work/apply.sh ${RUN}_copy 20261031000000 99999999999999 $migrations" sh elo-rehearsal.sh "$work/src.dump") > "$work/r1.log" 2>&1 || { cat "$work/r1.log"; fail "répétition"; }
grep -q "Répétition réussie" "$work/r1.log" || { cat "$work/r1.log"; fail "comparaison"; }
[ "$(q "${RUN}_copy" -c "SELECT string_agg(user_id || scope || rating || '/' || peak || '/' || career_games, ',' ORDER BY user_id, scope) FROM competitive_ratings")" = \
  "$(q "${RUN}_src" -c "SELECT string_agg(user_id || scope || GREATEST(100, rating - 500) || '/' || GREATEST(100, peak - 500) || '/' || games, ',' ORDER BY user_id, scope) FROM competitive_ratings")" ] || fail "cotes converties"
[ "$(q "${RUN}_copy" -c "SELECT rating FROM competitive_ratings WHERE user_id = '00000000-0000-4000-8000-000000000104'")" = "100" ] || fail "600 → 100"
[ "$(q "${RUN}_copy" -c "SELECT rating FROM competitive_ratings WHERE user_id = '00000000-0000-4000-8000-000000000105'")" = "101" ] || fail "601 → 101"
[ "$(q "${RUN}_copy" -c "SELECT reason FROM rating_changes WHERE id = '00000000-0000-4000-8000-000000000203'")" = "PAIR_LIMIT" ] || fail "motif des duels non comptés"
[ "$(q "${RUN}_copy" -c "SELECT before || '>' || after || '=' || delta FROM rating_changes WHERE id = '00000000-0000-4000-8000-000000000201'")" = "110>100=-10" ] || fail "écart recalculé au plancher"
grep -Eq '^ *[0-9]+ *\| *0 *$' "$work/out1/comparaison.txt" || { cat "$work/out1/comparaison.txt"; fail "rang conservé pour tous"; }
ok "répétition : conversion exacte (plancher, 600 → 100, 601 → 101, record, historique, motif), même rang pour tous"
[ "$(q "${RUN}_src" -c "SELECT string_agg(user_id || scope || rating || '/' || peak, ',' ORDER BY user_id, scope) FROM competitive_ratings")" = "$before" ] || fail "base source modifiée"
[ "$(q "${RUN}_src" -c "SELECT to_regnamespace('rehearsal_before') IS NULL")" = "t" ] || fail "copie écrite dans la base source"
ok "base source intacte (la répétition n'a touché que la copie)"

# 4. Une conversion fausse est détectée
q postgres -c "CREATE DATABASE ${RUN}_bad"
(cd "$root/deploy" && REHEARSAL_OUT="$work/out2" REHEARSAL_PG_EXEC="$PG_EXEC" REHEARSAL_DB="${RUN}_bad" REHEARSAL_PGUSER="$USER_" \
  MIGRATE_CMD="sh -c 'sh $work/apply.sh ${RUN}_bad 20261031000000 99999999999999 $migrations && $PG_EXEC psql -X -q -U $USER_ -d ${RUN}_bad -c \"UPDATE competitive_ratings SET rating = rating + 1 WHERE rating = 100\"'" \
  sh elo-rehearsal.sh "$work/src.dump") > "$work/r2.log" 2>&1 && { cat "$work/r2.log"; fail "écart non détecté"; }
grep -q "Répétition en ÉCHEC" "$work/r2.log" || { cat "$work/r2.log"; fail "message d'échec"; }
ok "conversion fausse détectée (code de sortie non nul, « NE PAS déployer »)"

# 5. Le script de comparaison refuse une base qui n'est pas une copie de répétition
pg psql -X -v ON_ERROR_STOP=1 -U "$USER_" -d "${RUN}_src" -f - < "$root/deploy/sql/elo-compare.sql" > "$work/cmp.txt" 2>&1 || true
grep -q "ne tourne que sur la copie" "$work/cmp.txt" || fail "comparaison hors copie"
ok "comparaison refusée hors copie de répétition"
echo "# $pass tests réussis"
