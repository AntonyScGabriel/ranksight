"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action irréversible : bouton rouge */
  danger?: boolean;
  /** Texte à retaper pour activer le bouton (ex. le pseudo avant de supprimer son compte) */
  requireText?: string;
  /** Champ « Motif » facultatif (inscrit au journal d'audit) : la confirmation renvoie alors le motif saisi */
  withReason?: boolean;
}

type Resolver = (value: string | false) => void;

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<string | false>>(async () => false);

/**
 * Fenêtre de confirmation intégrée à l'administration (remplace la fenêtre « confirm » du navigateur).
 * `await confirm({...})` renvoie false si le joueur annule, sinon le texte saisi (ou "" sans saisie demandée) ;
 * avec `withReason`, le motif saisi.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const resolver = useRef<Resolver | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setText("");
    setReason("");
    setOptions(o);
    return new Promise<string | false>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((value: string | false) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    (options.requireText ? input.current : confirmButton.current)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [options, close]);

  const blocked = !!options?.requireText && text.trim().toLowerCase() !== options.requireText.toLowerCase();

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="glass animate-rise w-full max-w-md space-y-4 p-6 shadow-2xl">
            <h2 id="confirm-title" className="font-display text-xl font-bold">{options.title}</h2>
            {options.message && <div className="text-sm text-muted">{options.message}</div>}
            {options.requireText && (
              <label className="block space-y-1.5 text-sm">
                <span>Tape <strong className="text-ink">{options.requireText}</strong> pour confirmer</span>
                <input ref={input} value={text} onChange={(e) => setText(e.target.value)} className="input" autoComplete="off" />
              </label>
            )}
            {options.withReason && (
              <label className="block space-y-1.5 text-sm">
                <span>Motif <span className="text-muted">(facultatif, inscrit au journal d&apos;audit)</span></span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="input" aria-label="Motif" />
              </label>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => close(false)} className="btn-ghost">{options.cancelLabel ?? "Annuler"}</button>
              <button
                ref={confirmButton}
                disabled={blocked}
                onClick={() => close(options.withReason ? reason.trim() : text)}
                className={
                  options.danger
                    ? "inline-flex items-center rounded-xl bg-danger px-5 py-2.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                    : "btn-primary !py-2.5"
                }
              >
                {options.confirmLabel ?? "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
