#!/bin/sh
# Restauration d'une sauvegarde (remplace le contenu actuel de la base) :
#   cd deploy && sh restore.sh backups/rankguess-AAAA-MM-JJ_HHMM.dump
set -eu
[ -f "${1:-}" ] || { echo "Usage : sh restore.sh backups/rankguess-....dump"; exit 1; }
printf "La base actuelle va être remplacée par %s. Continuer ? (oui/non) " "$1"
read -r answer
[ "$answer" = "oui" ] || { echo "Annulé."; exit 1; }
docker compose --env-file .env.production -f docker-compose.prod.yml stop api
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U rankguess -d rankguess --clean --if-exists --no-owner < "$1"
docker compose --env-file .env.production -f docker-compose.prod.yml start api
echo "Restauration terminée."
