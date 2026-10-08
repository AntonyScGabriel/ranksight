"use client";

import { useEffect, useState } from "react";
import { formatPrice, type ShopCatalogDto } from "@ranksight/shared";
import { api } from "@/lib/api";

/** Prix en vigueur des passes VIP (réglés dans l'administration), pour les conditions générales de vente */
export function VipPriceTable() {
  const [catalog, setCatalog] = useState<ShopCatalogDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.shopCatalog().then(setCatalog, () => setFailed(true));
  }, []);

  if (failed) return <p>Les prix en vigueur sont affichés dans la boutique au moment de la commande.</p>;
  if (!catalog) return <p aria-busy="true">Chargement des prix…</p>;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Pass</th>
            <th>Durée</th>
            {catalog.launchOffer && <th>Prix de lancement TTC</th>}
            <th>{catalog.launchOffer ? "Prix normal TTC (après l'offre)" : "Prix TTC"}</th>
          </tr>
        </thead>
        <tbody>
          {catalog.products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.days} jours</td>
              {catalog.launchOffer && <td>{formatPrice(p.launchPriceCents)}</td>}
              <td>{formatPrice(p.priceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {catalog.launchOffer && (
        <p>
          Offre de lancement en cours : pendant une durée limitée suivant l&apos;ouverture de RankGuess, les passes sont vendus au
          prix de lancement, puis au prix normal. La fin de l&apos;offre est annoncée sur le site.
        </p>
      )}
    </>
  );
}
