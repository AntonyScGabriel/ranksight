"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SUGGESTION_CATEGORY_LABEL, SUGGESTION_MAX_LENGTH, SUGGESTION_STATUS_LABEL, SUGGESTIONS_PER_DAY, SuggestionInput, firstIssue,
  type SuggestionCategory, type SuggestionDto, type SuggestionStatus,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { errorMessage, FormError } from "@/components/AuthForm";
import { ErrorPanel, LoginRequired, Panel, Skeleton } from "@/components/States";

const STATUS_STYLE: Record<SuggestionStatus, string> = {
  NEW: "bg-surface-2 text-muted",
  PLANNED: "bg-violet/20 text-violet-soft",
  DONE: "bg-success/15 text-success",
  DECLINED: "bg-danger/15 text-danger",
};

const CATEGORIES = Object.keys(SUGGESTION_CATEGORY_LABEL) as SuggestionCategory[];

/** Boîte à idées : le joueur propose des améliorations et suit leur traitement par l'équipe. */
export default function SuggestionsPage() {
  const { me, loading } = useSession();
  const [list, setList] = useState<SuggestionDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState<SuggestionCategory>("FEATURE");
  const [text, setText] = useState("");
  const [state, setState] = useState<{ pending?: boolean; error?: string | null; done?: boolean }>({});
  const confirm = useConfirm();

  const load = useCallback(() => {
    api.mySuggestions().then(
      (l) => {
        setList(l);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = SuggestionInput.safeParse({ category, text });
    if (!parsed.success) return setState({ error: firstIssue(parsed.error) });
    setState({ pending: true });
    try {
      await api.suggest(parsed.data);
      setText("");
      setState({ done: true });
      load();
    } catch (err) {
      setState({ error: errorMessage(err, "La suggestion n'a pas pu être envoyée, réessaie dans un instant.") });
    }
  };

  const withdraw = async (s: SuggestionDto) => {
    const ok = await confirm({ title: "Retirer cette suggestion ?", message: "Elle sera supprimée définitivement.", confirmLabel: "Retirer", danger: true });
    if (ok === false) return;
    try {
      await api.withdrawSuggestion(s.id);
    } catch (err) {
      setState({ error: errorMessage(err, "Impossible de retirer la suggestion.") });
    }
    load();
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/suggestions" text="Connecte-toi pour proposer une idée à l'équipe." />;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Suggestions</h1>
        <p className="text-muted">
          Une idée pour améliorer RankGuess ? Un mode de jeu, un jeu à ajouter, un détail à corriger : l&apos;équipe lit chaque suggestion et te
          répond ici.
        </p>
      </header>

      <form onSubmit={submit} className="glass space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Catégorie</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as SuggestionCategory)} className="input">
            {CATEGORIES.map((c) => <option key={c} value={c}>{SUGGESTION_CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Ton idée</span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (state.done || state.error) setState({});
            }}
            maxLength={SUGGESTION_MAX_LENGTH}
            rows={5}
            className="input"
            placeholder="Ex. Ajouter un mode chronométré où chaque clip ne dure que 10 secondes."
          />
          <span className="block text-right text-xs text-muted">{text.length}/{SUGGESTION_MAX_LENGTH}</span>
        </label>
        <FormError message={state.error ?? null} />
        {state.done && <p role="status" className="text-sm text-success">Merci ! Ta suggestion a été transmise à l&apos;équipe.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">{SUGGESTIONS_PER_DAY} suggestions maximum par 24 heures. Pour un problème de compte, utilise plutôt la page Contact.</p>
          <button type="submit" disabled={state.pending || text.trim().length < 10} className="btn-primary">
            {state.pending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <h2 className="font-display text-xl font-semibold">Mes suggestions</h2>
        {failed ? (
          <ErrorPanel retry={load} />
        ) : !list ? (
          <Skeleton />
        ) : list.length === 0 ? (
          <Panel title="Aucune suggestion pour l'instant" text="Tes idées et les réponses de l'équipe apparaîtront ici." />
        ) : (
          <ul className="space-y-3">
            {list.map((s) => (
              <li key={s.id} className="glass space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {SUGGESTION_CATEGORY_LABEL[s.category]} · envoyée le {new Date(s.createdAt).toLocaleDateString("fr-FR")}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status]}`}>{SUGGESTION_STATUS_LABEL[s.status]}</span>
                </div>
                <p className="whitespace-pre-line break-words">{s.text}</p>
                {s.reply && (
                  <p className="rounded-lg border border-violet/30 bg-violet/10 p-3 text-sm">
                    <span className="font-semibold">Réponse de l&apos;équipe : </span>
                    <span className="whitespace-pre-line">{s.reply}</span>
                  </p>
                )}
                {s.status === "NEW" && !s.reply && (
                  <button onClick={() => withdraw(s)} className="text-xs text-muted hover:text-danger">Retirer cette suggestion</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
