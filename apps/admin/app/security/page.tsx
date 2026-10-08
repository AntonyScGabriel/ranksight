"use client";

import { useCallback, useEffect, useState } from "react";
import { mfa, type MfaStatus } from "@/lib/api";
import { MfaSettings } from "@/components/Mfa";

/** Sécurité du compte de l'équipe : double authentification. */
export default function SecurityPage() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const load = useCallback(() => {
    mfa.status().then(setStatus, () => setStatus(null));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Sécurité du compte</h1>
      {status ? <MfaSettings status={status} onChange={() => { load(); window.dispatchEvent(new Event("mfa-changed")); }} /> : <p className="text-muted">Chargement…</p>}
    </div>
  );
}
