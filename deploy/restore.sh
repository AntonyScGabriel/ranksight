#!/bin/sh
# Restauration d'une sauvegarde dans une NOUVELLE base, sans jamais modifier, vider ni supprimer la base en service.
#
#   cd deploy
#   sh restore.sh backups/rankguess-AAAA-MM-JJ_HHMM.dump   # restaure dans rankguess_restore_<date> puis vérifie
#   sh restore.sh verify rankguess_restore_<date>          # relance les vérifications
#   sh restore.sh switch rankguess_restore_<date>          # bascule l'API sur cette base (confirmation demandée) ;
#                                                          # l'ancienne base est gardée sous rankguess_avant_<date>
#
# La base restaurée n'est utilisée par rien tant qu'on ne bascule pas : on peut l'inspecter, la comparer, ou la
# supprimer à la main si elle ne sert pas (ce script ne supprime jamais de base). Limites du retour arrière :
# deploy/README.md, « Restauration ».
#
# Variables (tests et CI) : PG_EXEC (commande qui exécute les outils PostgreSQL ; par défaut dans le conteneur
# postgres de docker compose, vide = outils locaux), RESTORE_PGUSER, RESTORE_LIVE_DB, RESTORE_TARGET (nom imposé),
# RESTORE_STOP / RESTORE_START (arrêt et redémarrage de ce qui utilise la base), RESTORE_YES=1 (pas de question).
set -eu
cd "$(dirname "$0")"

COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
PG_EXEC=${PG_EXEC-"$COMPOSE exec -T postgres"}
DBUSER=${RESTORE_PGUSER:-rankguess}
LIVE=${RESTORE_LIVE_DB:-rankguess}
STOP=${RESTORE_STOP-"$COMPOSE stop api backup"}
START=${RESTORE_START-"$COMPOSE start api backup"}
OBJECTS=../apps/api/prisma/sql-only-objects.txt
CATALOG=../apps/api/prisma/sql-only-objects.sql
MIGRATIONS=../apps/api/prisma/migrations
STAMP=$(date -u +%Y%m%d_%H%M%S)

die() { echo "ERREUR : $*" >&2; exit 1; }
# Découpage en mots voulu : PG_EXEC est une commande avec ses arguments
pg() { $PG_EXEC "$@"; }
# Nom de variable propre à la fonction : sh n'a pas de variables locales (« db » serait écrasée chez l'appelant)
sql_in() { _sql_db=$1; shift; pg psql -X -q -v ON_ERROR_STOP=1 -U "$DBUSER" -d "$_sql_db" -At "$@"; }
# Requête sans entrée : « docker exec -i » (PG_EXEC) lirait sinon l'entrée du script, dont la réponse à confirm()
sql() { sql_in "$@" < /dev/null; }
valid_name() { printf '%s' "$1" | grep -Eq '^[a-z][a-z0-9_]{0,62}$'; }
db_exists() { [ "$(sql postgres -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]; }
confirm() {
  [ "${RESTORE_YES:-}" = "1" ] && return 0
  printf "%s Taper « %s » pour continuer : " "$1" "$2"
  read -r answer || answer=""
  [ "$answer" = "$2" ] || { echo "Annulé."; exit 1; }
}

# Vérifications d'une base restaurée (lecture seule). Code 0 si tout est cohérent.
verify() {
  db=$1
  db_exists "$db" || die "la base $db n'existe pas"
  status=0
  echo "== Vérification de $db"
  # 1. Historique des migrations : présent, sans migration échouée ou annulée
  if [ "$(sql "$db" -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" != "t" ]; then
    echo "  ✗ table _prisma_migrations absente (sauvegarde d'une autre base ?)"; return 1
  fi
  failed=$(sql "$db" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL")
  [ "$failed" = "0" ] && echo "  ✓ aucune migration échouée" || { echo "  ✗ $failed migration(s) échouée(s) ou annulée(s)"; status=1; }
  applied=$(sql "$db" -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1")
  pending=""
  if [ -d "$MIGRATIONS" ]; then
    for m in $(ls "$MIGRATIONS" | grep -E '^[0-9]{14}_' | sort); do
      printf '%s\n' "$applied" | grep -qx "$m" || pending="$pending $m"
    done
  fi
  echo "  ✓ $(printf '%s\n' "$applied" | grep -c .) migration(s) appliquée(s), dernière : $(printf '%s\n' "$applied" | tail -1)"
  if [ -n "$pending" ]; then
    echo "  ! migrations du dépôt pas encore appliquées (elles le seront au démarrage de l'API) :$pending"
  fi
  # 2. Objets SQL hors schema.prisma (index partiel, CHECK, déclencheur, schéma archive) : complets si la base est à jour
  if [ -f "$OBJECTS" ] && [ -f "$CATALOG" ]; then
    actual=$(sql_in "$db" -f - < "$CATALOG")
    missing=$(grep -v '^#' "$OBJECTS" | sed '/^$/d' | while read -r o; do printf '%s\n' "$actual" | grep -qx "$o" || echo "$o"; done)
    if [ -z "$missing" ]; then
      echo "  ✓ index, contraintes et déclencheurs hors schéma Prisma : tous présents"
    elif [ -n "$pending" ]; then
      echo "  ! objets absents, attendus des migrations en attente :" $missing
    else
      echo "  ✗ objets absents alors que toutes les migrations sont appliquées :" $missing; status=1
    fi
  fi
  # 3. Contenu : nombre de lignes des tables principales, comparé à la base en service (lecture seule)
  echo "  Lignes (base restaurée / base en service $LIVE) :"
  for t in users clips guesses rooms room_players versus_matches competitive_ratings rating_changes subscriptions purchases audit_logs; do
    r=$(sql "$db" -c "SELECT CASE WHEN to_regclass('public.$t') IS NULL THEN '-' ELSE (SELECT count(*)::text FROM public.$t) END")
    l=$(sql "$LIVE" -c "SELECT CASE WHEN to_regclass('public.$t') IS NULL THEN '-' ELSE (SELECT count(*)::text FROM public.$t) END" 2>/dev/null || echo "?")
    printf '    %-22s %10s / %s\n' "$t" "$r" "$l"
  done
  [ "$(sql "$db" -c "SELECT to_regnamespace('archive') IS NOT NULL")" = "t" ] && echo "  ✓ schéma archive présent (jetons archivés)"
  return $status
}

restore() {
  dump=$1
  [ -f "$dump" ] || die "fichier introuvable : $dump"
  target=${RESTORE_TARGET:-${LIVE}_restore_$STAMP}
  valid_name "$target" || die "nom de base invalide : $target"
  [ "$target" != "$LIVE" ] || die "la base cible ne peut pas être la base en service ($LIVE)"
  db_exists "$target" && die "la base $target existe déjà : choisir un autre nom (RESTORE_TARGET), rien n'a été modifié"
  # Fichier intact (empreinte écrite par backup.sh), archive lisible, avant de créer quoi que ce soit
  if [ -f "$dump.sha256" ]; then
    expected=$(cut -d' ' -f1 < "$dump.sha256")
    actual=$(sha256sum < "$dump" | cut -d' ' -f1)
    [ "$expected" = "$actual" ] || die "empreinte différente : $dump est abîmé ou incomplet, rien n'a été modifié"
    echo "Empreinte SHA-256 vérifiée."
  else
    echo "! pas d'empreinte $dump.sha256 (sauvegarde antérieure à son ajout) : intégrité du fichier non vérifiée"
  fi
  entries=$(pg pg_restore --list < "$dump" | grep -c "TABLE DATA" || true)
  [ "${entries:-0}" -gt 0 ] || die "sauvegarde illisible ou vide : $dump"
  echo "Sauvegarde $dump : $entries tables avec données."
  echo "Restauration dans la nouvelle base $target (la base $LIVE n'est pas modifiée)…"
  sql postgres -c "CREATE DATABASE \"$target\""
  # Une seule transaction : en cas d'erreur, la nouvelle base reste vide (aucune restauration partielle)
  if ! pg pg_restore -U "$DBUSER" -d "$target" --no-owner --no-privileges --exit-on-error --single-transaction < "$dump"; then
    die "restauration échouée : $target est vide (à supprimer à la main), la base $LIVE est intacte"
  fi
  if verify "$target"; then
    echo "Restauration vérifiée : $target. Pour y basculer l'API : sh restore.sh switch $target"
  else
    die "restauration terminée mais vérification en échec : ne pas basculer sur $target"
  fi
}

# Bascule : l'API (et la sauvegarde) sont arrêtées, la base en service est renommée (gardée), la base restaurée prend
# son nom, puis tout redémarre. L'API applique alors les migrations en attente.
switch() {
  db=$1
  valid_name "$db" || die "nom de base invalide : $db"
  [ "$db" != "$LIVE" ] || die "$db est déjà la base en service"
  verify "$db" || die "vérification en échec : bascule refusée"
  old=${LIVE}_avant_$STAMP
  db_exists "$old" && die "$old existe déjà"
  echo "La base en service $LIVE sera renommée $old (conservée) et $db deviendra $LIVE."
  echo "Les données écrites dans $LIVE depuis la sauvegarde ne seront plus visibles (elles restent dans $old)."
  confirm "Bascule de l'API sur $db." "BASCULER"
  [ -z "$STOP" ] || $STOP
  # Connexions restantes (psql ouvert, etc.) : le renommage échoue proprement plutôt que de les couper
  if ! sql postgres -c "ALTER DATABASE \"$LIVE\" RENAME TO \"$old\""; then
    [ -z "$START" ] || $START
    die "renommage de $LIVE impossible (connexions ouvertes ?) : rien n'a changé, services redémarrés"
  fi
  if ! sql postgres -c "ALTER DATABASE \"$db\" RENAME TO \"$LIVE\""; then
    sql postgres -c "ALTER DATABASE \"$old\" RENAME TO \"$LIVE\""
    [ -z "$START" ] || $START
    die "renommage de $db impossible : base d'origine remise en place, services redémarrés"
  fi
  [ -z "$START" ] || $START
  echo "Bascule terminée : $LIVE contient la sauvegarde, l'ancienne base est $old."
  echo "Retour arrière : sh restore.sh rollback $old"
}

# Retour à la base d'avant la bascule (la base restaurée est gardée sous un autre nom)
rollback() {
  old=$1
  valid_name "$old" || die "nom de base invalide : $old"
  db_exists "$old" || die "la base $old n'existe pas"
  aside=${LIVE}_restore_retire_$STAMP
  confirm "Remettre $old en service ($LIVE sera renommée $aside)." "REVENIR"
  [ -z "$STOP" ] || $STOP
  sql postgres -c "ALTER DATABASE \"$LIVE\" RENAME TO \"$aside\"" || { [ -z "$START" ] || $START; die "renommage impossible"; }
  sql postgres -c "ALTER DATABASE \"$old\" RENAME TO \"$LIVE\"" || { sql postgres -c "ALTER DATABASE \"$aside\" RENAME TO \"$LIVE\""; [ -z "$START" ] || $START; die "renommage impossible, rien n'a changé"; }
  [ -z "$START" ] || $START
  echo "Retour arrière terminé : $LIVE est de nouveau l'ancienne base ; la base restaurée est $aside."
}

case "${1:-}" in
  verify) [ -n "${2:-}" ] || die "usage : sh restore.sh verify <base>"; verify "$2" ;;
  switch) [ -n "${2:-}" ] || die "usage : sh restore.sh switch <base>"; switch "$2" ;;
  rollback) [ -n "${2:-}" ] || die "usage : sh restore.sh rollback <base>"; rollback "$2" ;;
  "" | -h | --help) sed -n '2,16p' "$0" ;;
  *) restore "$1" ;;
esac
