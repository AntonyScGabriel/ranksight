"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SLOW_MODE_CHOICES, isStaffRole } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { errorMessage } from "./AuthForm";

type Guard = <T>(action: () => Promise<T>) => Promise<T>;
const StaffGuardContext = createContext<Guard>((action) => action());

/**
 * Actions de l'équipe depuis le site : comme dans l'administration, la double authentification est demandée
 * (une fois par session et par 12 heures) avant une action de modération. L'action est relancée après le code.
 */
export function StaffGuardProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<((ok: boolean) => void) | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const guard = useCallback<Guard>(async (action) => {
    try {
      return await action();
    } catch (e) {
      if (e instanceof ApiError && e.code === "MFA_SETUP_REQUIRED") {
        throw new ApiError(403, e.code, "Active d'abord la double authentification dans l'administration pour modérer le chat.");
      }
      if (!(e instanceof ApiError && e.code === "MFA_REQUIRED")) throw e;
      const ok = await new Promise<boolean>((resolve) => setAsk(() => resolve));
      if (!ok) throw new ApiError(403, "CANCELLED", "Action annulée.");
      return action();
    }
  }, []);

  const close = (ok: boolean) => {
    ask?.(ok);
    setAsk(null);
    setCode("");
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.mfaVerify(code);
      close(true);
    } catch (err) {
      setError(errorMessage(err, "Code incorrect."));
      setCode("");
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffGuardContext.Provider value={guard}>
      {children}
      {ask && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="mfa-title" className="glass w-full max-w-sm space-y-4 p-6 text-center shadow-2xl">
            <h2 id="mfa-title" className="font-display text-xl font-bold">Double authentification</h2>
            <p className="text-sm text-muted">Saisis le code à 6 chiffres de ton application d&apos;authentification (ou un code de secours) pour modérer.</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              autoComplete="one-time-code"
              maxLength={9}
              placeholder="123456"
              aria-label="Code de double authentification"
              className="input text-center font-mono text-xl tracking-[0.3em]"
              autoFocus
            />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => close(false)} className="btn-ghost flex-1">Annuler</button>
              <button disabled={pending || code.length < 6} className="btn-primary flex-1">{pending ? "Vérification…" : "Valider"}</button>
            </div>
          </form>
        </div>
      )}
    </StaffGuardContext.Provider>
  );
}

export const useStaffGuard = () => useContext(StaffGuardContext);

const MUTE_CHOICES = [
  { hours: 1, label: "1 heure" },
  { hours: 24, label: "24 heures" },
  { hours: 24 * 7, label: "7 jours" },
];

export const slowModeLabel = (sec: number) => (sec >= 60 ? `${sec / 60} min` : `${sec} s`);

/**
 * Actions de modération sur un message du chat global, réservées à l'équipe :
 * supprimer le message, couper le chat du joueur, effacer ses messages des dernières 24 heures.
 */
export function ModMenu({
  message, onDeleted, onNotice,
}: {
  message: { id: string; author: { id: string; displayName: string; role: string } };
  onDeleted: (id: string) => void;
  onNotice: (text: string, ok: boolean) => void;
}) {
  const confirm = useConfirm();
  const guard = useStaffGuard();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isTeam = isStaffRole(message.author.role);
  const name = message.author.displayName;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const run = async (action: () => Promise<string>) => {
    setOpen(false);
    try {
      onNotice(await guard(action), true);
    } catch (e) {
      onNotice(errorMessage(e, "Action impossible."), false);
    }
  };

  const remove = () =>
    run(async () => {
      await api.deleteGlobal(message.id);
      onDeleted(message.id);
      return "Message supprimé.";
    });

  const mute = async (hours: number, label: string) => {
    const ok = await confirm({ title: `Couper le chat de ${name} ?`, message: `${name} ne pourra plus écrire (chat global et messages privés) pendant ${label}.`, confirmLabel: "Couper le chat", danger: true });
    if (ok === false) return;
    await run(async () => {
      await api.muteUser(message.author.id, hours);
      return `Chat de ${name} coupé pendant ${label}.`;
    });
  };

  const purge = async () => {
    const ok = await confirm({ title: `Effacer les messages de ${name} ?`, message: "Tous ses messages du chat global des dernières 24 heures seront supprimés.", confirmLabel: "Effacer", danger: true });
    if (ok === false) return;
    await run(async () => {
      const r = await api.purgeMessages(message.author.id, 24);
      return `${r.deleted} message${r.deleted > 1 ? "s" : ""} de ${name} effacé${r.deleted > 1 ? "s" : ""}.`;
    });
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="text-xs text-violet-soft opacity-100 hover:text-ink md:opacity-0 md:focus:opacity-100 md:group-hover:opacity-100"
      >
        Modérer
      </button>
      {open && (
        <div role="menu" className="glass absolute left-0 top-5 z-20 w-56 p-1 text-sm shadow-2xl">
          <MenuItem onClick={remove}>Supprimer le message</MenuItem>
          {!isTeam && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wider text-muted">Couper le chat</p>
              {MUTE_CHOICES.map((c) => <MenuItem key={c.hours} onClick={() => mute(c.hours, c.label)}>{c.label}</MenuItem>)}
              <MenuItem danger onClick={purge}>Effacer ses messages (24 h)</MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`block w-full rounded-lg px-3 py-1.5 text-left hover:bg-surface-2 ${danger ? "text-danger" : ""}`}>
      {children}
    </button>
  );
}

/** Réglage du mode lent depuis le chat (équipe) */
export function SlowModeControl({
  value, onChange, onError,
}: { value: number; onChange: (v: number) => void; onError: (message: string) => void }) {
  const guard = useStaffGuard();
  const [pending, setPending] = useState(false);
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Mode lent
      <select
        value={value}
        disabled={pending}
        onChange={async (e) => {
          setPending(true);
          const next = Number(e.target.value);
          try {
            onChange((await guard(() => api.setSlowMode(next))).slowModeSec);
          } catch (err) {
            onError(errorMessage(err, "Le mode lent n'a pas pu être modifié."));
          } finally {
            setPending(false);
          }
        }}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-ink"
      >
        {SLOW_MODE_CHOICES.map((s) => <option key={s} value={s}>{s === 0 ? "désactivé" : slowModeLabel(s)}</option>)}
      </select>
    </label>
  );
}
