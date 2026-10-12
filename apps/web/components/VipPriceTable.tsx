"use client";

import { useEffect, useState } from "react";
import { formatPrice, type ShopCatalogDto } from "@ranksight/shared";
import { api } from "@/lib/api";

const formatEnd = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Prix en vigueur des passes VIP (réglés dans l'administration), pour les conditions générales de vente */
export function VipPriceTable() {
  const [catalog, setCatalog] = useState<ShopCatalogDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.shopCatalog().then(setCatalog, () => setFailed(true));
  }, []);

  if (failed) return <p>Les prix en vigueur sont affichés dans la boutique au moment de la commande.</p>;
  if (!catalog) return <p aria-busy="true">Chargement des prix…</p>;
  const { promo } = catalog;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Pass</th>
            <th>Durée</th>
            {promo && <th>Prix promo TTC</th>}
            <th>{promo ? "Prix normal TTC (après la promo)" : "Prix TTC"}</th>
          </tr>
        </thead>
        <tbody>
          {catalog.products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.days} jours</td>
              {promo && <td>{formatPrice(p.promoPriceCents)}</td>}
              <td>{formatPrice(p.priceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {promo && (
        <p>
          Promotion en cours (« {promo.label} ») : les passes sont vendus au prix promo
          {promo.endsAt ? ` jusqu'au ${formatEnd(promo.endsAt)}` : " pendant une durée limitée annoncée sur le site"}, puis au prix
          normal.
        </p>
      )}
    </>
  );
}
