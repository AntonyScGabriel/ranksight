"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SUGGESTION_CATEGORY_LABEL, SUGGESTION_REPLY_MAX_LENGTH, SUGGESTION_STATUS_LABEL,
  type AdminSuggestionDto, type AdminSuggestionsDto, type SuggestionStatus,
} from "@ranksight/shared";
import { adminFetch } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

const STATUSES = Object.keys(SUGGESTION_STATUS_LABEL) as SuggestionStatus[];
const STATUS_STYLE: Record<SuggestionStatus, string> = {
  NEW: "bg-warn/15 text-warn",
  PLANNED: "bg-violet/20 text-violet-soft",
  DONE: "bg-success/15 text-success",
  DECLINED: "bg-danger/15 text-danger",
};
const PAGE = 30;

/** Suggestions des joueurs : classement (retenue, réalisée, non retenue) et réponse visible par l'auteur. */
export default function SuggestionsPage() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<SuggestionStatus>("NEW");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<AdminSuggestionsDto | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: SuggestionStatus; reply: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<AdminSuggestionsDto>(`/suggestions?status=${tab}&limit=${PAGE}&offset=${offset}`).then(setData, (e: Error) =>
      setMessage({ text: e.message, ok: false }),
    );
  }, [tab, offset]);
  useEffect(load, [load]);

  const draft = (s: AdminSuggestionDto) => drafts[s.id] ?? { status: s.status === "NEW" ? "PLANNED" : s.status, reply: s.reply ?? "" };
  const setDraft = (s: AdminSuggestionDto, patch: Partial<{ status: SuggestionStatus; reply: string }>) =>
    setDrafts((d) => ({ ...d, [s.id]: { ...draft(s), ...patch } }));

  const save = async (s: AdminSuggestionDto) => {
    const d = draft(s);
    setBusy(s.id);
    setMessage(null);
    try {
      await adminFetch(`/suggestions/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: d.status, reply: d.reply.trim() || null }) });
      setMessage({ text: `Suggestion de ${s.author.displayName} : « ${SUGGESTION_STATUS_LABEL[d.status]} »${d.reply.trim() ? ", réponse envoyée" : ""}.`, ok: true });
      setDrafts(({ [s.id]: _done, ...rest }) => rest);
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: AdminSuggestionDto) => {
    const ok = await confirm({
      title: "Supprimer cette suggestion ?",
      message: "À réserver aux messages hors sujet, abusifs ou en double : l'auteur ne la verra plus.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok === false) return;
    setBusy(s.id);
    try {
      await adminFetch(`/suggestions/${s.id}`, { method: "DELETE" });
      setMessage({ text: "Suggestion supprimée.", ok: true });
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Suggestions des joueurs</h1>
          <p className="text-sm text-muted">Le statut et la réponse sont visibles par l&apos;auteur (page Suggestions du site et de l&apos;application).</p>
        </div>
        <div className="inline-flex flex-wrap rounded-xl border border-line bg-surface p-1" role="tablist">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={tab === s}
              onClick={() => {
                setTab(s);
                setOffset(0);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm ${tab === s ? "bg-violet text-white" : "text-muted hover:text-ink"}`}
            >
              {SUGGESTION_STATUS_LABEL[s]}
              {data ? ` (${data.counts[s]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {message && <p role="status" className={`glass p-3 text-sm ${message.ok ? "" : "text-danger"}`}>{message.text}</p>}

      {!data ? (
        <p className="text-muted">Chargement…</p>
      ) : data.items.length === 0 ? (
        <p className="glass p-6 text-center text-muted">{tab === "NEW" ? "Aucune suggestion en attente." : "Aucune suggestion ici."}</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((s) => {
            const d = draft(s);
            const changed = d.status !== s.status || d.reply.trim() !== (s.reply ?? "");
            return (
              <li key={s.id} className="glass space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-medium">{s.author.displayName}</span>
                    {s.author.status !== "ACTIVE" && <span className="ml-2 rounded bg-danger/15 px-1.5 text-xs text-danger">compte {s.author.status.toLowerCase()}</span>}
                    <span className="text-muted"> · {SUGGESTION_CATEGORY_LABEL[s.category]} · {new Date(s.createdAt).toLocaleString("fr-FR")}</span>
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status]}`}>{SUGGESTION_STATUS_LABEL[s.status]}</span>
                </div>
                <p className="whitespace-pre-line break-words">{s.text}</p>
                {s.reply && (
                  <p className="text-xs text-muted">
                    Réponse actuelle{s.repliedBy ? ` de ${s.repliedBy}` : ""}{s.repliedAt ? ` (${new Date(s.repliedAt).toLocaleDateString("fr-FR")})` : ""}
                  </p>
                )}
                <div className="space-y-2 border-t border-line/60 pt-3">
                  <textarea
                    value={d.reply}
                    onChange={(e) => setDraft(s, { reply: e.target.value })}
                    maxLength={SUGGESTION_REPLY_MAX_LENGTH}
                    rows={2}
                    className="input text-sm"
                    placeholder="Réponse à l'auteur (facultative)"
                    aria-label="Réponse à l'auteur"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <select value={d.status} onChange={(e) => setDraft(s, { status: e.target.value as SuggestionStatus })} className="input !w-auto" aria-label="Statut">
                      {STATUSES.map((st) => <option key={st} value={st}>{SUGGESTION_STATUS_LABEL[st]}</option>)}
                    </select>
                    <button onClick={() => save(s)} disabled={busy === s.id || !changed} className="btn-primary !py-1.5">
                      Enregistrer
                    </button>
                    <span className="text-xs text-muted">{d.reply.length}/{SUGGESTION_REPLY_MAX_LENGTH}</span>
                    <button onClick={() => remove(s)} disabled={busy === s.id} className="ml-auto text-xs text-muted hover:text-danger">
                      Supprimer
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.total > PAGE && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn-ghost !py-1" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Précédentes</button>
          <span className="text-muted">{offset + 1}–{Math.min(offset + PAGE, data.total)} sur {data.total}</span>
          <button className="btn-ghost !py-1" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Suivantes</button>
        </div>
      )}
    </div>
  );
}
