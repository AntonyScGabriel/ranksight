import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

/** Contexte de la requête en cours (adresse IP), lu par le journal d'audit sans devoir la transmettre partout. */
const storage = new AsyncLocalStorage<{ ip?: string }>();

export function requestContext(req: Request, _res: Response, next: NextFunction) {
  storage.run({ ip: req.ip }, next);
}

export const currentIp = () => storage.getStore()?.ip;
