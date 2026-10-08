import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  endConnection, fetchProducts, finishTransaction, getAvailablePurchases, initConnection, isUserCancelledError,
  purchaseErrorListener, purchaseUpdatedListener, requestPurchase, type Purchase,
} from "expo-iap";
import { VIP_PRODUCTS, type VipProductId, type VipStatusDto } from "@ranksight/shared";
import { api, ApiError } from "./api";

/** Achat intégré Google Play : uniquement sur Android (sur iPhone, l'écran VIP affiche le statut et les avantages). */
export const PLAY_BILLING_PLATFORM = Platform.OS === "android";

const SKUS = VIP_PRODUCTS.map((p) => p.id);
const isVipSku = (id: string): id is VipProductId => (SKUS as string[]).includes(id);

export type BillingState = "connecting" | "ready" | "unavailable";
export type BillingResult =
  | { kind: "paid"; vip: VipStatusDto }
  | { kind: "pending" }
  | { kind: "error"; message: string };

/**
 * Paiement Google Play Billing pour les pass VIP (produits ponctuels consommables : vip_1m, vip_3m, vip_12m).
 * Chaque achat est envoyé au serveur, qui le vérifie auprès de Google avant d'activer le VIP puis le consomme.
 * Au lancement, les achats restés en suspens (application fermée pendant la confirmation, paiement en espèces validé plus tard)
 * sont renvoyés au serveur : un achat n'est jamais perdu ni crédité deux fois.
 * Nécessite une version installée depuis Google Play (test interne ou production) : indisponible dans Expo Go.
 */
export function usePlayBilling(userId: string | null, onResult: (r: BillingResult) => void) {
  const [state, setState] = useState<BillingState>(PLAY_BILLING_PLATFORM && userId ? "connecting" : "unavailable");
  const [prices, setPrices] = useState<Partial<Record<VipProductId, string>>>({});
  const [busy, setBusy] = useState<VipProductId | null>(null);
  const resultRef = useRef(onResult);
  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);
  const handling = useRef(new Set<string>());

  /** Vérification par le serveur, puis fin de la transaction côté Google Play */
  const deliver = useCallback(async (purchase: Purchase, silent: boolean) => {
    const token = purchase.purchaseToken;
    if (!token || !isVipSku(purchase.productId) || handling.current.has(token)) return;
    if (purchase.purchaseState !== "purchased") {
      setBusy(null);
      if (purchase.purchaseState === "pending" && !silent) resultRef.current({ kind: "pending" });
      return;
    }
    handling.current.add(token);
    try {
      const r = await api.googlePlayPurchase(purchase.productId, token);
      if (r.status === "PAID") {
        // Le serveur a déjà consommé l'achat ; cet appel ne sert qu'en secours et peut échouer sans conséquence
        await finishTransaction({ purchase, isConsumable: true }).catch(() => undefined);
        resultRef.current({ kind: "paid", vip: r.vip });
      } else if (r.status === "PENDING") {
        if (!silent) resultRef.current({ kind: "pending" });
      } else if (!silent) {
        resultRef.current({ kind: "error", message: "Le paiement n'a pas abouti : aucun montant n'a été débité." });
      }
    } catch (e) {
      // Reprise automatique au lancement : pas de message (achat d'un autre compte sur ce téléphone, réseau coupé…)
      if (!silent) {
        resultRef.current({
          kind: "error",
          message:
            e instanceof ApiError && e.status > 0 && e.status < 500
              ? e.message
              : "Paiement reçu, mais la vérification n'a pas pu se faire. Ton VIP sera activé à la prochaine ouverture de cet écran.",
        });
      }
    } finally {
      handling.current.delete(token);
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!PLAY_BILLING_PLATFORM || !userId) return;
    let alive = true;
    const updated = purchaseUpdatedListener((p) => void deliver(p, false));
    const failed = purchaseErrorListener((err) => {
      setBusy(null);
      if (!isUserCancelledError(err)) resultRef.current({ kind: "error", message: "Le paiement Google Play n'a pas abouti. Aucun montant n'a été débité." });
    });
    (async () => {
      try {
        await initConnection();
        const products = await fetchProducts({ skus: SKUS, type: "in-app" });
        if (!alive) return;
        const found: Partial<Record<VipProductId, string>> = {};
        for (const p of products ?? []) if (isVipSku(p.id)) found[p.id] = p.displayPrice;
        setPrices(found);
        setState(Object.keys(found).length ? "ready" : "unavailable");
        // Reprise des achats payés mais pas encore livrés
        const pending = await getAvailablePurchases();
        for (const p of pending) if (alive) await deliver(p, true);
      } catch {
        if (alive) setState("unavailable");
      }
    })();
    return () => {
      alive = false;
      updated.remove();
      failed.remove();
      void endConnection().catch(() => undefined);
    };
  }, [userId, deliver]);

  const buy = useCallback(
    async (product: VipProductId) => {
      if (!userId) return;
      setBusy(product);
      try {
        // L'identifiant du compte accompagne l'achat : le serveur refuse qu'il soit crédité à un autre compte
        await requestPurchase({ request: { google: { skus: [product], obfuscatedAccountId: userId } }, type: "in-app" });
      } catch (e) {
        setBusy(null);
        if (!isUserCancelledError(e)) resultRef.current({ kind: "error", message: "Le paiement Google Play n'a pas pu démarrer, réessaie." });
      }
    },
    [userId],
  );

  return { state, prices, busy, buy };
}
