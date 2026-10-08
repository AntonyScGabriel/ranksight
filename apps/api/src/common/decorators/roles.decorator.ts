import { SetMetadata } from "@nestjs/common";
import type { Role } from "../../generated/prisma/client.js";

export const ROLES = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const PREMIUM = "premium";
/** Fonctionnalité réservée aux abonnés Premium (ou au staff). */
export const Premium = () => SetMetadata(PREMIUM, true);
