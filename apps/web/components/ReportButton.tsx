"use client";

import { useState } from "react";
import { CHAT_REPORT_REASON_LABEL, CHAT_REPORT_REASONS, type ChatReportReason } from "@ranksight/shared";
import { api } from "@/lib/api";
import { errorMessage } from "./AuthForm";

/**
 * Signaler un joueur (et, si besoin, le message concerné) à l'équipe de modération.
 * Le message signalé est copié côté serveur : il reste consultable même s'il est supprimé ensuite.
 */
export function ReportButton({
  target, globalMessageId, directMessageId, gameMessageId, label = "Signaler", className = "",
}: {
  target: { id: string; name: string };
  globalMessageId?: string;
  directMessageId?: string;
  /** Message du tchat d'un salon ou d'un tournoi */
  gameMessageId?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<{ pending?: boolean; done?: boolean; error?: string }>({});

  const close = () => {
    setOpen(false);
    setReason(null);
    setDetails("");
    setState({});
  };

  const send = async () => {
    if (!reason) return;
    setState({ pending: true });
    try {
      await api.reportPlayer({ targetUserId: target.id, reason, details: details.trim() || undefined, globalMessageId, directMessageId, gameMessageId });
      setState({ done: true });
    } catch (e) {
      setState({ error: errorMessage(e, "Le signalement n'a pas pu être envoyé.") });
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label === "Signaler" ? undefined : `Signaler ${target.name}`} className={className || "text-xs text-muted hover:text-danger"}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div role="dialog" aria-modal="true" aria-labelledby="report-title" className="glass animate-rise w-full max-w-md space-y-4 p-6 shadow-2xl">
            <h2 id="report-title" className="font-display text-xl font-bold">Signaler {target.name}</h2>
            {state.done ? (
              <>
                <p className="text-sm text-muted">Merci : l&apos;équipe de modération va examiner ton signalement. Tu peux aussi bloquer ce joueur depuis son profil.</p>
                <div className="flex justify-end"><button onClick={close} className="btn-primary">Fermer</button></div>
              </>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm text-muted">{globalMessageId || directMessageId || gameMessageId ? "Que se passe-t-il avec ce message ?" : "Que se passe-t-il ?"}</legend>
                  {CHAT_REPORT_REASONS.map((r) => (
                    <label key={r} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
                      <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="accent-violet" />
                      {CHAT_REPORT_REASON_LABEL[r]}
                    </label>
                  ))}
                </fieldset>
                <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={500} rows={3} placeholder="Précisions (facultatif)" className="input" aria-label="Précisions" />
                {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
                <div className="flex justify-end gap-3">
                  <button onClick={close} className="btn-ghost">Annuler</button>
                  <button onClick={send} disabled={!reason || state.pending} className="btn-primary">{state.pending ? "Envoi…" : "Envoyer"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
