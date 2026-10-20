"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GAME_CHAT_MAX, TEAM_COLORS, TEAM_NAMES, type GameChatMessageDto, type GameChatScope } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { errorMessage } from "./AuthForm";
import { ReportButton } from "./ReportButton";

/**
 * Tchat d'un salon (salle d'attente et partie) ou d'un tournoi. En duel par équipes, l'onglet « Équipe » n'est lu que
 * par ses coéquipiers ; `team` est l'équipe actuelle du joueur : quand elle change, le tchat est relu (canal de la
 * nouvelle équipe). Messages en direct par la connexion du chat ; relus à la reconnexion.
 * Modération (organisateur du tournoi, équipe) : supprimer un message ; tournoi : réduire un joueur au silence
 * (`mutedIds` : joueurs déjà réduits au silence, `onModerated` : relire le tournoi).
 */
export function GameChat({
  scope, id, meId, team = null, mutedIds = [], onModerated, className = "",
}: {
  scope: GameChatScope; id: string; meId: string; team?: number | null; mutedIds?: string[]; onModerated?: () => void; className?: string;
}) {
  const { onGameChat, onConnect } = useChat();
  const confirm = useConfirm();
  const [messages, setMessages] = useState<GameChatMessageDto[]>([]);
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [myTeam, setMyTeam] = useState<number | null>(null);
  const [tab, setTab] = useState<"all" | "team">("all");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.gameChat(scope, id).then((c) => {
      setMessages(c.messages);
      setOpen(c.open);
      setMuted(c.muted);
      setCanModerate(c.canModerate);
      setMyTeam(c.myTeam);
    }, () => undefined);
  }, [scope, id]);

  useEffect(() => {
    load();
    const offConnect = onConnect(load);
    const offMessage = onGameChat((e) => {
      if (e.scope !== scope || e.id !== id) return;
      if (e.deletedId) setMessages((m) => m.filter((x) => x.id !== e.deletedId));
      const message = e.message;
      if (message) setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message].slice(-200)));
    });
    return () => {
      offConnect();
      offMessage();
    };
  }, [load, onConnect, onGameChat, scope, id]);

  // Changement d'équipe dans la salle d'attente : canal de la nouvelle équipe
  useEffect(() => {
    if (team !== myTeam) load();
  }, [team, myTeam, load]);

  const shown = messages.filter((m) => (tab === "team" ? m.team !== null : m.team === null));
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [shown.length, tab]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const m = await api.sendGameChat(scope, id, body, tab === "team");
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      setText("");
    } catch (err) {
      setError(errorMessage(err, "Message non envoyé."));
    } finally {
      setSending(false);
    }
  };

  const remove = async (m: GameChatMessageDto) => {
    setError(null);
    try {
      await api.deleteGameChat(scope, id, m.id);
      setMessages((list) => list.filter((x) => x.id !== m.id));
    } catch (err) {
      setError(errorMessage(err, "Message non supprimé."));
    }
  };

  const toggleMute = async (m: GameChatMessageDto, mute: boolean) => {
    if (mute) {
      const ok = await confirm({
        title: `Réduire ${m.author.displayName} au silence ?`,
        message: "Ce joueur ne pourra plus écrire dans le tchat du tournoi. Il reste inscrit et joue ses matchs.",
        confirmLabel: "Réduire au silence",
        danger: true,
      });
      if (ok === false) return;
    }
    setError(null);
    try {
      await api.muteInTournament(id, m.author.id, mute);
      onModerated?.();
    } catch (err) {
      setError(errorMessage(err, "Action impossible."));
    }
  };

  return (
    <div className={`glass flex flex-col gap-3 p-4 ${className}`} data-testid="game-chat">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Tchat</h2>
        {myTeam && (
          <div role="tablist" className="flex gap-1 text-xs">
            {(["all", "team"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`rounded-lg px-2.5 py-1 font-semibold ${tab === t ? "bg-violet/25 text-ink" : "text-muted hover:text-ink"}`}
                style={t === "team" && tab === t ? { color: TEAM_COLORS[myTeam as 1 | 2] } : undefined}>
                {t === "all" ? "Salon" : `Équipe (${TEAM_NAMES[myTeam as 1 | 2]?.toLowerCase()})`}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={list} className="h-64 space-y-1.5 overflow-y-auto pr-1 text-sm" aria-live="polite">
        {shown.length === 0 && <p className="pt-8 text-center text-xs text-muted">{tab === "team" ? "Rien encore dans le canal de ton équipe." : "Aucun message pour l'instant. Dis bonjour !"}</p>}
        {shown.map((m) => {
          const mine = m.author.id === meId;
          const isMuted = mutedIds.includes(m.author.id);
          return (
            <div key={m.id} className="group break-words">
              <span className={`font-semibold ${mine ? "text-neon" : ""}`}>{mine ? "Toi" : m.author.displayName}</span>
              <span className="text-muted"> · {new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
              {isMuted && <span className="text-xs text-warn" title="Réduit au silence"> 🔇</span>}
              {/* Actions toujours visibles (la fenêtre de signalement ne doit pas disparaître quand la souris s'éloigne) */}
              {(
                <span className="ml-2 inline-flex gap-2 text-[11px] opacity-60 hover:opacity-100">
                  {!mine && <ReportButton target={{ id: m.author.id, name: m.author.displayName }} gameMessageId={m.id} className="text-muted hover:text-warn" />}
                  {(mine || canModerate) && <button onClick={() => remove(m)} className="text-muted hover:text-danger">Supprimer</button>}
                  {canModerate && scope === "tournament" && !mine && (
                    <button onClick={() => toggleMute(m, !isMuted)} className="text-muted hover:text-warn">{isMuted ? "Rendre la parole" : "Réduire au silence"}</button>
                  )}
                </span>
              )}
              <p>{m.body}</p>
            </div>
          );
        })}
      </div>
      {open ? (
        <form onSubmit={send} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={GAME_CHAT_MAX} placeholder={tab === "team" ? "Message à ton équipe…" : "Message…"} aria-label="Message" className="input min-w-0 flex-1 !py-2" />
          <button disabled={!text.trim() || sending} className="btn-primary !px-4 !py-2">Envoyer</button>
        </form>
      ) : (
        <p className="text-center text-xs text-muted">{muted ? "Tu as été réduit au silence dans ce tchat." : "Tchat fermé."}</p>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
