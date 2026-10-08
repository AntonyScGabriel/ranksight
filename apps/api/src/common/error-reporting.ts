import { ArgumentsHost, Catch, HttpException, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";

let enabled = false;

/** Suivi des erreurs : actif seulement si SENTRY_DSN est renseigné. Aucune donnée personnelle n'est envoyée. */
export function initErrorReporting() {
  const dsn = env().SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: env().NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      // Jamais de cookies, d'en-têtes d'authentification ni de corps de requête
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      return event;
    },
  });
  enabled = true;
  new Logger("ErrorReporting").log("Suivi des erreurs activé (Sentry)");
}

export function reportError(error: unknown) {
  if (enabled) Sentry.captureException(error);
}

/** Erreurs inattendues (500) : transmises au suivi des erreurs ; les erreurs prévues (4xx) ne le sont pas. */
@Catch()
export class ReportingExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) reportError(exception);
    super.catch(exception, host);
  }
}
