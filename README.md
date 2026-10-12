# RankGuess

Regarde un clip de gameplay de 5 secondes à 1 minute, devine le rang du joueur, grimpe dans les classements.
Jeux : League of Legends, Valorant, Rocket League et Counter-Strike 2.
Site web, application mobile, API et administration, en TypeScript de bout en bout.

| Dossier | Rôle | Technologies | Adresse locale |
|---|---|---|---|
| `apps/api` | API | NestJS 12 · Prisma 7 · PostgreSQL · Redis · Socket.IO | http://localhost:4000 |
| `apps/web` | Site joueur | Next.js 16 · React 19 · Tailwind CSS 4 | http://localhost:3000 |
| `apps/admin` | Administration | Next.js 16 · Tailwind CSS 4 | http://localhost:3001 |
| `apps/mobile` | Application iOS et Android | Expo SDK 57 · React Native 0.86 | Expo Go |
| `packages/shared` | Types, validation, barème | Zod | — |

## Démarrage

Prérequis : **Node.js 22 ou plus** et **Docker Desktop** lancé. Facultatif : **ffmpeg** pour compresser les vidéos
en local (`winget install ffmpeg` sous Windows, `brew install ffmpeg` sur Mac) ; sans lui, les vidéos sont gardées telles quelles.

```bash
npm install
npm run dev
```

`npm run dev` crée `.env` s'il n'existe pas (ou le complète avec les nouvelles variables), démarre PostgreSQL et Redis
dans Docker, applique les migrations, charge les jeux et les rangs, puis lance l'API, le site et l'administration.

Application mobile (dans un second terminal, téléphone sur le même Wi-Fi que l'ordinateur) :

```bash
npm run mobile
```

Scanne le QR code avec **Expo Go** (Android) ou l'appareil photo (iPhone). L'adresse de l'API est détectée automatiquement.
Dans Expo Go, tout fonctionne sauf les notifications push : depuis le SDK 53, Expo Go ne les prend plus en charge.
Elles fonctionnent dans une version installable de l'application (`npm run build:preview -w @ranksight/mobile`, compte Expo requis).

`npm run mobile` vérifie d'abord les dépendances natives (une seule version de Reanimated et de Worklets, celle d'Expo Go)
et vide le cache de Metro quand elles ont changé. Après avoir copié une nouvelle version du projet par-dessus l'ancienne,
si le lancement signale une installation incohérente (ou l'erreur « Mismatch between JavaScript code version and Worklets
Babel plugin version ») : `npm run reinstall` (supprime tous les dossiers `node_modules` puis réinstalle), puis
`npm run mobile`.

### Accès administrateur

1. Crée ton compte sur le site (http://localhost:3000/signup).
2. `npm run admin:promote -- ton_pseudo`
3. Ouvre http://localhost:3001 et connecte-toi avec le même email et le même mot de passe.

`npm run admin:promote -- pseudo MODERATOR` donne le rôle de modérateur, `REVIEWER` celui de trieur de clips, `USER`
retire les droits. Les rôles se changent aussi depuis l'administration, page « Utilisateurs ».

**Fondateur** (propriétaire du site, un seul compte) : `npm run admin:promote -- ton_pseudo OWNER`. Ce grade ne se donne
que par cette commande, sur le serveur ; `--transfer` le transmet à un autre compte (l'ancien fondateur devient
administrateur). En production : `docker compose --env-file .env.production -f docker-compose.prod.yml exec api npx tsx
prisma/promote.ts ton_pseudo OWNER` (depuis `deploy/`).

Un compte créé avant l'arrivée des mots de passe (connexion par simple pseudo) se récupère avec
`npm run account:password -- ton_pseudo ton@email.fr` : le mot de passe est demandé dans le terminal.

### Connexion

Trois façons de se connecter, sur le site, l'application et l'administration :

- **Email et mot de passe** : inscription avec pseudo, email, mot de passe et confirmation. Pseudo et email uniques,
  mot de passe haché avec scrypt (jamais stocké en clair). « Mot de passe oublié » envoie un lien valable 1 heure.
- **Google** et **Discord** (OAuth, entièrement géré par l'API : aucun secret dans le site ni dans l'application).

Sans serveur SMTP (`SMTP_HOST` vide), le lien « mot de passe oublié » est écrit dans le terminal de l'API.
Pour l'envoyer réellement, renseigne les variables `SMTP_*` et `MAIL_FROM` dans `.env`.

### Paiement (boutique VIP)

1. Crée un compte sur dashboard.stripe.com et reste en **mode Test** (gratuit, aucun vrai paiement).
2. Développeurs → Clés API : copie la clé secrète `sk_test_…` dans `STRIPE_SECRET_KEY` du `.env`, puis relance `npm run dev`.
3. Achète un pass avec la carte de test `4242 4242 4242 4242` (date future, CVC au choix).

En local, l'achat est validé au retour sur la boutique. En production, ajoute aussi un webhook Stripe vers
`<API_PUBLIC_URL>/v1/shop/webhook` (événement `checkout.session.completed`) et sa clé dans `STRIPE_WEBHOOK_SECRET` :
l'achat est alors crédité même si le joueur ferme la page avant le retour.

Dans l'application Android, le VIP s'achète avec **Google Play Billing** (voir « Publier sur Google Play »). Le VIP est
lié au compte : acheté sur le site ou dans l'application, il vaut partout.

### Connexion Google et Discord

Renseigne les identifiants dans `.env` et déclare ces adresses de retour chez chaque fournisseur :

| Fournisseur | Où créer l'application | Adresse de retour |
|---|---|---|
| Google | console.cloud.google.com → Identifiants → ID client OAuth (application Web) | `http://localhost:4000/v1/auth/oauth/google/callback` |
| Discord | discord.com/developers/applications → OAuth2 | `http://localhost:4000/v1/auth/oauth/discord/callback` |

Aucune adresse n'est écrite dans le code : l'adresse de retour est toujours `<API_PUBLIC_URL>/v1/auth/oauth/<fournisseur>/callback`.
En production, déclare `https://api.ton-domaine.fr/v1/auth/oauth/google/callback` (et l'équivalent Discord) chez chaque
fournisseur, et mets `API_PUBLIC_URL`, `WEB_URL`, `ADMIN_URL` et `CORS_ORIGINS` à jour dans `.env`. Tant que les identifiants
d'un fournisseur ne sont pas renseignés, son bouton affiche « Ce mode de connexion n'est pas disponible pour le moment. ».

**Activer Google en production** (une seule fois, environ 10 minutes) :

1. console.cloud.google.com → crée un projet (ex. « RankGuess »).
2. « API et services » → « Écran de consentement OAuth » : type **Externe**, nom de l'application, adresse de contact,
   domaine autorisé `ton-domaine.fr`, liens vers les pages légales du site (`/legal/confidentialite`, `/legal/cgu`).
   Portées : `openid`, `email`, `profile` (aucune vérification Google n'est demandée pour celles-ci). Puis **Publier
   l'application** (sinon seuls les comptes « testeurs » peuvent se connecter).
3. « Identifiants » → « Créer des identifiants » → « ID client OAuth » → type **Application Web** → URI de redirection
   autorisée : `https://api.ton-domaine.fr/v1/auth/oauth/google/callback`.
4. Copie l'ID client et le code secret dans `deploy/.env.production` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), puis
   redémarre l'API : `docker compose --env-file .env.production -f docker-compose.prod.yml up -d api`. Le bouton
   « Continuer avec Google » fonctionne alors sur le site et dans l'application (rien à reconstruire).

Sur téléphone, l'API est jointe par l'adresse IP de l'ordinateur. Discord accepte cette adresse comme retour, Google non :
pour tester Google sur téléphone, expose l'API avec une adresse publique (tunnel HTTPS) et mets-la dans `API_PUBLIC_URL`.

## Fonctionnement

- **Défis du jour** : chaque jour, **3 clips par jeu** (12 défis pour les 4 jeux), les mêmes pour tout le monde. Le joueur
  choisit le jeu puis le défi (n° 1 à 3) ; chaque défi a son score et une seule tentative, et « Défi suivant » enchaîne
  sur le prochain défi non joué. Sans planification, des clips acceptés du jeu sont tirés au sort (jamais deux fois le
  même clip le même jour). Un jeu qui n'a pas assez de clips propose moins de défis ce jour-là. « Grand chelem » et
  « Sans faute » se mesurent sur tous les défis proposés dans la journée.
- **Infini** : clips à la suite, 3 vies, difficulté croissante. Un joueur ne tombe jamais sur ses propres clips.
- **Duels en direct** (onglet « Duels ») : 5 clips, les mêmes pour les deux joueurs, **au même moment**, contre un joueur
  au hasard ou un ami. Compte à rebours de 5 s, puis 30 s par manche pour répondre ; la manche se termine dès que les deux
  ont répondu (ou à la fin du chrono : pas de réponse = 0 point). Les deux réponses et le rang réel sont alors dévoilés,
  et la manche suivante démarre 6 s plus tard. Le meilleur total gagne (égalité possible) ; abandon = victoire de l'autre.
  « Trouver un adversaire » rejoint un joueur en attente ou ouvre une recherche ; une invitation d'ami s'affiche en direct
  chez lui (bandeau « Rejoindre » sur toutes les pages, notification push sur mobile). La recherche et l'invitation restent
  ouvertes tant que leur auteur reste sur la page. Un seul duel en cours à la fois. Le serveur pilote le chrono (horloge
  des joueurs recalée sur la sienne) et refuse toute réponse hors délai. Bilan victoires / égalités / défaites sur le
  profil ; succès « Duelliste ». Les duels rapportent de l'XP mais ne comptent pas dans les classements.
- **Images des rangs** : chaque rang s'affiche avec un emblème (choix du rang, résultat). Par défaut, emblème RankGuess aux
  couleurs du rang ; l'administration peut envoyer sa propre image par rang (page « Rangs » : PNG, JPEG ou WebP, 512 Ko
  maximum, stockée en base). Utiliser uniquement des images dont vous détenez les droits.
- **Profils publics** : un clic sur un joueur (classements, chat global, amis, duels) ouvre son profil : niveau,
  statistiques, bilan des duels et succès, avec les boutons « Ajouter en ami », « Accepter », « Défier en duel » et
  « Envoyer un message » selon votre relation.
- **Son des clips** : sur mobile le son est activé par défaut, avec un bouton pour le couper ou le rétablir. Sur le site,
  la vidéo démarre sans le son (règle des navigateurs pour la lecture automatique) : l'icône du lecteur l'active.
- **Clips proposés** : chaque joueur peut envoyer un clip (« Proposer un clip ») : jeu, vidéo, **pseudo en jeu** (obligatoire),
  rang réel, plateforme et région (facultatives). Le pseudo en jeu est distinct du pseudo RankGuess et n'est montré aux joueurs
  qu'après leur réponse. L'équipe accepte le clip, le refuse avec une raison, ou le supprime. Statut dans « Mes clips ».
  Durée : **de 5 secondes à 1 minute**, 150 Mo au maximum (mêmes limites pour les clips ajoutés par l'équipe). En duel,
  une manche dure au moins le temps du clip plus 10 secondes.
- **Classements** : Global et Amis, par jour, semaine, saison, depuis toujours et record Infini, mis à jour en direct ;
  tous jeux confondus ou par jeu.
- **Classement des contributeurs** (onglet « Contributeurs » des classements, site et application) : nombre de clips
  proposés par chaque joueur et acceptés par l'équipe, par saison (date d'acceptation) ou depuis le lancement. Les clips
  de l'équipe, refusés ou supprimés ne comptent pas ; à égalité, le premier à atteindre ce nombre passe devant. À la
  clôture de chaque saison, le premier reçoit le titre **« Contributeur saison N »**.
- **Saisons** : une saison = un mois civil (du 1er au dernier jour, minuit UTC). La saison 1 est le mois `SEASON_ONE`
  du `.env` (octobre 2026 par défaut), la saison 2 le mois suivant, etc. Chaque début de mois, la saison précédente est
  clôturée automatiquement : son classement est archivé (consultable dans l'onglet Saison) et les succès de saison sont
  attribués. Où les voir : onglet « Saison » des classements, encart en haut de « Défis du jour », et page « Saisons » de
  l'administration (statut, joueurs classés, top 10, bouton « Clôturer » si le serveur était arrêté en début de mois).
- **Succès** : page « Mes succès » (menu du compte, profil, application mobile) avec les succès obtenus et leur date,
  l'avancement des autres, leur rareté et le bonus d'XP. Séries de victoires (rangs exacts d'affilée, tous modes) :
  5, 10, 25, 50 et 100 ; séries de jours ; « Grand chelem » et « Sans faute » sur tous les défis du jour ; experts par jeu ;
  amis et clips acceptés ; duels gagnés (1, 10, 50) ; « Champion de la saison 1 », « Champion de saison », « Podium » et « Top 10 ».
- **Chat global** : salon public pour tous les joueurs connectés, en temps réel. Chacun peut supprimer ses messages,
  l'équipe peut supprimer n'importe quel message (page « Chat global » de l'administration). Anti-spam : 3 s minimum entre
  deux messages, 8 messages par minute au maximum, messages identiques, caractères répétés, liens multiples et texte
  tout en majuscules refusés.
- **Amis** : recherche par pseudo, demandes, acceptation, refus, suppression.
- **Suggestions** (onglet « Suggestions » du site, menu du compte, profil de l'application) : le joueur propose une idée
  (catégorie et texte, 5 par 24 heures au maximum), suit son statut (« En attente », « Retenue », « Réalisée »,
  « Non retenue ») et lit la réponse de l'équipe ; il peut retirer une suggestion pas encore traitée. L'équipe
  (modération et administration) les traite dans la page « Suggestions » de l'administration (web et application) :
  statut, réponse facultative, suppression des messages hors sujet. L'auteur reçoit une notification sur son téléphone.
- **Boutique VIP** (menu du compte, profil, application) : passes VIP 1 mois (4,99 €), 3 mois (12,99 €) et 12 mois (39,99 €),
  paiement unique par carte via Stripe Checkout, sans abonnement. Avantages : +50 % d'XP sur chaque réponse et badge VIP
  (classements, chat, profil). Un pass acheté pendant un VIP en cours s'ajoute à sa date de fin. Sans `STRIPE_SECRET_KEY`,
  la boutique s'affiche mais l'achat est indisponible. L'administration peut offrir ou retirer le VIP (page Utilisateurs).
- **Promo du moment** : réutilisable à chaque événement (lancement, Noël, anniversaire du site…). Nom affiché aux joueurs,
  prix promo par pass, fin automatique facultative (date et heure). Par défaut : « Offre de lancement » à moitié prix
  (2,49 €, 6,49 €, 19,99 €). Le site affiche le nom de la promo, le prix promo et le prix normal appliqué ensuite (pas de
  faux prix barré) ; les CGV suivent. Les réglages enregistrés avant (offre de lancement) sont repris automatiquement.
- **Boutique modifiable** (administration → « Boutique », site ou application, fondateur) : promo du moment et, pour
  chaque pass, nom, durée, prix normal, prix promo, étiquette (« −13 % »…) et mise en vente.
  Appliqué tout de suite au site et aux conditions générales de vente (prix lus en direct), journalisé pass par pass.
  Les identifiants des passes (`vip_1m`, `vip_3m`, `vip_12m`) restent fixes : ce sont ceux de Google Play, dont les prix se
  changent dans la Play Console au même moment.
- **VIP à offrir** (site uniquement) : bouton « Offrir » sous chaque pass → à un ami de sa liste (VIP activé dès le paiement,
  notification et email) ou sous forme de **code cadeau** `RG-XXXX-XXXX-XXXX` à transmettre (affiché après le paiement, envoyé
  par email, visible dans « Mes achats » avec un lien `/shop?code=…`). Les codes sont stockés hachés pour la recherche et
  chiffrés pour être réaffichés. Utilisation : boutique du site, « Tu as un code cadeau ? » (compte vérifié, une fois par
  joueur ; 10 codes faux par heure et par compte au maximum).
- **Codes de l'équipe** (administration → Boutique) : création par lots (jusqu'à 100), durée du VIP, nombre d'utilisations,
  date limite et note interne ; liste avec compteur et désactivation.
- **Clips de l'administration** : filtres « En attente », « Acceptés », « Refusés », et pour les défis du jour
  « Défi du jour » (les clips des défis d'aujourd'hui, avec le nombre de réponses), « Planifiés » (jours suivants) et « Disponibles »
  (acceptés, jamais passés en défi : ceux tirés au sort pour les prochains défis), filtre par jeu, et badges de passage
  en défi sur chaque clip. Un clip du défi du jour peut être supprimé même si des joueurs y ont déjà répondu : un autre
  clip le remplace aussitôt et ceux qui avaient répondu gardent leur résultat. Page « Défis du jour » : planifier un clip
  sur un défi précis (n° 1 à 3) ou sur la première place libre du jour ; un clip déjà planifié disparaît de la liste des
  clips à choisir. Retirer un clip du planning ou supprimer le clip directement depuis le calendrier.
- **Remise à zéro d'un joueur** (administration, page Utilisateurs, « Réinitialiser les stats ») : en cas de faille
  exploitée ou de triche, XP et niveau, scores et places dans tous les classements (saisons archivées comprises),
  pourcentage de réussite, séries, record Infini, statistiques par jeu, succès et bilan des duels repartent de zéro.
  Ses anciennes réponses ne comptent plus, mais les défis du jour déjà joués ne peuvent pas être rejoués. Il faut retaper
  le pseudo pour confirmer ; l'action est inscrite au journal d'audit.
- **Suppression** : un joueur peut supprimer son compte (profil, en retapant son pseudo) et n'importe lequel de ses clips ;
  l'administration peut supprimer un compte, supprimer un clip depuis la liste ou annuler l'acceptation d'un clip.
  Toutes les confirmations passent par une fenêtre de l'application (plus aucune fenêtre du navigateur).
- **Messagerie privée** : discussion entre amis, en temps réel, avec historique, messages non lus et notification push sur mobile.

### Barème

| Écart avec le rang réel | Rang exact | 1 rang | 2 rangs | 3 rangs ou plus |
|---|---|---|---|---|
| Points | 100 | 20 | 5 | 0 |

L'écart se calcule sur la position des rangs dans l'échelle de chaque jeu, jamais sur leur nom. Exemple, clip Gold :
Gold 100 · Silver ou Platinum 20 · Bronze ou Emerald 5 · Diamond et au-dessus 0. La règle est codée une seule fois dans
`packages/shared/src/scoring.ts`, utilisée par l'API pour le score officiel et par les écrans pour l'affichage.

## Commandes

```bash
npm run dev            # API + site + administration
npm run mobile         # application mobile (Expo), après vérification des dépendances
npm run reinstall      # réinstallation propre (supprime tous les node_modules)
npm run lint           # ESLint sur tout le projet
npm run typecheck      # vérification TypeScript
npm test               # tests du barème
npm run build          # build de production (API, site, administration)
npm run db:down        # arrête PostgreSQL et Redis
npm run admin:promote -- <pseudo> [OWNER|ADMIN|MODERATOR|REVIEWER|USER] [--transfer]
npm run account:password -- <pseudo> <email>   # email + mot de passe pour un compte existant
```

Remise à zéro complète : `docker compose down -v`, supprimer `apps/api/storage`, puis `npm run dev`.

## Arborescence

```
ranksight/
├── apps/
│   ├── api/
│   │   ├── prisma/          schema.prisma · migrations/ · seed.ts · promote.ts · set-password.ts
│   │   └── src/
│   │       ├── common/      guards (JWT, rôles, Premium), décorateurs, validation, journal d'audit
│   │       ├── redis/       connexion Redis + adaptateur Socket.IO multi-instances
│   │       └── modules/     auth · users · games · clips (jeu + propositions) · guesses · leaderboards
│   │                        friends · chat (privé + global) · mail · shop (VIP, Stripe) · achievements · versus (duels) · reports · admin · storage
│   │                        notifications · moderation (blocages, signalements) · contact · maintenance (conservation des données)
│   ├── web/                 app/ (accueil, login, signup, forgot-password, reset-password, play/daily/[game],
│   │                        play/infinite, versus, versus/[id], players/[id], leaderboard, achievements, shop, chat, friends, submit, my-clips, profile,
│   │                        verify-email, how-to-play, faq, contact, legal/{mentions,cgu,cgv,confidentialite,cookies})
│   ├── admin/               app/ (vue d'ensemble, clips, ajout, défis du jour, saisons, rangs, signalements clips et joueurs,
│   │                        chat global, utilisateurs, stockage, sécurité du compte)
│   └── mobile/              app/ (onglets dont Défis, Duels et Chat, login, signup, forgot-password, daily/[game], achievements,
│                            shop, chat/[id], player/[id], versus/[id], submit, my-clips)
├── packages/shared/         scoring.ts · schemas.ts
├── scripts/                 préparation de npm run dev et npm run mobile
├── deploy/                  mise en production : docker-compose.prod.yml, Caddyfile, sauvegardes, .env.production.example
└── docker-compose.yml       PostgreSQL + Redis (développement)
```

## Sécurité

- **Comptes** : mots de passe hachés (scrypt), verrouillage 15 minutes après 10 mots de passe incorrects, alerte par email
  quand le mot de passe change, « Se déconnecter de tous les appareils » (profil), confirmation de l'adresse email
  (nécessaire pour écrire et proposer des clips), acceptation des CGU et déclaration d'avoir 15 ans ou plus.
- **Administration** : double authentification (application d'authentification, codes de secours), facultative par
  défaut (`ADMIN_REQUIRE_2FA=false` : chaque membre l'active ou la désactive sur son compte) ; `true` la rend obligatoire
  pour la modération et l'administration. Quand elle est active, un code est demandé une fois par session et par 12 heures. Secret chiffré en base
  (AES-256-GCM). Un administrateur peut la retirer à un membre qui a perdu son téléphone. Actions journalisées avec l'adresse IP.
- **Démarrage refusé en production** si les secrets JWT sont faibles, si une adresse n'est pas en HTTPS, si CORS contient
  localhost ou si la base utilise le mot de passe de développement.
- **En-têtes** : politique de sécurité du contenu (CSP) stricte sur le site, l'administration et l'API, HSTS, pas
  d'intégration dans un cadre, polices hébergées avec le site (aucune requête vers Google).
- **Vidéos** : chaque fichier envoyé est analysé (ffprobe) ; un fichier qui n'est pas une vidéo est refusé automatiquement.
- **Suivi des erreurs** (facultatif) : `SENTRY_DSN` (API) et `NEXT_PUBLIC_SENTRY_DSN` (site), sans données personnelles.
- `/health` (état de l'API, de PostgreSQL et de Redis), `/.well-known/security.txt`, mises à jour de sécurité Dependabot.

## Administration dans l'application

Profil → « Administration » (équipe uniquement ; « Tri des clips » pour les trieurs). Mêmes droits et même double
authentification que l'administration web :

- **Accueil** : chiffres du jour, annonce du site et de l'application (texte, type, durée), accès aux outils.
- **Tri des clips** : vidéo, rang annoncé, preuve, pseudo en jeu ; valider ou refuser avec un motif.
- **Clips à valider** (modération) : clips pré-triés ou sans avis, confirmation des avis en lot, fiche du clip avec
  rang corrigé, difficulté, acceptation ou refus motivé.
- **Signalements** : joueurs (message signalé, suppression du message, coupure du chat, bannissement pour les
  administrateurs) et clips (voir, retirer, classer sans suite).
- **Suggestions** (modération) : idées des joueurs par statut, réponse à l'auteur, suppression.
- **Joueurs** : recherche, rôle, chat, VIP, email, photo, double authentification, statistiques, bannissement, suppression.
- **Boutique** (fondateur) : promo du moment, passes, codes cadeaux (création, partage, désactivation).
- **Sécurité du compte** : activation (ou désactivation, quand elle n'est pas obligatoire) de la double authentification
  depuis le téléphone (clé ouverte directement dans l'application d'authentification, codes de secours à enregistrer).

Le planning des défis du jour, les saisons, les rangs, les récompenses et le stockage restent sur l'administration web
(lien en bas de l'accueil), plus pratique sur un grand écran.

Clavier : les écrans de saisie utilisent `react-native-keyboard-controller` (inclus dans Expo Go), qui gère l'affichage
bord à bord d'Android : le champ actif reste toujours visible au-dessus du clavier. Les vidéos et photos sont envoyées
directement depuis le fichier du téléphone (`expo-file-system`), sans être copiées en mémoire.

## Modération

- Chaque joueur peut **signaler** un message (chat global, message privé reçu) ou un profil, et **bloquer** un joueur
  (plus d'amitié, de messages privés, de demandes d'ami ni de duels ; ses messages du chat global sont masqués).
- Administration, page « Signalements joueurs » : message signalé (copie conservée même s'il est supprimé), nombre de
  signalements sur le joueur, sanction (message supprimé, chat coupé 1 h à 30 jours, bannissement par un administrateur)
  ou classement sans suite. Page « Utilisateurs » : couper ou rétablir le chat d'un joueur.
- **Directement depuis le chat** (site et application) pour les modérateurs et administrateurs : supprimer un message,
  couper le chat d'un joueur (1 h, 24 h, 7 jours), effacer tous ses messages des dernières 24 heures, régler le **mode lent**
  (visible en direct par les joueurs, l'équipe n'est pas concernée). Sur le site, menu « Modérer » de chaque message ; dans
  l'application, appui long. Si la double authentification est active, le code est demandé une fois par session.
- **Mots interdits** (administration, page « Chat global ») : message refusé dans le chat global et les messages privés,
  y compris écrit avec des chiffres (« n00b »), des lettres répétées ou séparées (« c.o.n »).
- **Masquage automatique** : un message signalé par plusieurs joueurs différents (3 par défaut, réglable) est masqué en
  attendant la décision ; il réapparaît si le signalement est classé sans suite. Jamais pour un message de l'équipe.
- **Photo de profil** : signalable (« Photo de profil inappropriée ») et retirable par la modération.
- **Email non reçu** : un administrateur peut confirmer l'adresse d'un joueur depuis la page « Utilisateurs » (journalisé).

## Rôles et tri des clips

| Rôle | Accès |
| --- | --- |
| Joueur | Le jeu |
| Trieur de clips | Le jeu, et dans l'administration seulement « Tri des clips » |
| Modérateur | Administration : clips, signalements, chat, joueurs (sans changer les rôles ni supprimer de compte) |
| Administrateur | Tout, sauf ce qui est réservé au fondateur (quand un fondateur existe) |
| Fondateur | Tout ; son compte est intouchable |

**Réservé au fondateur** (dès qu'un fondateur est nommé ; avant, les administrateurs y ont accès pour que le site ne
soit jamais bloqué) : nommer, rétrograder ou sanctionner un administrateur (les administrateurs ne peuvent pas se retirer
le grade entre eux), la boutique (prix, promo du moment, codes cadeaux), le VIP offert ou retiré, l'annonce du site et de
l'application, le stockage (place occupée, nettoyage), le journal d'audit, la suppression définitive d'un compte et le
retrait de la double authentification d'un membre. Les administrateurs gardent la modération (bannir, couper le chat,
remettre des statistiques à zéro, clips, signalements, récompenses, saisons, défis du jour).

- **Fondateur** : compte du propriétaire du site, unique. Personne d'autre ne peut changer son rôle, le bannir, le
  supprimer, remettre ses statistiques à zéro, retirer sa double authentification, sa photo, son VIP ou ses récompenses.
  Dès qu'un fondateur existe, lui seul peut nommer, rétrograder ou sanctionner un administrateur : un administrateur ne
  peut pas en écarter un autre. Sans fondateur, les administrateurs gardent les mêmes droits qu'avant.

- **Trieur de clips** : il regarde les clips proposés par les joueurs et donne un avis (valider, ou refuser avec un motif).
  Le clip reste en attente : rien n'est publié ni refusé sans la modération. Raccourcis clavier : V valider, R refuser,
  1 à 7 motifs, Entrée confirmer, P passer. Il peut annuler son dernier avis. Il ne trie jamais ses propres clips et ne
  voit pas qui a envoyé le clip. Dans le chat et le jeu, c'est un joueur comme les autres.
- **Confirmation** : dans « Clips » → « Pré-triés », la modération voit l'avis et son motif, confirme en lot
  (« Tout sélectionner » → « Confirmer les avis ») ou tranche autrement depuis la fiche du clip (le motif du trieur est
  proposé). La page « Tri des clips » montre aussi le bilan de chaque trieur (avis confirmés ou contredits).
- Le joueur reçoit une notification sur son téléphone quand son clip est accepté ou refusé (avec le motif).

## Annonce, pseudos, partage

- **Annonce** (administration, « Vue d'ensemble ») : un message en haut du site et de l'application (information,
  événement, maintenance), avec un lien et une date de fin facultatifs. Le joueur peut la fermer ; une nouvelle annonce
  réapparaît.
- **Pseudos** : 3 à 20 caractères, lettres accentuées comprises (« Élodie », « Zoé_42 »), chiffres, `_`, `-` et `.`.
  L'unicité ignore les accents et la casse : « elodie » est refusé si « Élodie » existe ; la recherche d'amis trouve
  « Élodie » en tapant « elodie ».
- **Pseudos réservés** : refusés à l'inscription et au changement de pseudo (« Admin », « Modo », « RankGuess_Officiel »,
  « Staff… »), ainsi que ceux qui contiennent un mot interdit du chat. Un nom Google ou Discord refusé devient « JoueurXXXX ».
- **Partage et installation** : icône du site, aperçu des liens partagés (Discord, X, WhatsApp), site installable sur
  l'écran d'accueil, pages « introuvable » et « erreur » aux couleurs du jeu.

## Titres, badges et cadres

- Trois types de récompenses : **titre** (sous le pseudo), **badge** (icône à côté du pseudo), **cadre** (anneau
  autour de la photo). Le joueur choisit ce qu'il équipe dans « Titres, badges et cadres » (menu du profil) ; c'est
  affiché dans le chat, les classements, les duels, la liste d'amis et le profil public.
- Obtention : **paliers de niveau** (Recrue au niveau 5, cadre Bronze au 10, Argent au 20, Or au 30, Néon au 50…),
  **succès** (« Œil de lynx », « Machine »…), **fin de saison** (titres « Champion saison N » et « Podium saison N »,
  badge « Top 10 saison N », titre « Contributeur saison N » pour le joueur qui a fait accepter le plus de clips,
  créés automatiquement à la clôture) ou **attribution par l'équipe** (Youtubeur, Streamer,
  Partenaire, Bêta-testeur…).
- **Comment l'obtenir** : chaque titre, badge et cadre indique sa provenance (« Succès « X » », « Atteindre le niveau N »,
  « 1re place du classement de la saison N », « Attribué par l'équipe : <description> » ; « Succès secret » pour un succès
  caché). Affiché dans « Titres, badges et cadres » (« Obtenu : … », « Pour l'obtenir : … »), sur le profil public, en
  info-bulle sur les badges et titres du site, et d'un appui sur un badge dans l'application.
- Administration, page « Récompenses » : créer et modifier (nom, couleur, icône, dégradé du cadre, condition de
  déblocage), désactiver, voir les joueurs qui l'ont, attribuer par pseudo avec une raison interne, retirer. Une
  récompense automatique créée après coup est donnée tout de suite aux joueurs qui remplissent déjà la condition.
  Depuis la fiche d'un joueur (« Utilisateurs » → « Récompenses ») : ses récompenses, attribution et retrait.
- La remise à zéro des statistiques retire les récompenses gagnées en jouant ; celles données par l'équipe restent.

## Photo de profil

Envoyée depuis le profil (site ou application) : JPEG, PNG ou WebP jusqu'à 5 Mo. Le serveur la recadre en carré
256 × 256, la convertit en WebP et supprime les métadonnées (dont la position GPS des photos de téléphone). L'ancienne
photo est supprimée à chaque changement. Il faut avoir confirmé son adresse email. L'adresse enregistrée ne contient pas de domaine
(`/v1/avatars/<fichier>.webp`) : le site, l'administration et l'application la complètent avec l'adresse de l'API qu'ils
utilisent, ce qui permet de voir les photos depuis un téléphone. Une photo introuvable laisse place à l'initiale du pseudo.

## Stockage des vidéos

- Compression automatique à l'envoi : 720p, H.264 + AAC, démarrage rapide, image d'aperçu (ffmpeg, installé dans
  l'image Docker ; facultatif en local).
- Nettoyage chaque nuit (3 h 30 UTC) : vidéos des clips supprimés, des clips refusés depuis 14 jours, envois abandonnés.
- Administration, page « Stockage » : espace utilisé, gain de la compression, dernier nettoyage, bouton « Nettoyer maintenant ».
- Durées de conservation des données appliquées chaque nuit (sessions, liens, journaux), comme indiqué dans la
  politique de confidentialité.

## Pages légales et d'information

Mentions légales, CGU, CGV (avec la renonciation au droit de rétractation cochée avant le paiement et l'email de
confirmation de commande), politique de confidentialité, cookies, « Comment jouer », FAQ et formulaire de contact.
Les informations de l'éditeur viennent des variables `LEGAL_*` du `.env` : tant qu'elles sont vides, les pages
affichent « Non renseigné ». La page « Supprimer son compte » (`/legal/suppression-compte`) est l'adresse à donner à
Google Play pour la suppression des données.

## Production

Tout est prêt dans `deploy/` pour un serveur (VPS) avec Docker :

```bash
cd deploy
cp .env.production.example .env.production   # puis compléter (domaines, secrets, R2, SMTP, Stripe, LEGAL_*)
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

- **Caddy** sert le site, l'administration et l'API en HTTPS (certificats Let's Encrypt automatiques).
- **PostgreSQL** et **Redis** (avec mot de passe) ne sont pas exposés sur Internet.
- **Sauvegarde** de la base chaque nuit dans `deploy/backups` (14 jours) ; restauration : `sh restore.sh backups/<fichier>.dump`.
- L'API applique les migrations et charge les jeux, rangs et succès à chaque démarrage.
- **Stockage R2** : les vidéos et photos partent directement du navigateur vers R2 (URL signées). Il faut donc 1) la
  règle CORS du bucket (origines du site, de `www.` et de l'administration ; méthodes GET, HEAD, PUT ; en-têtes `*` ;
  en-tête exposé `ETag`), 2) `S3_ENDPOINT` dans `.env.production` : il est ajouté automatiquement à la CSP du site et de
  l'administration au moment de leur construction (`build admin web` après un changement). Le bucket reste privé.
- Application mobile : `eas.json` (profils preview et production), icônes dans `apps/mobile/assets`.

## Publier sur Google Play

### Paiement dans l'application

- Les pass VIP sont des **produits ponctuels** Google Play (`vip_1m`, `vip_3m`, `vip_12m`), achetés avec Google Play
  Billing (bibliothèque `expo-iap`). Stripe reste le moyen de paiement du site.
- À chaque achat, l'application envoie le jeton d'achat à l'API (`POST /v1/shop/google-play`). L'API le vérifie auprès de
  Google (API Google Play Developer), refuse un achat fait depuis un autre compte, crédite le VIP une seule fois puis
  consomme l'achat (le pass peut être racheté).
- Paiements en attente (espèces, virement) : le VIP est activé dès que Google confirme le paiement, à la réouverture de l'écran.
- Remboursements : toutes les heures, l'API lit les achats remboursés ou annulés chez Google et retire les jours de VIP
  correspondants.
- Sur iPhone, l'écran « Mon VIP » affiche le statut et les avantages (pas d'achat dans l'application).
- L'achat fonctionne uniquement dans une version installée depuis Google Play (piste de test ou production), pas dans Expo Go.

### Identifiant de l'application

`com.rankguess.app` par défaut (`apps/mobile/app.json`). Il est **définitif** dès la première publication. Pour en
choisir un autre, définis `ANDROID_PACKAGE` dans les variables EAS (et la même valeur dans `GOOGLE_PLAY_PACKAGE_NAME`
côté API).

### Étapes

1. **Compte développeur** Google Play (play.google.com/console, frais unique de 25 $), avec vérification d'identité.
2. **Projet EAS** : `cd apps/mobile && npx eas-cli login && npx eas-cli init`, puis copie l'identifiant du projet dans
   `extra.eas.projectId` de `app.json` (ou dans la variable `EAS_PROJECT_ID`). Variables EAS de l'environnement
   `production` : `EXPO_PUBLIC_API_URL=https://api.<domaine>/v1`, `EXPO_PUBLIC_WEB_URL=https://<domaine>` et
   `EXPO_PUBLIC_ADMIN_URL=https://admin.<domaine>` (lien vers l'administration web complète, en bas de l'administration de l'application).
3. **Premier build** : `npm run build:android -w @ranksight/mobile` (fichier `.aab`, numéro de version incrémenté
   automatiquement). Crée l'application dans la Play Console et envoie ce fichier sur la piste **Test interne**
   (Google n'autorise la création des produits qu'après un premier envoi contenant la bibliothèque de paiement).
4. **Produits** : Play Console → Monétiser → Produits → Produits intégrés → créer `vip_1m`, `vip_3m` et `vip_12m`
   (mêmes identifiants, prix promo 2,49 €, 6,49 €, 19,99 € pendant la promo ; ensuite 4,99 €, 12,99 €, 39,99 €), puis les
   activer. À chaque promo, changer aussi les prix dans la Play Console (Google ne lit pas les prix de RankGuess).
5. **Compte de service** : console.cloud.google.com → nouveau projet → activer « Google Play Android Developer API » →
   IAM → Comptes de service → créer → Clés → Ajouter une clé JSON. Dans la Play Console → Utilisateurs et
   autorisations → inviter l'adresse du compte de service avec les droits « Afficher les données financières » et
   « Gérer les commandes et les abonnements ». Côté serveur : `GOOGLE_PLAY_PACKAGE_NAME` et
   `GOOGLE_PLAY_SERVICE_ACCOUNT` (contenu du JSON en base64), puis redémarrer l'API. La boutique de l'application
   s'ouvre alors automatiquement.
6. **Testeurs de licence** : Play Console → Paramètres → Test des licences → ajouter les comptes Gmail des testeurs.
   Leurs achats sont gratuits (enregistrés à 0 €).
7. **Test fermé** (comptes personnels créés après novembre 2023) : au moins 12 testeurs pendant 14 jours avant de
   pouvoir demander l'accès à la production.
8. **Fiche et formulaires** : description, captures d'écran, icône 512 × 512, bannière 1024 × 500 ; politique de
   confidentialité `https://<domaine>/legal/confidentialite` ; suppression de compte
   `https://<domaine>/legal/suppression-compte` ; classification du contenu (questionnaire IARC) ; public cible
   (15 ans et plus) ; « Sécurité des données » (voir la feuille de route).
9. **Envoi automatique** des builds suivants : `npm run submit:android -w @ranksight/mobile` (piste Test interne, en
   brouillon). La clé JSON d'un compte de service ayant le droit de publier est demandée la première fois et gardée par EAS.
