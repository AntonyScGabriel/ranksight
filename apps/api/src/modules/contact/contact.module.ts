import { Body, Controller, HttpCode, Logger, Module, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ContactInput } from "@ranksight/shared";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { currentIp } from "../../common/request-context.js";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { MailService } from "../mail/mail.service.js";
import { escapeHtml } from "../auth/mfa.service.js";

/** Adresse de destination : CONTACT_EMAIL, sinon l'adresse d'expédition des emails */
function contactAddress() {
  if (env().CONTACT_EMAIL) return env().CONTACT_EMAIL;
  return env().MAIL_FROM.match(/<([^>]+)>/)?.[1] ?? env().MAIL_FROM;
}

/** Formulaire de contact du site : transmis par email à l'équipe (limité à 5 messages par heure et par adresse IP). */
@Controller("contact")
export class ContactController {
  private readonly logger = new Logger(ContactController.name);

  constructor(private readonly mail: MailService, private readonly prisma: PrismaService) {}

  @Public()
  @Post()
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  async send(@CurrentUser() user: AuthUser | undefined, @Body(new ZodPipe(ContactInput)) body: z.output<typeof ContactInput>) {
    // Champ piège rempli : robot, on répond comme si tout allait bien
    if (body.website) return;
    const account = user ? await this.prisma.user.findUnique({ where: { id: user.sub }, select: { id: true, username: true } }) : null;
    const meta = `Expéditeur : ${body.email}${account ? ` (compte @${account.username}, ${account.id})` : " (non connecté)"} · IP ${currentIp() ?? "inconnue"}`;
    await this.mail.send({
      to: contactAddress(),
      subject: `[Contact RankGuess] ${body.subject.replace(/[\r\n]+/g, " ")}`,
      text: `${body.message}\n\n— ${meta}`,
      html: `<p>${escapeHtml(body.message).replace(/\n/g, "<br>")}</p><hr><p style="color:#666">${escapeHtml(meta)}</p>`,
      replyTo: body.email,
    });
    this.logger.log(`Message de contact reçu de ${body.email}`);
  }
}

@Module({ controllers: [ContactController] })
export class ContactModule {}
