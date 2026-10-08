"use client";

import { useEffect } from "react";

/**
 * Suivi des erreurs du navigateur (facultatif) : actif seulement si NEXT_PUBLIC_SENTRY_DSN est renseigné.
 * Le module n'est chargé qu'à ce moment-là ; aucune donnée personnelle n'est envoyée.
 */
export function ErrorReporting() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    void import("@sentry/browser").then((Sentry) =>
      Sentry.init({ dsn, sendDefaultPii: false, tracesSampleRate: 0, environment: process.env.NODE_ENV }),
    );
  }, []);
  return null;
}
