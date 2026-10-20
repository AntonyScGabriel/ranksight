# Mise en production — procédures du serveur

Ce dossier contient tout ce qui tourne sur le serveur (VPS, Docker) : `docker-compose.prod.yml`, `Caddyfile`,
`backup.sh` (sauvegarde quotidienne), `restore.sh` (restauration), `elo-rehearsal.sh` (répétition de la conversion
des cotes), `sql/` (requêtes en lecture seule) et `tests/` (tests de ces scripts, lancés par la CI sur des bases
jetables). Toutes les commandes se lancent depuis `deploy/` sur le serveur, sauf mention contraire.

Règles : aucune commande de ce document ne supprime de base, de volume ou d'image. Les requêtes d'audit sont en
lecture seule (transaction `READ ONLY`, refusée par PostgreSQL à la moindre écriture). La répétition et la
restauration travaillent sur des copies ; seule la bascule (`restore.sh switch`) change la base utilisée par l'API,
après confirmation tapée, en gardant l'ancienne base.

Sommaire : [Déploiement groupé des PR #30 et #32](#déploiement-groupé-des-pr-30-et-32) ·
[Application Android 0.2.0](#application-android-020) · [Cotes Elo](#cotes-elo--audit-et-répétition) ·
[Restauration](#restauration) · [Protection de main](#protection-de-la-branche-main)

---

## Déploiement groupé des PR #30 et #32

Les deux PR sont fusionnées dans `main` (#30 en `f1d8825`, #32 en `298e891`). La #32 dépend de la #30 (même branche,
migrations successives) : on déploie **directement le dernier commit validé de `main`**, jamais `f1d8825` seul, pour
que les joueurs ne voient pas l'état intermédiaire (salons publics de la #30 avec revanche et salons VIP, remplacés
par la #32). L'API applique les migrations en attente à son démarrage (`prisma migrate deploy`).

| Migration | Contenu | Réversible ? |
| --- | --- | --- |
| `20261031000000_ranked_seasons_public_rooms` (#30) | jetons archivés dans le schéma `archive`, cotes − 500 avec plancher 100, saisons compétitives, visibilité des salons, revanche | non (nouvelle échelle) : retour = restauration de la sauvegarde |
| `20261101000000_room_system_slots` (#32) | salons par défaut (`system_slot`, index unique partiel), créateur et hôte facultatifs, revanche retirée | non (colonne supprimée) : retour = restauration |

### 0. Savoir ce qui tourne déjà (lecture seule)

**Vérification fiable : la base de production elle-même**, interrogée depuis le PC par SSH, en lecture seule
(transaction `READ ONLY` et `default_transaction_read_only=on` : PostgreSQL refuse toute écriture). La requête
est envoyée telle quelle, elle n'a pas besoin que le dépôt du serveur soit à jour ; rien n'est installé ni modifié
sur le serveur, `.env.production` n'est pas affiché. PowerShell (OpenSSH est inclus dans Windows 10 et 11) :

```powershell
$Vps = "utilisateur@adresse-du-vps"   # à remplacer : le compte SSH habituel du serveur
$Dir = "~/ranksight"                  # à remplacer si besoin : dossier du dépôt sur le serveur
$sql = @'
-- Etat des migrations des PR #30 et #32 dans une base : STRICTEMENT EN LECTURE SEULE.
-- Transaction READ ONLY (et, lance par deploy/README.md, PGOPTIONS default_transaction_read_only=on) : toute
-- ecriture est refusee par PostgreSQL. Une ligne par controle, au format cle|valeur. Texte ASCII (envoi par ssh).
\set QUIET on
BEGIN TRANSACTION READ ONLY;
\set QUIET off
SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_history \gset
SELECT 'lecture_seule', current_setting('transaction_read_only');
\if :has_history
SELECT 'migration_pr30', coalesce((
  SELECT CASE WHEN rolled_back_at IS NOT NULL THEN 'annulee' WHEN finished_at IS NULL THEN 'echouee' ELSE 'appliquee' END
    FROM _prisma_migrations WHERE migration_name = '20261031000000_ranked_seasons_public_rooms'
   ORDER BY started_at DESC LIMIT 1), 'absente');
SELECT 'empreinte_pr30', coalesce((SELECT checksum FROM _prisma_migrations
   WHERE migration_name = '20261031000000_ranked_seasons_public_rooms' ORDER BY started_at DESC LIMIT 1), '-');
SELECT 'migration_pr32', coalesce((
  SELECT CASE WHEN rolled_back_at IS NOT NULL THEN 'annulee' WHEN finished_at IS NULL THEN 'echouee' ELSE 'appliquee' END
    FROM _prisma_migrations WHERE migration_name = '20261101000000_room_system_slots'
   ORDER BY started_at DESC LIMIT 1), 'absente');
SELECT 'empreinte_pr32', coalesce((SELECT checksum FROM _prisma_migrations
   WHERE migration_name = '20261101000000_room_system_slots' ORDER BY started_at DESC LIMIT 1), '-');
SELECT 'migrations_en_echec', count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT 'derniere_migration', max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
\else
SELECT 'migration_pr30', 'pas_d_historique_prisma';
\endif
-- Traces dans le schema, independantes de l'historique
SELECT 'schema_archive', CASE WHEN to_regnamespace('archive') IS NULL THEN 'absent' ELSE 'present' END;
SELECT 'colonne_career_games', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'competitive_ratings' AND column_name = 'career_games') THEN 'presente' ELSE 'absente' END;
SELECT 'colonne_rooms_visibility', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'visibility') THEN 'presente' ELSE 'absente' END;
SELECT 'colonne_rooms_system_slot', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'system_slot') THEN 'presente' ELSE 'absente' END;
\set QUIET on
ROLLBACK;
'@
($sql -replace "`r", "") | ssh $Vps "cd $Dir/deploy && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres psql -X -q -v ON_ERROR_STOP=1 -U rankguess -d rankguess -At -F '|' -f -"
```

La même requête est dans `deploy/sql/deployment-state.sql` (testée sur des bases PostgreSQL 17 dans les trois états
ci-dessous, écriture refusée vérifiée). Lecture du résultat :

| Ligne | Valeur | Signification |
| --- | --- | --- |
| `lecture_seule` | `on` | la session était bien en lecture seule (sinon, ne pas tenir compte du reste et le signaler) |
| `migration_pr30` | `appliquee` | **PR #30 présente en production** (conversion des cotes faite) |
| | `absente` | PR #30 pas appliquée à la base |
| | `echouee` / `annulee` | migration commencée et en échec : l'API ne démarre probablement pas ; ne rien déployer, lire les journaux de l'API |
| `empreinte_pr30` | `b45d322ed365327ada36cd468c97bf61c64f0b224af8cf1f2b4da271aa7e206a` | même fichier de migration que le dépôt ; toute autre valeur : migration modifiée après coup, à examiner avant de déployer |
| `migration_pr32` / `empreinte_pr32` | `appliquee` / `c6ab278fdde5aef32ab17fe6772a9b0c3ca784f967b9a557dc7be290833bcba4` | PR #32 présente |
| `migrations_en_echec` | `0` | aucune migration bloquée |
| `schema_archive`, `colonne_career_games`, `colonne_rooms_visibility` | `present(e)` | traces de la PR #30 dans le schéma |
| `colonne_rooms_system_slot` | `presente` | trace de la PR #32 |

Conclusion sans ambiguïté : **PR #30 présente** si `migration_pr30 = appliquee` **et** les trois traces de la PR #30
sont présentes ; **absente** si `migration_pr30 = absente` **et** les trois traces sont absentes. Toute autre
combinaison (historique et schéma en désaccord, migration en échec, erreur de connexion) : ne pas conclure, ne rien
déployer, et m'envoyer le résultat.

Le code en service peut être plus ancien que le dépôt du serveur (images non reconstruites). Lecture seule aussi :

```powershell
ssh $Vps "cd $Dir && git log -1 --format='%h %ci %s' && cd deploy && docker compose --env-file .env.production -f docker-compose.prod.yml ps --format '{{.Service}} {{.Status}} {{.CreatedAt}}'"
```

**Indice complémentaire sans SSH** (codes HTTP, moins sûr : une erreur réseau ou un 429 ne veut rien dire) :

```powershell
$base = "https://api.rankguess.fr/v1"
$probes = [ordered]@{
  tokens  = @("GET",  "$base/tokens")
  seasons = @("GET",  "$base/ratings/seasons")
  rematch = @("POST", "$base/rooms/00000000-0000-4000-8000-000000000000/rematch")
}
foreach ($k in $probes.Keys) {
  $m, $u = $probes[$k]
  try { $r = Invoke-WebRequest -Uri $u -Method $m -UseBasicParsing -TimeoutSec 15; "$k -> $($r.StatusCode)" }
  catch { $c = $_.Exception.Response.StatusCode.value__; if ($c) { "$k -> $c" } else { "$k -> ERREUR : $($_.Exception.Message)" } }
}
```

| tokens | seasons | rematch | Code de l'API en service |
| --- | --- | --- | --- |
| 401 | 404 | 404 | avant la PR #30 (`df0c517`) |
| 404 | 401 | 401 | PR #30, sans la PR #32 |
| 404 | 401 | 404 | PR #30 et PR #32 |

Ces trois lignes ont été vérifiées en démarrant l'API de chaque version en local. Elles disent quel **code** répond,
pas ce que contient la **base** : seule la requête SSH ci-dessus fait foi pour la migration. `rooms/public` ne permet
pas de conclure (l'ancienne version le lit comme un identifiant de salon et répond aussi 401).

### 1. Préparer (aucun impact sur les joueurs)

1. **Application Android 0.2.0** construite et testée contre une API de test, envoyée en brouillon sur la piste de test
   interne (section suivante). Elle n'est pas encore diffusée.
2. **Sauvegarde fraîche** avec son empreinte :
   ```sh
   f=backups/rankguess-avant-deploiement-$(date -u +%Y-%m-%d_%H%M).dump
   docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres pg_dump -U rankguess -d rankguess -Fc > "$f"
   (cd backups && sha256sum "$(basename "$f")" > "$(basename "$f").sha256") && ls -la "$f"
   ```
3. **Audit des cotes** en lecture seule, gardé pour comparaison : `… psql … -f - < sql/elo-audit.sql > rehearsal/audit-avant.txt`
   (commande complète dans [Cotes Elo](#cotes-elo--audit-et-répétition)).
4. **Cas B seulement : répétition de la conversion** sur une copie isolée : `sh elo-rehearsal.sh "$f"`. Elle doit finir
   par « Répétition réussie ». Sinon, on arrête.
5. **Exercice de restauration** (ne touche pas la base en service) : `sh restore.sh "$f"` → « Restauration vérifiée ».
   La base `rankguess_restore_…` obtenue peut servir de point de retour.
6. **Images actuelles étiquetées** pour pouvoir revenir au code d'avant (aucune image supprimée) :
   ```sh
   for s in api web admin; do docker tag rankguess-$s:latest rankguess-$s:avant-$(date -u +%Y%m%d); done
   docker image ls | grep rankguess
   ```
   (vérifier le nom réel des images avec `docker compose … images` ; le projet compose s'appelle `rankguess`).
7. **Annonce** (administration → Annonce) : « Mise à jour ce soir de HH h à HH h 15 : nouveaux salons, mettez à jour
   l'application. »

### 2. Déployer (fenêtre courte)

```sh
cd ~/ranksight && git fetch origin && git checkout <commit validé de main> && cd deploy
docker compose --env-file .env.production -f docker-compose.prod.yml build api web admin     # le site tourne encore
docker compose --env-file .env.production -f docker-compose.prod.yml up -d                   # redémarre avec les migrations
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api            # « All migrations have been successfully applied »
```

Puis, tout de suite, **diffuser la version 0.2.0** aux testeurs internes (Play Console → Test interne → la version en
brouillon → Déployer) et leur demander de mettre à jour.

### 3. Vérifier (lecture seule)

- `curl -s https://api.rankguess.fr/health` → `"status":"ok"` ; requête SSH de l'étape 0 → `migration_pr30` et `migration_pr32` à `appliquee`, empreintes identiques, `migrations_en_echec` à 0 ; codes HTTP → `404 / 401 / 404`.
- Migrations : la requête `_prisma_migrations` ci-dessus montre `20261031` et `20261101` terminées.
- Salons par défaut (2 par mode, 8 en tout, créés dans les 5 s) :
  `… psql -U rankguess -d rankguess -Atc "SELECT system_slot, g.slug FROM rooms r JOIN games g ON g.id = r.game_id WHERE status = 'LOBBY' AND system_slot IS NOT NULL ORDER BY 1"`.
  Un mode absent signifie qu'aucun jeu n'a assez de clips acceptés pour lui (administration → « Clips acceptés par jeu »).
- Audit des cotes après conversion (`sql/elo-audit.sql`) : section 4 à zéro ; comparer à l'audit d'avant (même
  nombre de joueurs, rangs inchangés).
- Site : Salons (joueur gratuit : pas de création, salons gratuits visibles), Duels, Plus haut / Plus bas (VIP).

### 4. Revenir en arrière si besoin

- **Code seul** (bug d'affichage, pas de problème de données) : corriger et redéployer ; les migrations ne se
  rejouent pas.
- **Retour complet** (migration en échec, données incohérentes) : remettre les images étiquetées
  (`docker tag rankguess-api:avant-<date> rankguess-api:latest`, idem web et admin) **et** la base d'avant :
  `sh restore.sh switch rankguess_restore_<date>` (restaurée à l'étape 1.5). L'ancienne image ne connaît pas les
  nouvelles migrations : ne jamais relancer l'ancien code sur la base convertie. Les parties et achats faits entre le
  déploiement et le retour arrière ne sont pas dans la sauvegarde (ils restent dans la base mise de côté
  `rankguess_avant_<date>`, à récupérer à la main si nécessaire).
- Une migration en échec laisse une ligne `finished_at IS NULL` dans `_prisma_migrations` et l'API ne démarre pas :
  ne pas tenter `prisma migrate resolve` sans avoir compris l'erreur (logs de l'API).

### Risques connus du déploiement

- **Ancienne application (0.1.0)** : voir ci-dessous ; fenêtre entre le déploiement et la mise à jour des testeurs.
- **Salons en cours au moment du déploiement** : ils restent (créateur et hôte gardés), mais la revanche disparaît ;
  une salle d'attente jamais lancée peut être supprimée par le nettoyage habituel.
- **VIP** : créer un salon reste réservé aux VIP, désormais pour les salons publics comme privés ; rejoindre, jouer et
  devenir hôte restent gratuits. Plus haut / Plus bas passe en VIP seulement (plus de séries gratuites).
- **Cotes Elo** (cas B) : − 500 avec plancher 100. Les joueurs sous 600 arrivent tous à 100 (l'écart entre eux est
  perdu, le rang Bronze est conservé). Audit et répétition ci-dessous.
- **Jetons virtuels** (cas B) : retirés de l'application, données conservées dans le schéma `archive`.

---

## Application Android 0.2.0

La version 0.2.0 (`apps/mobile/app.json`) correspond à l'API des PR #30 et #32 et envoie l'en-tête
`X-App-Version: 0.2.0` à chaque requête. L'API ne refuse aucune version ; elle note la version avec l'appareil de la
session (`refresh_tokens.user_agent`, ex. `RankGuess/0.2.0 okhttp/4.12.0`), ce qui permet de compter les testeurs
encore en 0.1.0 :

```sh
… psql -U rankguess -d rankguess -Atc "SELECT coalesce(substring(user_agent from 'RankGuess/[0-9.]+'), 'sans version (0.1.0 ou site)'), count(DISTINCT user_id) FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > now() GROUP BY 1"
```

### Incompatibilités de l'ancienne application (0.1.0) avec la nouvelle API

Pas de couche de compatibilité : ces écarts sont acceptés pendant la fenêtre de mise à jour des testeurs internes.
Relevés dans le code de l'application 0.1.0 (`main` avant la PR #30, `df0c517`) — à confirmer que le build 0.1.0 de
la piste interne vient bien de ce code (Play Console → version → numéro de build, EAS → build → commit).

| Écran (0.1.0) | Cause | Effet pour le testeur |
| --- | --- | --- |
| Plus haut / Plus bas | `freeRunsLeft` / `freeRunsPerDay` retirés de la réponse | bouton de lancement désactivé **pour tous, VIP compris** ; textes « undefined » (« Séries du jour : undefined », « Tu as joué tes undefined séries… ») |
| Salons : création | `canHost` remplacé par `canCreate` ; champ `confidence` envoyé alors que l'API n'accepte plus de champ inconnu | formulaire de création masqué pour tous ; création impossible même pour un VIP (400) |
| Salon : partie en cours | `myStake`, `tokensNet` retirés | « Mise engagée : undefined jeton », gains de jetons « undefined » à côté des joueurs |
| Liste et invitation | `host` vaut `null` pour les salons gratuits par défaut | « Salon de null » |
| Salons gratuits par défaut | l'ancienne application ne connaît pas la liste des salons publics | les testeurs 0.1.0 ne les voient pas (ils restent joignables par code) |
| Salon par défaut, hôte | bouton « Retirer » toujours affiché | l'API refuse (403, message affiché) |

Tout le reste (défis, infini, duels, classement, profil, amis, chat, boutique) garde les mêmes adresses et champs.

### Tester la 0.2.0 avant de déployer l'API (sans Google Play)

L'application 0.2.0 a besoin de la nouvelle API : on la teste contre une **API de test** sur le PC, jamais contre la
production, avec un APK installé à la main (rien n'est envoyé sur Google Play). Commandes PowerShell, depuis la racine
du dépôt sur le PC, branche `preparation-production` récupérée.

1. **Base isolée et API de test** sur le PC. La base de test est une **copie de la base de développement** (elle a
   des clips, dont les vidéos sont dans `apps/api/storage` et servies par l'API avec des adresses relatives, donc
   aussi à travers le tunnel) ; jamais la production. Le nom finit par `_test` : le garde-fou des tests l'accepte.
   ```powershell
   docker compose up -d                                                    # PostgreSQL et Redis de développement
   docker compose exec -T postgres createdb -U ranksight ranksight_mobile_test   # une fois (erreur « already exists » ensuite)
   docker compose exec -T postgres sh -c "pg_dump -U ranksight -Fc ranksight | pg_restore -U ranksight -d ranksight_mobile_test --no-owner"
   cd apps/api
   $env:DATABASE_URL = "postgresql://ranksight:ranksight@localhost:5432/ranksight_mobile_test"
   npx prisma migrate deploy            # applique les migrations des PR #30 et #32 à la copie seulement
   npx tsx --env-file=../../.env prisma/seed.ts
   npm run build; node --env-file=../../.env dist/main.js                 # laisser ouvert
   ```
   Comptes de test (dans un autre terminal, base de test uniquement) : s'inscrire depuis l'application, puis confirmer
   l'adresse et donner le VIP à l'un des comptes :
   ```powershell
   docker compose exec -T postgres psql -U ranksight -d ranksight_mobile_test -c "UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL"
   docker compose exec -T postgres psql -U ranksight -d ranksight_mobile_test -c "INSERT INTO subscriptions (id, user_id, provider, external_id, plan, status, current_period_end, updated_at) SELECT gen_random_uuid(), id, 'MANUAL', 'test-vip:' || id, 'manual', 'ACTIVE', now() + interval '30 days', now() FROM users WHERE display_name = '<pseudo VIP>' ON CONFLICT (user_id) DO NOTHING"
   ```
2. **Adresse HTTPS temporaire** (Android refuse le HTTP en clair dans un APK de diffusion), dans un autre terminal :
   `winget install --id Cloudflare.cloudflared` (une fois), puis `cloudflared tunnel --url http://localhost:4000`
   → noter l'adresse `https://<nom>.trycloudflare.com`. Le tunnel s'arrête avec Ctrl+C.
3. **Variables EAS de l'environnement `preview`** (n'affectent pas les builds `production`) :
   ```powershell
   cd apps/mobile
   npx eas-cli env:set preview --name EXPO_PUBLIC_API_URL --value "https://<nom>.trycloudflare.com/v1" --visibility plaintext
   npx eas-cli env:set preview --name ANDROID_PACKAGE --value "com.rankguess.app.preview" --visibility plaintext
   npx eas-cli env:list preview                           # vérifier avant de construire
   ```
   `ANDROID_PACKAGE` différent : l'APK s'installe **à côté** de l'application de la piste interne (le même identifiant
   provoquerait un conflit de signature). Dans cette copie, les achats Google Play et la connexion Google ne
   fonctionnent pas (normal). À chaque nouveau tunnel, l'adresse change : refaire `env:set` puis le build.
4. **Build de test** : `npx eas-cli build --profile preview --platform android` → lien de téléchargement de l'APK
   (profil `preview` : `distribution: internal`, aucun envoi sur Google Play), à installer sur le téléphone.
5. **Parcours à vérifier à la main** : connexion par email ; Salons (joueur gratuit : salons par défaut listés, pas
   de création ; VIP : création, lien d'invitation) ; salle d'attente d'un salon par défaut sans bouton « Retirer » ;
   partie complète jusqu'au classement ; Plus haut / Plus bas (VIP) ; application en arrière-plan plus de 30 s puis
   retour → « Tu n'es plus l'hôte » ; mode avion moins de 30 s → aucun message, toujours hôte ; textes sans
   « undefined ». Version envoyée : `docker compose exec -T postgres psql -U ranksight -d ranksight_mobile_test -c
   "SELECT user_agent FROM refresh_tokens ORDER BY created_at DESC LIMIT 3"` doit montrer `RankGuess/0.2.0`. Pour
   avoir deux joueurs dans un salon, un second compte peut jouer depuis le site de test (`npm run dev -w @ranksight/web`).
6. **Plus tard, sur décision explicite** (pas pendant le test) : build de diffusion `npm run build:android -w
   @ranksight/mobile` (environnement `production`, vraie API), puis `npm run submit:android -w @ranksight/mobile`,
   qui l'envoie en **brouillon** sur la piste de test interne (`eas.json`) ; rien n'est diffusé avant le clic sur
   « Déployer » dans la Play Console, juste après le déploiement de l'API.

---

## Cotes Elo : audit et répétition

### Audit en lecture seule (production)

```sh
mkdir -p rehearsal
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U rankguess -d rankguess -f - < sql/elo-audit.sql > rehearsal/audit-$(date -u +%Y%m%d_%H%M).txt
```

`sql/elo-audit.sql` ouvre une transaction `READ ONLY` (PostgreSQL refuse toute écriture) et l'annule à la fin. Il
détecte l'état (avant ou après la conversion) et donne : migrations appliquées ; joueurs, cotes min/moy/max et
valeurs nulles par classement ; **joueurs sous 600** (cote ou record) avec la cote qu'ils auront et les points perdus
au plancher ; anomalies (record sous la cote, cote sous 100, compteurs incohérents, cotes orphelines, historique
incohérent) ; lignes d'historique dont l'écart sera recalculé ; répartition par rang. Les rapports contiennent des
pseudos : le dossier `rehearsal/` reste sur le serveur (ignoré par git).

Effets de la conversion (migration `20261031`) : `cote = max(100, cote − 500)`, `record` idem, duels de carrière =
duels joués ; historique : `avant` et `après` convertis de la même façon, écart recalculé, motif `PAIR_LIMIT` pour les
duels non comptés. Les valeurs nulles sont impossibles (colonnes `NOT NULL`, vérifié par l'audit). Les seuils de rang
ont été décalés de 500 : chacun garde son rang ; seuls les joueurs sous 600 perdent l'écart qui les séparait
(tous à 100, toujours Bronze).

### Répétition sur une copie isolée

```sh
sh elo-rehearsal.sh backups/rankguess-….dump
```

Le script lance un PostgreSQL 17 **jetable** (conteneur sans réseau, données en mémoire, supprimé à la fin), y
restaure la sauvegarde, copie les cotes, construit l'image de l'API depuis le dépôt sous une étiquette à part
(`rankguess-api:rehearsal` ; l'image en service n'est pas touchée), applique les migrations sur la copie, puis compare :
chaque cote, record, compteur et ligne d'historique doit correspondre exactement à la règle ci-dessus, sinon le
script s'arrête sur « Répétition en ÉCHEC… NE PAS déployer ». Rapports : `rehearsal/<date>/`. Sur une sauvegarde déjà
convertie (cas A), il le signale et s'arrête. Sans Docker sur le serveur, la même commande fonctionne sur un PC avec
Docker, en y copiant la sauvegarde.

Testé par la CI (`deploy/tests/elo-rehearsal-test.sh`) sur une base construite avec les migrations jusqu'à
`20261030` et des cotes d'exemple (100, 450, 599, 600, 601, 1000, 1210, 1700, records et historique), y compris la
détection d'une conversion fausse. Le mode Docker du script (conteneur jetable, image de l'API) n'est pas couvert par
la CI : le lancer une première fois sur le serveur avant le jour du déploiement.

---

## Restauration

```sh
sh restore.sh backups/rankguess-AAAA-MM-JJ_HHMM.dump     # → nouvelle base rankguess_restore_<date>, vérifiée
sh restore.sh verify rankguess_restore_<date>            # relancer les vérifications
sh restore.sh switch rankguess_restore_<date>            # bascule (confirmation « BASCULER »)
sh restore.sh rollback rankguess_avant_<date>            # retour à la base d'avant la bascule (« REVENIR »)
```

- **Restauration** : empreinte SHA-256 contrôlée (écrite par `backup.sh` à côté de chaque sauvegarde), archive lue,
  puis restauration dans une **nouvelle** base, en une seule transaction (une erreur laisse la nouvelle base vide,
  jamais à moitié remplie). La base en service n'est ni arrêtée, ni modifiée. Une base de même nom n'est jamais
  écrasée.
- **Vérification** : historique des migrations sans échec ; migrations du dépôt pas encore appliquées (elles le
  seront au démarrage de l'API) ; objets SQL hors Prisma (index partiel des salons par défaut, contraintes `CHECK`,
  exclusion des saisons, journal d'audit en ajout seul, schéma `archive`) présents ; nombre de lignes des tables
  principales, à côté de celui de la base en service.
- **Bascule** : arrêt de l'API et de la sauvegarde, `rankguess` renommée `rankguess_avant_<date>` (gardée), la base
  restaurée prend le nom `rankguess`, redémarrage. Le renommage échoue proprement si une connexion reste ouverte
  (rien ne change, services redémarrés). `docker-compose.prod.yml` n'est pas modifié.

### Limites du retour arrière

- Une sauvegarde est une photo : tout ce qui a été écrit après (parties, achats, inscriptions) n'y est pas. Après une
  bascule, ces données restent dans `rankguess_avant_<date>`, sans fusion automatique.
- Les migrations vont dans un seul sens. Restaurer une sauvegarde **antérieure** à une migration puis démarrer la
  nouvelle API **rejoue** la migration (ex. la conversion des cotes) : c'est voulu pour un retour de données avec le
  même code, pas pour revenir à l'ancien code. Pour revenir à l'ancien code, il faut l'ancienne image **et** une
  sauvegarde faite avant la migration.
- Les fichiers (vidéos, photos) sont sur R2 et dans le volume `storage` : non concernés par la restauration de la base.
- Les sauvegardes antérieures à l'ajout des empreintes n'ont pas de fichier `.sha256` : le script le signale et
  s'appuie seulement sur la lecture de l'archive et les vérifications.
- `backup.sh` modifié (empreinte) : effectif après redémarrage du service `backup`, au prochain déploiement.

Testé par la CI (`deploy/tests/restore-test.sh`, outils du conteneur PostgreSQL 17) et en local : contenu identique
(lignes de chaque table, joueurs, clips), base source intacte, refus d'écraser, sauvegarde modifiée ou tronquée
refusée sans créer de base, bascule et retour arrière, `prisma migrate deploy` sans migration en attente, API
redémarrée sur la base restaurée (`/health`, lecture des jeux).

---

## Protection de la branche `main`

État au 17/10/2026 : `main` n'est pas protégée (aucune règle ni ensemble de règles). Configuration prête dans
`.github/branch-protection-main.json`, **non appliquée** :

- fusion uniquement par PR (aucune approbation exigée : un seul mainteneur ne peut pas approuver sa propre PR) ;
- contrôles obligatoires et à jour avec `main` : `checks` (lint, typecheck, tests unitaires, migrations, builds,
  tests d'intégration, restauration, répétition Elo, audit des dépendances) et `e2e-web` (tests d'interface) ;
- discussions résolues avant fusion ; ni force push, ni suppression de `main` ;
- **règles appliquées aussi aux administrateurs** (`enforce_admins`) : personne ne peut fusionner sans CI verte.

À appliquer seulement après une première exécution verte de `e2e-web` (un contrôle obligatoire qui n'a jamais
tourné bloque toutes les fusions) :

```sh
gh api -X PUT repos/AntonyScGabriel/ranksight/branches/main/protection --input .github/branch-protection-main.json
gh api repos/AntonyScGabriel/ranksight/branches/main/protection --jq '{checks: .required_status_checks.contexts, admins: .enforce_admins.enabled}'
```

Conséquences : les PR de Dependabot doivent aussi passer la CI ; en cas d'urgence, il faut désactiver la règle
(`gh api -X DELETE repos/AntonyScGabriel/ranksight/branches/main/protection`), corriger, puis la remettre.
