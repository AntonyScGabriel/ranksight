"use client";

import { useCallback, useEffect, useState } from "react";
import { SLOW_MODE_CHOICES, isStaffRole, type ChatSettingsDto } from "@ranksight/shared";
import { API, adminFetch } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

const slowLabel = (s: number) => (s === 0 ? "Désactivé" : s >= 60 ? `${s / 60} min` : `${s} s`);

type Message = {
  id: string; body: string; createdAt: string; deletedAt: string | null;
  user: { id: string; displayName: string; username: string; role: string };
  deletedBy: { displayName: string } | null;
};

/** Modération du chat global : réglages (mots interdits, mode lent, masquage automatique), messages récents et suppression. */
export default function ChatModeration() {
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Message[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<{ items: Message[]; total: number; pageSize: number }>(`/chat/messages?page=${page}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [page]);
  useEffect(load, [load]);

  const remove = async (id: string) => {
    setError(null);
    const res = await fetch(`${API}/chat/global/${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) setError("Suppression impossible.");
    load();
  };

  /** Efface les messages d'un joueur des dernières 24 heures (spam, insultes en série) */
  const purge = async (m: Message) => {
    const ok = await confirm({
      title: `Effacer les messages de ${m.user.displayName} ?`,
      message: "Tous ses messages du chat global des dernières 24 heures sont supprimés chez tous les joueurs.",
      confirmLabel: "Effacer",
      danger: true,
    });
    if (ok === false) return;
    setError(null);
    try {
      await adminFetch(`/chat/purge/${m.user.id}`, { method: "POST", body: JSON.stringify({ hours: 24 }) });
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Chat global</h1>
      <p className="text-sm text-muted">
        Les messages supprimés disparaissent immédiatement chez tous les joueurs. Chaque suppression est inscrite au journal d&apos;audit.
        L&apos;équipe peut aussi modérer directement depuis le chat du site (menu « Modérer » sur chaque message).
      </p>
      <ChatSettingsPanel />
      {error && <p className="text-sm text-danger">{error}</p>}
      <ul className="glass divide-y divide-line/60">
        {data?.items.map((m) => (
          <li key={m.id} className={`flex items-start gap-4 p-4 ${m.deletedAt ? "opacity-50" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-semibold">{m.user.displayName}</span>{" "}
                <span className="text-xs text-muted">@{m.user.username} · {new Date(m.createdAt).toLocaleString("fr-FR")}</span>
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
              {m.deletedAt && (
                <p className="mt-1 text-xs text-muted">Supprimé le {new Date(m.deletedAt).toLocaleString("fr-FR")}{m.deletedBy ? ` par ${m.deletedBy.displayName}` : ""}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {!m.deletedAt && <button onClick={() => remove(m.id)} className="text-xs text-danger hover:underline">Supprimer</button>}
              {!isStaffRole(m.user.role) && <button onClick={() => purge(m)} className="text-xs text-muted hover:text-danger">Effacer ses messages (24 h)</button>}
            </div>
          </li>
        ))}
        {data && data.items.length === 0 && <li className="p-6 text-center text-muted">Aucun message pour le moment.</li>}
      </ul>
      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost">←</button>
          <span>{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="btn-ghost">→</button>
        </div>
      )}
    </div>
  );
}

/** Réglages du chat : mots interdits, mode lent, masquage automatique des messages signalés */
function ChatSettingsPanel() {
  const [settings, setSettings] = useState<ChatSettingsDto | null>(null);
  const [words, setWords] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    adminFetch<ChatSettingsDto>("/chat/settings").then(
      (s) => {
        setSettings(s);
        setWords(s.bannedWords.join("\n"));
      },
      (e: Error) => setMessage({ text: e.message, ok: false }),
    );
  }, []);

  if (!settings) return message ? <p className="text-sm text-danger">{message.text}</p> : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const bannedWords = words.split(/[\n,;]+/).map((w) => w.trim()).filter(Boolean);
      const next = await adminFetch<ChatSettingsDto>("/chat/settings", {
        method: "PATCH",
        body: JSON.stringify({ bannedWords, slowModeSec: settings.slowModeSec, autoHideReports: settings.autoHideReports }),
      });
      setSettings(next);
      setWords(next.bannedWords.join("\n"));
      setMessage({ text: "Réglages enregistrés : ils s'appliquent tout de suite.", ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={save} className="glass space-y-4 p-5">
      <h2 className="font-display text-lg font-semibold">Réglages du chat</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Mode lent (délai entre deux messages d&apos;un joueur)</span>
          <select value={settings.slowModeSec} onChange={(e) => setSettings({ ...settings, slowModeSec: Number(e.target.value) })} className="input">
            {SLOW_MODE_CHOICES.map((s) => <option key={s} value={s}>{slowLabel(s)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Masquer un message après N signalements de joueurs différents</span>
          <select value={settings.autoHideReports} onChange={(e) => setSettings({ ...settings, autoHideReports: Number(e.target.value) })} className="input">
            {[0, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n === 0 ? "Jamais" : `${n} signalements`}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">
          Mots interdits (un par ligne) : le message est refusé, dans le chat global comme dans les messages privés. Les majuscules, les
          accents, les lettres répétées et les chiffres à la place des lettres (« n00b ») sont pris en compte.
        </span>
        <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={5} className="input font-mono text-xs" placeholder={"insulte\nautre expression"} />
      </label>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
      <button disabled={pending} className="btn-primary !py-2">{pending ? "Enregistrement…" : "Enregistrer les réglages"}</button>
    </form>
  );
}
