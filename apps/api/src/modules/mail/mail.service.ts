import { Global, Injectable, Logger, Module } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/**
 * Envoi d'emails par SMTP (Brevo, Mailjet, Resend, Gmail…).
 * Sans SMTP_HOST (développement local), le contenu est écrit dans le journal de l'API pour pouvoir suivre le lien.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  get configured() {
    return !!env().SMTP_HOST;
  }

  async send(mail: Mail) {
    if (!this.configured) {
      this.logger.log(`Email pour ${mail.to} — ${mail.subject}\n${mail.text}`);
      return;
    }
    this.transporter ??= nodemailer.createTransport({
      host: env().SMTP_HOST,
      port: env().SMTP_PORT,
      secure: env().SMTP_SECURE,
      auth: env().SMTP_USER ? { user: env().SMTP_USER, pass: env().SMTP_PASSWORD } : undefined,
    });
    try {
      await this.transporter.sendMail({ from: env().MAIL_FROM, ...mail });
    } catch (e) {
      // L'erreur n'est pas renvoyée au client : la réponse reste identique que l'email existe ou non
      this.logger.error(`Envoi de l'email impossible : ${(e as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
