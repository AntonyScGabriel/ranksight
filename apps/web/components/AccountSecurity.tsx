"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { AccountCredentials } from "./AccountCredentials";
import { AccountDevices } from "./AccountDevices";
import { errorMessage } from "./AuthForm";
import { Avatar } from "./Header";
import { PlayerLink } from "./PlayerLink";

type Blocked = Awaited<ReturnType<typeof api.blocks>>[number];

/** Profil : adresse email, sessions ouvertes et joueurs bloqués. */
export function AccountSecurity({ me }: { me: Me }) {
  const confirm = useConfirm();
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    api.blocks().then(setBlocked, () => setBlocked([]));
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setNotice(null);
    try {
      await action();
      setNotice({ text: success, ok: true });
    } catch (e) {
      setNotice({ text: errorMessage(e), ok: false });
    }
  };

  const logoutAll = async () => {
    const ok = await confirm({
      title: "Se déconnecter partout ?",
      message: "Toutes tes sessions seront fermées : ordinateurs, téléphones et applications, y compris celle-ci.",
      confirmLabel: "Tout déconnecter",
      danger: true,
    });
    if (ok === false) return;
    await api.logoutAll().catch(() => undefined);
    window.location.assign("/login");
  };

  return (
    <div className="glass space-y-4 p-6">
      <h2 className="font-display text-lg font-semibold">Sécurité et confidentialité</h2>
      {me.email && (
        <div className="text-sm">
          <p className="text-muted">Adresse email</p>
          <p className="flex flex-wrap items-center gap-2">
            {me.email}
            {me.emailVerified
              ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">confirmée</span>
              : (
                <button onClick={() => run(() => api.resendVerification(), "Email de confirmation envoyé.")} className="text-xs text-warn underline">
                  Non confirmée · renvoyer l&apos;email
                </button>
              )}
          </p>
        </div>
      )}
      <AccountCredentials />
      {me.chatMutedUntil && (
        <p className="rounded-lg bg-danger/10 p-3 text-xs text-danger">
          L&apos;équipe a suspendu ton accès au chat jusqu&apos;au {new Date(me.chatMutedUntil).toLocaleString("fr-FR")}.
        </p>
      )}
      <div className="space-y-2">
        <p className="text-sm text-muted">Joueurs bloqués</p>
        {blocked.length ? (
          <ul className="space-y-2">
            {blocked.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <Avatar name={b.displayName} url={b.avatarUrl} size={24} />
                <PlayerLink id={b.id} className="flex-1 truncate">{b.displayName}</PlayerLink>
                <button
                  onClick={() => run(async () => { await api.unblock(b.id); load(); }, `${b.displayName} est débloqué.`)}
                  className="text-xs text-muted hover:text-ink"
                >
                  Débloquer
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">Aucun. Tu peux bloquer un joueur depuis son profil.</p>
        )}
      </div>
      <AccountDevices />
      <button onClick={logoutAll} className="btn-ghost w-full justify-center text-sm">Se déconnecter de tous les appareils</button>
      {notice && <p role="status" className={`text-xs ${notice.ok ? "text-success" : "text-danger"}`}>{notice.text}</p>}
    </div>
  );
}
