import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException,
} from "@nestjs/common";
import { TERMS_VERSION, pseudoKey } from "@ranksight/shared";
import type { Redis } from "ioredis";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { env } from "../../config/env.js";
import { assertPseudoAllowed, pseudoProblem } from "../../common/pseudo-policy.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { MailService } from "../mail/mail.service.js";
import type { OAuthProfile } from "./oauth.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_COOLDOWN_SEC = 60;
const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;
/** Verrouillage d'un compte après 10 mots de passe incorrects en 15 minutes (en plus de la limite par adresse IP) */
const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCK_SEC = 15 * 60;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Erreur levée quand Google ou Discord renvoie l'email d'un compte classique dont l'email n'a jamais été confirmé. */
export class EmailInUseError extends Error {}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ---------- Google / Discord ----------

  /**
   * 1. Compte Google/Discord déjà lié → connexion.
   * 2. Email vérifié par le fournisseur et compte existant dont l'email est confirmé → liaison automatique.
   *    Si l'email du compte existant n'a jamais été confirmé, la liaison est refusée : sinon, quelqu'un pourrait
   *    créer un compte avec l'email d'une autre personne et récupérer sa connexion Google.
   * 3. Sinon → création, avec un pseudo RankGuess unique dérivé du nom chez le fournisseur.
   */
  async findOrCreateUser(p: OAuthProfile): Promise<string> {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: p.provider, providerAccountId: p.providerAccountId } },
      include: { user: { select: { status: true } } },
    });
    if (linked) {
      this.assertActive(linked.user.status);
      return linked.userId;
    }

    const email = p.email?.toLowerCase() ?? null;
    if (email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (!p.emailVerified || !existing.emailVerifiedAt) throw new EmailInUseError();
        this.assertActive(existing.status);
        await this.prisma.oAuthAccount.create({
          data: { userId: existing.id, provider: p.provider, providerAccountId: p.providerAccountId, providerUsername: p.username },
        });
        return existing.id;
      }
    }

    const pseudo = await this.uniquePseudo(p.username);
    const user = await this.prisma.user.create({
      data: {
        email: p.emailVerified ? email : null,
        emailVerifiedAt: p.emailVerified && email ? new Date() : null,
        username: pseudoKey(pseudo),
        displayName: pseudo,
        avatarUrl: p.avatarUrl,
        oauthAccounts: {
          create: { provider: p.provider, providerAccountId: p.providerAccountId, providerUsername: p.username },
        },
      },
    });
    return user.id;
  }

  // ---------- Compte classique ----------

  async signup(input: { pseudo: string; email: string; password: string; acceptTerms: true }): Promise<string> {
    const username = pseudoKey(input.pseudo);
    await assertPseudoAllowed(this.prisma, input.pseudo);
    const [pseudoTaken, emailTaken] = await Promise.all([
      this.prisma.user.findUnique({ where: { username }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    ]);
    if (pseudoTaken) throw this.conflict("PSEUDO_TAKEN", "Ce pseudo est déjà utilisé.");
    if (emailTaken) throw this.conflict("EMAIL_TAKEN", "Un compte existe déjà avec cette adresse email.");

    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          username, displayName: input.pseudo, email: input.email, passwordHash,
          termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION,
        },
      });
      await this.sendVerification(user.id).catch((e) => this.logger.error("Email de confirmation non envoyé", e as Error));
      return user.id;
    } catch (e) {
      // Deux inscriptions simultanées : les contraintes uniques de la base tranchent
      if ((e as { code?: string }).code === "P2002") {
        const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? "");
        throw target.includes("email")
          ? this.conflict("EMAIL_TAKEN", "Un compte existe déjà avec cette adresse email.")
          : this.conflict("PSEUDO_TAKEN", "Ce pseudo est déjà utilisé.");
      }
      throw e;
    }
  }

  async login(email: string, password: string): Promise<string> {
    const failKey = `login:fail:${sha256(email)}`;
    if (Number(await this.redis.get(failKey)) >= LOGIN_MAX_FAILURES) {
      const ttl = Math.max(await this.redis.ttl(failKey), 60);
      throw new HttpException(
        { code: "ACCOUNT_LOCKED", message: `Trop de mots de passe incorrects. Réessaie dans ${Math.ceil(ttl / 60)} minute(s) ou utilise « Mot de passe oublié ».` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, passwordHash: true, _count: { select: { oauthAccounts: true } } },
    });
    const valid = await this.passwords.verify(password, user?.passwordHash);
    if (!user || !valid) {
      await this.redis.multi().incr(failKey).expire(failKey, LOGIN_LOCK_SEC).exec();
      if (user && !user.passwordHash && user._count.oauthAccounts > 0) {
        throw new UnauthorizedException({
          code: "USE_OAUTH",
          message: "Ce compte se connecte avec Google ou Discord. Utilise le bouton correspondant, ou « Mot de passe oublié » pour créer un mot de passe.",
        });
      }
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Email ou mot de passe incorrect." });
    }
    this.assertActive(user.status);
    await this.redis.del(failKey);
    return user.id;
  }

  // ---------- Confirmation de l'adresse email ----------

  /** Envoie (ou renvoie) le lien de confirmation de l'adresse email, valable 48 heures. */
  async sendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, displayName: true } });
    if (!user?.email || user.emailVerifiedAt) return { sent: false };
    if (!(await this.redis.set(`verify:cooldown:${userId}`, "1", "EX", RESET_COOLDOWN_SEC, "NX"))) {
      throw new HttpException({ code: "SLOW_DOWN", message: "Un email vient d'être envoyé. Patiente une minute avant d'en redemander un." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const token = randomBytes(32).toString("base64url");
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.emailVerificationToken.create({
        data: { userId, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
      }),
    ]);
    const link = `${env().WEB_URL}/verify-email?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: "Confirme ton adresse email RankGuess",
      text: `Bonjour ${user.displayName},\n\nBienvenue sur RankGuess ! Pour activer ton compte, confirme ton adresse email en ouvrant ce lien (valable 48 heures) :\n${link}\n\nSi tu n'as pas créé de compte, ignore cet email.`,
      html: `<p>Bonjour ${escapeHtml(user.displayName)},</p><p>Bienvenue sur RankGuess ! Pour activer ton compte, confirme ton adresse email (lien valable 48 heures) :</p><p><a href="${link}">Activer mon compte</a></p><p>Si tu n'as pas créé de compte, ignore cet email.</p>`,
    });
    return { sent: true };
  }

  /**
   * Adresse mal saisie à l'inscription : tant qu'elle n'est pas confirmée, le joueur peut la corriger (avec son mot de
   * passe) ; un nouveau lien part aussitôt vers la nouvelle adresse.
   */
  async changeUnverifiedEmail(userId: string, email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, passwordHash: true, displayName: true } });
    if (!user) throw new UnauthorizedException();
    if (!(await this.passwords.verify(password, user.passwordHash))) {
      throw new BadRequestException({ code: "WRONG_PASSWORD", message: "Mot de passe incorrect." });
    }
    if (user.emailVerifiedAt) return this.requestEmailChange(userId, user.displayName, user.email, email);
    if (email !== user.email) {
      if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new ConflictException({ code: "EMAIL_IN_USE", message: "Cette adresse email est déjà utilisée par un autre compte." });
      }
      await this.prisma.user.update({ where: { id: userId }, data: { email } });
      // Nouvelle adresse : le délai entre deux envois ne s'applique pas
      await this.redis.del(`verify:cooldown:${userId}`);
    }
    return this.sendVerification(userId);
  }

  /**
   * Adresse déjà confirmée : la nouvelle adresse ne remplace l'ancienne qu'une fois confirmée par le lien qui lui est
   * envoyé (une faute de frappe ne fait pas perdre l'accès au compte).
   */
  private async requestEmailChange(userId: string, displayName: string, current: string | null, email: string) {
    if (email === current) throw new BadRequestException({ code: "SAME_EMAIL", message: "C'est déjà ton adresse email." });
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException({ code: "EMAIL_IN_USE", message: "Cette adresse email est déjà utilisée par un autre compte." });
    }
    if (!(await this.redis.set(`emailchange:cooldown:${userId}`, "1", "EX", RESET_COOLDOWN_SEC, "NX"))) {
      throw new HttpException({ code: "SLOW_DOWN", message: "Un email vient d'être envoyé. Patiente une minute avant d'en redemander un." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const token = randomBytes(32).toString("base64url");
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.emailVerificationToken.create({ data: { userId, email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) } }),
    ]);
    const link = `${env().WEB_URL}/verify-email?token=${token}`;
    await this.mail.send({
      to: email,
      subject: "Confirme ta nouvelle adresse email RankGuess",
      text: `Bonjour ${displayName},\n\nPour utiliser cette adresse sur ton compte RankGuess, ouvre ce lien (valable 48 heures) :\n${link}\n\nTant qu'elle n'est pas confirmée, ton ancienne adresse reste celle du compte. Si tu n'as rien demandé, ignore cet email.`,
      html: `<p>Bonjour ${escapeHtml(displayName)},</p><p>Pour utiliser cette adresse sur ton compte RankGuess, clique sur ce lien (valable 48 heures) :</p><p><a href="${link}">Confirmer ma nouvelle adresse</a></p><p>Tant qu'elle n'est pas confirmée, ton ancienne adresse reste celle du compte. Si tu n'as rien demandé, ignore cet email.</p>`,
    });
    return { sent: true, pending: true };
  }

  async verifyEmail(token: string) {
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { email: true, status: true, emailVerifiedAt: true, displayName: true } } },
    });
    // Compte déjà confirmé et lien envoyé à une autre adresse : changement d'adresse demandé depuis le profil
    if (stored && !stored.usedAt && stored.expiresAt >= new Date() && stored.user.emailVerifiedAt && stored.user.email !== stored.email) {
      return this.confirmEmailChange(stored.id, stored.userId, stored.user.status, stored.user.displayName, stored.user.email, stored.email);
    }
    // Lien expiré, déjà utilisé, ou adresse du compte changée depuis l'envoi
    if (!stored || stored.usedAt || stored.expiresAt < new Date() || stored.user.email !== stored.email) {
      throw new BadRequestException({ code: "VERIFY_EXPIRED", message: "Ce lien a expiré ou a déjà été utilisé. Demande un nouvel email depuis ton profil." });
    }
    this.assertActive(stored.user.status);
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: stored.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
  }

  private async confirmEmailChange(tokenId: string, userId: string, status: string, displayName: string, previous: string | null, email: string) {
    this.assertActive(status);
    const taken = () => new ConflictException({ code: "EMAIL_IN_USE", message: "Cette adresse email est déjà utilisée par un autre compte." });
    if (await this.prisma.user.findFirst({ where: { email, id: { not: userId } }, select: { id: true } })) throw taken();
    try {
      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } }),
        this.prisma.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: new Date() } }),
      ]);
    } catch (e) {
      // Adresse prise par un autre compte au même instant (index unique)
      if ((e as { code?: string }).code === "P2002") throw taken();
      throw e;
    }
    // L'ancienne adresse est prévenue : si ce n'est pas le joueur, il sait qu'il doit réagir
    if (previous) {
      await this.mail.send({
        to: previous,
        subject: "L'adresse email de ton compte RankGuess a changé",
        text: `Bonjour ${displayName},\n\nL'adresse email de ton compte RankGuess est désormais ${email}. Cette adresse-ci ne sert plus pour la connexion.\nSi ce n'est pas toi, contacte immédiatement l'équipe.`,
        html: `<p>Bonjour ${escapeHtml(displayName)},</p><p>L'adresse email de ton compte RankGuess est désormais <strong>${escapeHtml(email)}</strong>. Cette adresse-ci ne sert plus pour la connexion.</p><p>Si ce n'est pas toi, contacte immédiatement l'équipe.</p>`,
      });
    }
    this.logger.log(`Adresse email changée pour ${userId}`);
  }

  /**
   * Changement du mot de passe depuis le profil (mot de passe actuel exigé) : toutes les sessions sont fermées, il faut
   * se reconnecter avec le nouveau. Erreurs en 400 (pas 401) : l'écran ne doit pas croire la session expirée.
   */
  async changePassword(userId: string, currentPassword: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, passwordHash: true, email: true, displayName: true } });
    if (!user) throw new UnauthorizedException();
    this.assertActive(user.status);
    if (!user.passwordHash) {
      throw new BadRequestException({ code: "NO_PASSWORD", message: "Ton compte se connecte avec Google ou Discord : utilise « Mot de passe oublié » pour créer un mot de passe." });
    }
    if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
      throw new BadRequestException({ code: "WRONG_PASSWORD", message: "Mot de passe actuel incorrect." });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(password) } }),
      // Un lien « Mot de passe oublié » encore valide ne sert plus
      this.prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    await this.tokens.revokeAll(userId);
    if (user.email) {
      await this.mail.send({
        to: user.email,
        subject: "Ton mot de passe RankGuess a été modifié",
        text: `Bonjour ${user.displayName},\n\nLe mot de passe de ton compte vient d'être modifié depuis ton profil et tes appareils ont été déconnectés.\nSi ce n'est pas toi, fais immédiatement « Mot de passe oublié » et contacte l'équipe.`,
        html: `<p>Bonjour ${escapeHtml(user.displayName)},</p><p>Le mot de passe de ton compte vient d'être modifié depuis ton profil et tes appareils ont été déconnectés.</p><p>Si ce n'est pas toi, fais immédiatement « Mot de passe oublié » et contacte l'équipe.</p>`,
      });
    }
    this.logger.log(`Mot de passe changé depuis le profil pour ${userId}`);
  }

  /**
   * Mot de passe oublié : la réponse est identique que l'adresse existe ou non (pas de divulgation des comptes).
   * Le lien est valable 1 heure, à usage unique ; seul le hash du jeton est conservé.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, status: true, displayName: true } });
    if (!user || user.status !== "ACTIVE") return;
    if (!(await this.redis.set(`pwreset:cooldown:${user.id}`, "1", "EX", RESET_COOLDOWN_SEC, "NX"))) return;
    await this.sendResetLink(user, email);
  }

  /** Lien de réinitialisation envoyé par l'administration (le joueur n'a pas reçu le sien) ; false si un lien vient de partir */
  async sendPasswordResetFor(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, email: true, displayName: true } });
    if (!user?.email) throw new BadRequestException("Ce compte n'a pas d'adresse email.");
    this.assertActive(user.status);
    if (!(await this.redis.set(`pwreset:cooldown:${userId}`, "1", "EX", RESET_COOLDOWN_SEC, "NX"))) return false;
    await this.sendResetLink(user, user.email);
    return true;
  }

  private async sendResetLink(user: { id: string; displayName: string }, email: string) {

    const token = randomBytes(32).toString("base64url");
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      }),
    ]);
    const link = `${env().WEB_URL}/reset-password?token=${token}`;
    await this.mail.send({
      to: email,
      subject: "Réinitialisation de ton mot de passe RankGuess",
      text: `Bonjour ${user.displayName},\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable 1 heure) :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore cet email : ton mot de passe reste inchangé.`,
      html: `<p>Bonjour ${escapeHtml(user.displayName)},</p><p>Pour choisir un nouveau mot de passe, clique sur ce lien (valable 1 heure) :</p><p><a href="${link}">Choisir un nouveau mot de passe</a></p><p>Si tu n'es pas à l'origine de cette demande, ignore cet email : ton mot de passe reste inchangé.</p>`,
    });
  }

  /** Nouveau mot de passe : confirme aussi l'email (le lien y a été reçu) et ferme toutes les sessions ouvertes. */
  async resetPassword(token: string, password: string) {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { status: true, emailVerifiedAt: true } } },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new BadRequestException({ code: "RESET_EXPIRED", message: "Ce lien a expiré ou a déjà été utilisé. Fais une nouvelle demande." });
    }
    this.assertActive(stored.user.status);
    const passwordHash = await this.passwords.hash(password);
    const consumed = await this.prisma.passwordResetToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count === 0) throw new BadRequestException({ code: "RESET_EXPIRED", message: "Ce lien a déjà été utilisé." });
    await this.prisma.user.update({
      where: { id: stored.userId },
      data: { passwordHash, emailVerifiedAt: stored.user.emailVerifiedAt ?? new Date() },
    });
    await this.tokens.revokeAll(stored.userId);
    const user = await this.prisma.user.findUnique({ where: { id: stored.userId }, select: { email: true, displayName: true } });
    if (user?.email) {
      await this.redis.del(`login:fail:${sha256(user.email)}`);
      await this.mail.send({
        to: user.email,
        subject: "Ton mot de passe RankGuess a été modifié",
        text: `Bonjour ${user.displayName},\n\nLe mot de passe de ton compte vient d'être modifié et tes appareils ont été déconnectés.\nSi ce n'est pas toi, refais immédiatement « Mot de passe oublié » et contacte l'équipe.`,
        html: `<p>Bonjour ${escapeHtml(user.displayName)},</p><p>Le mot de passe de ton compte vient d'être modifié et tes appareils ont été déconnectés.</p><p>Si ce n'est pas toi, refais immédiatement « Mot de passe oublié » et contacte l'équipe.</p>`,
      });
    }
    this.logger.log(`Mot de passe réinitialisé pour ${stored.userId}`);
  }

  // ---------- Outils ----------

  private assertActive(status: string) {
    if (status !== "ACTIVE") throw new ForbiddenException({ code: "ACCOUNT_DISABLED", message: "Ce compte est suspendu." });
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  /** Pseudo RankGuess libre, dérivé du nom affiché chez Google ou Discord (casse et accents conservés). */
  private async uniquePseudo(name: string): Promise<string> {
    // Accents et lettres de toutes les langues conservés ; espaces et autres signes retirés
    const cleaned = name.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}_.-]/gu, "").slice(0, 16);
    // Nom Google ou Discord réservé ou interdit : pseudo générique (modifiable ensuite par le joueur)
    const base = cleaned && !(await pseudoProblem(this.prisma, cleaned)) ? cleaned : "Joueur";
    for (let i = 0; i < 10; i++) {
      const pseudo = i === 0 && base.length >= 3 ? base : `${base}${randomInt(1000, 9999)}`;
      if (!(await this.prisma.user.findUnique({ where: { username: pseudoKey(pseudo) } }))) return pseudo;
    }
    return `Joueur${Date.now().toString(36)}`;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
