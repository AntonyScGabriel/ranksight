import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

export interface CheckoutSession {
  id: string;
  url: string | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  status: "open" | "complete" | "expired";
  client_reference_id: string | null;
  metadata: Record<string, string>;
}

/** Tolérance sur l'horodatage des notifications Stripe (protection contre le rejeu) */
const WEBHOOK_TOLERANCE_SEC = 300;

/**
 * Accès minimal à l'API Stripe (Checkout) par HTTP : création et lecture d'une session de paiement,
 * vérification de la signature des notifications (webhooks). Les données de carte ne passent jamais par RankGuess.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  get enabled() {
    return !!env().STRIPE_SECRET_KEY;
  }

  async createCheckout(input: {
    userId: string; email: string | null; productId: string; name: string; amountCents: number; successUrl: string; cancelUrl: string;
  }): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.userId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][price_data][product_data][name]": `RankGuess · ${input.name}`,
      "metadata[userId]": input.userId,
      "metadata[product]": input.productId,
    });
    if (input.email) form.set("customer_email", input.email);
    return this.call<CheckoutSession>("POST", "/v1/checkout/sessions", form);
  }

  getCheckout(sessionId: string): Promise<CheckoutSession> {
    return this.call<CheckoutSession>("GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** Vérifie l'en-tête Stripe-Signature (HMAC SHA-256 de « horodatage.corps ») et renvoie l'événement. */
  verifyWebhook(rawBody: Buffer | undefined, header: string | undefined): { type: string; data: { object: CheckoutSession } } | null {
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!secret || !rawBody || !header) return null;
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
    const timestamp = Number(parts.t);
    const signatures = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
    if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SEC) return null;
    const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest();
    const valid = signatures.some((sig) => {
      const given = Buffer.from(sig, "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    return valid ? JSON.parse(rawBody.toString("utf8")) : null;
  }

  private async call<T>(method: "GET" | "POST", path: string, form?: URLSearchParams): Promise<T> {
    if (!this.enabled) throw new ServiceUnavailableException({ code: "PAYMENT_UNAVAILABLE", message: "Le paiement n'est pas disponible pour le moment." });
    const res = await fetch(`${env().STRIPE_API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env().STRIPE_SECRET_KEY}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: form,
    }).catch(() => null);
    if (!res?.ok) {
      const detail = res ? await res.text().catch(() => "") : "réseau indisponible";
      this.logger.error(`Stripe ${method} ${path} : ${res?.status ?? "-"} ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException({ code: "PAYMENT_ERROR", message: "Le service de paiement ne répond pas. Réessaie dans un instant." });
    }
    return (await res.json()) as T;
  }
}
