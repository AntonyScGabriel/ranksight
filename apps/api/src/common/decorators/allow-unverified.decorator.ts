import { SetMetadata } from "@nestjs/common";

export const ALLOW_UNVERIFIED = "allowUnverified";
/**
 * Route accessible avant la confirmation de l'adresse email (connexion, profil, renvoi du lien, suppression du compte…).
 * Toutes les autres routes réservées aux comptes connectés demandent une adresse confirmée.
 */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED, true);
