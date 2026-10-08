"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GLOBAL_MESSAGE_MAX, ROLE_TAG, isStaffRole, type GlobalMessageDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { VipBadge } from "@/components/VipBadge";
import { PlayerLink } from "@/components/PlayerLink";
import { ReportButton } from "@/components/ReportButton";
import { errorMessage } from "@/components/AuthForm";
import { FlairBadge, TitleText } from "@/components/Flair";
import { ModMenu, SlowModeControl, StaffGuardProvider, slowModeLabel } from "@/components/ChatModeration";
import { LoginRequired, Skeleton } from "@/components/States";

const PAGE = 50;

function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Chat global : salon public commun à tous les joueurs connectés (distinct des messages privés entre amis). */
export default function GlobalChatPage() {
  const { me, loading } = useSession();
  const { joinGlobal } = useChat();
  const [messages, setMessages] = useState<GlobalMessageDto[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [slowModeSec, setSlowModeSec] = useState(0);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const isModerator = isStaffRole(me?.role);

  // Joueurs bloqués : leurs nouveaux messages en direct sont ignorés (l'historique est déjà filtré par le serveur)
  const blocked = useRef(new Set<string>());
  useEffect(() => {
    if (!me) return;
    api.blocks().then((b) => { blocked.current = new Set(b.map((x) => x.id)); }, () => undefined);
    api.chatSettings().then((s) => setSlowModeSec(s.slowModeSec), () => undefined);
    api
      .globalMessages()
      .then((m) => {
        setMessages(m);
        setHasMore(m.length === PAGE);
      })
      .catch(() => setError("Impossible de charger le chat pour le moment."));

    return joinGlobal({
      onMessage: (m) => {
        if (blocked.current.has(m.author.id)) return;
        setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [...(list ?? []), m]));
        if (!stickToBottom.current) setUnseen((n) => n + 1);
      },
      onDeleted: ({ id }) => setMessages((list) => list?.filter((x) => x.id !== id) ?? list),
      onSettings: (s) => setSlowModeSec(s.slowModeSec),
    });
  }, [me, joinGlobal]);

  // Défilement automatique vers les nouveaux messages, sauf si le joueur remonte l'historique
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  }, []);

  const loadOlder = async () => {
    const first = messages?.[0];
    if (!first) return;
    const older = await api.globalMessages(first.createdAt).catch(() => []);
    stickToBottom.current = false;
    setMessages((list) => [...older, ...(list ?? [])]);
    setHasMore(older.length === PAGE);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    stickToBottom.current = true;
    try {
      const m = await api.sendGlobal(body);
      setDraft("");
      setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [...(list ?? []), m]));
    } catch (err) {
      setError(errorMessage(err, "Message non envoyé, réessaie."));
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteGlobal(id);
      setMessages((list) => list?.filter((x) => x.id !== id) ?? list);
    } catch (err) {
      setError(errorMessage(err, "Suppression impossible."));
    }
  };

  if (loading) return <Skeleton className="h-[36rem]" />;
  if (!me) return <LoginRequired next="/chat" text="Connecte-toi pour discuter avec les autres joueurs." />;

  return (
    <StaffGuardProvider>
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Chat global</h1>
          <p className="text-sm text-muted">Le salon de tous les joueurs. Reste courtois : les messages abusifs sont supprimés.</p>
        </div>
        {isModerator && <SlowModeControl value={slowModeSec} onChange={setSlowModeSec} onError={(text) => setNotice({ text, ok: false })} />}
      </header>
      {slowModeSec > 0 && (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
          Mode lent activé : un message toutes les {slowModeLabel(slowModeSec)}{isModerator ? " (l'équipe n'est pas concernée)" : ""}.
        </p>
      )}
      {notice && (
        <p role="status" className={`rounded-xl border px-4 py-2 text-sm ${notice.ok ? "border-success/40 text-success" : "border-danger/40 text-danger"}`}>
          {notice.text}
        </p>
      )}

      <div className="glass relative flex h-[calc(100dvh-16rem)] min-h-[24rem] flex-col overflow-hidden md:h-[36rem]">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (stickToBottom.current) setUnseen(0);
          }}
          className="flex-1 space-y-3 overflow-y-auto p-4"
          aria-live="polite"
        >
          {hasMore && <button onClick={loadOlder} className="mx-auto block text-xs text-muted hover:text-ink">Messages précédents</button>}
          {messages === null && !error && <p className="pt-16 text-center text-sm text-muted">Chargement…</p>}
          {messages?.length === 0 && <p className="pt-16 text-center text-sm text-muted">Aucun message pour l&apos;instant. Lance la discussion !</p>}
          {messages?.map((m) => {
            const mine = m.author.id === me.id;
            return (
              <article key={m.id} className="group flex gap-3">
                <PlayerLink id={m.author.id}><Avatar name={m.author.displayName} url={m.author.avatarUrl} size={36} frame={m.author.flair.frame} /></PlayerLink>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <PlayerLink id={m.author.id} className={`font-semibold ${mine ? "text-neon" : ""}`}>{m.author.displayName}</PlayerLink>
                    <FlairBadge flair={m.author.flair} size={12} />
                    {m.author.flair.title && <TitleText title={m.author.flair.title} className="!text-[10px]" />}
                    {m.author.vip && <VipBadge />}
                    {isStaffRole(m.author.role) && (
                      <span className="rounded bg-violet/20 px-1.5 text-[10px] font-semibold uppercase text-violet-soft">
                        {ROLE_TAG[m.author.role]}
                      </span>
                    )}
                    <time dateTime={m.createdAt} className="text-xs text-muted">{formatTime(m.createdAt)}</time>
                    {isModerator && !mine && (
                      <ModMenu
                        message={m}
                        onDeleted={(id) => setMessages((list) => list?.filter((x) => x.id !== id) ?? list)}
                        onNotice={(text, ok) => setNotice({ text, ok })}
                      />
                    )}
                    {mine && (
                      <button
                        onClick={() => remove(m.id)}
                        className="text-xs text-muted opacity-100 hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                      >
                        Supprimer
                      </button>
                    )}
                    {!mine && (
                      <ReportButton
                        target={{ id: m.author.id, name: m.author.displayName }}
                        globalMessageId={m.id}
                        className="text-xs text-muted opacity-100 hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                      />
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                </div>
              </article>
            );
          })}
        </div>

        {unseen > 0 && (
          <button onClick={scrollToBottom} className="btn-primary absolute bottom-20 left-1/2 -translate-x-1/2 !px-4 !py-1.5 text-xs">
            {unseen} nouveau{unseen > 1 ? "x" : ""} message{unseen > 1 ? "s" : ""} ↓
          </button>
        )}

        <form onSubmit={send} className="flex gap-2 border-t border-line/60 p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={GLOBAL_MESSAGE_MAX}
            placeholder="Écris un message à tous les joueurs"
            className="input"
            aria-label="Message"
          />
          <button disabled={!draft.trim() || sending} className="btn-primary !px-4 !py-2">Envoyer</button>
        </form>
        {error && <p role="alert" className="px-4 pb-3 text-xs text-danger">{error}</p>}
      </div>
    </section>
    </StaffGuardProvider>
  );
}
