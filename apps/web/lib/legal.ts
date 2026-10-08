/**
 * Informations légales de l'éditeur, lues dans le .env (variables LEGAL_*) au moment de la construction du site.
 * Elles sont obligatoires pour un site public (loi pour la confiance dans l'économie numérique, art. 6)
 * et pour la vente du VIP (Code de la consommation).
 */
const v = (name: string) => process.env[name]?.trim() || null;

export const LEGAL = {
  publisherName: v("LEGAL_PUBLISHER_NAME"),
  publisherStatus: v("LEGAL_PUBLISHER_STATUS"),
  address: v("LEGAL_ADDRESS"),
  email: v("LEGAL_EMAIL"),
  siret: v("LEGAL_SIRET"),
  vatNote: v("LEGAL_VAT_NOTE") ?? "TVA non applicable, article 293 B du Code général des impôts",
  director: v("LEGAL_DIRECTOR") ?? v("LEGAL_PUBLISHER_NAME"),
  hostName: v("LEGAL_HOST_NAME"),
  hostAddress: v("LEGAL_HOST_ADDRESS"),
  hostContact: v("LEGAL_HOST_CONTACT"),
  mediatorName: v("LEGAL_MEDIATOR_NAME"),
  mediatorUrl: v("LEGAL_MEDIATOR_URL"),
  siteUrl: (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
};

/** Valeur non renseignée dans le .env : affichée telle quelle pour être repérée avant la mise en ligne */
export const orMissing = (value: string | null) => value ?? "Non renseigné";
