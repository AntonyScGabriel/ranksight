"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessageDto, UserSummaryDto } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { ReportButton } from "./ReportButton";
import { Avatar } from "./Header";
import { PlayerLink } from "./PlayerLink";
import { FlairBadge } from "./Flair";

/** Conversation privée : historique paginé, envoi, réception en direct, « est en train d'écrire ». */
export function ChatPanel({
  me,
  friend,
  onBack,
  onRead,
  onRemove,
}: {
  me: string;
  friend: UserSummaryDto;
  onBack: () => void;
  onRead: () => void;
  onRemove: () => void;
}) {
  const { onMessage, onTyping, sendTyping } = useChat();
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastTypingSent = useRef(0);

  // Référence stable : le parent recrée onRead à chaque rendu
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });
  const markRead = useCallback(() => {
    api.markRead(friend.id).then(() => onReadRef.current()).catch(() => undefined);
  }, [friend.id]);

  useEffect(() => {
    api
      .messages(friend.id)
      .then((m) => {
        setMessages(m);
        setHasMore(m.length === 50);
        markRead();
      })
      .catch(() => setError("Impossible de charger la conversation."));
  }, [friend.id, markRead]);

  useEffect(
    () =>
      onMessage((m) => {
        const inThisChat = (m.senderId === friend.id && m.recipientId === me) || (m.senderId === me && m.recipientId === friend.id);
        if (!inThisChat) return;
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
        if (m.senderId === friend.id) {
          setTyping(false);
          markRead();
        }
      }),
    [onMessage, friend.id, me, markRead],
  );

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = onTyping(({ from }) => {
      if (from !== friend.id) return;
      setTyping(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTyping(false), 3000);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [onTyping, friend.id]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const loadOlder = async () => {
    const older = await api.messages(friend.id, messages[0]?.createdAt).catch(() => []);
    stickToBottom.current = false;
    setMessages((list) => [...older, ...list]);
    setHasMore(older.length === 50);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setError(null);
    stickToBottom.current = true;
    try {
      const m = await api.sendMessage(friend.id, body);
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    } catch (err) {
      setDraft(body);
      setError(err instanceof ApiError ? err.message : "Message non envoyé, réessaie.");
    }
  };

  const onDraft = (value: string) => {
    setDraft(value);
    if (Date.now() - lastTypingSent.current > 2000) {
      lastTypingSent.current = Date.now();
      sendTyping(friend.id);
    }
  };

  const lastMine = [...messages].reverse().find((m) => m.senderId === me);

  return (
    <div className="glass flex h-[32rem] flex-col overflow-hidden md:h-[36rem]">
      <header className="flex items-center gap-3 border-b border-line/60 p-4">
        <button onClick={onBack} className="text-muted lg:hidden" aria-label="Retour à la liste">←</button>
        <PlayerLink id={friend.id}><Avatar name={friend.displayName} url={friend.avatarUrl} size={36} frame={friend.flair.frame} /></PlayerLink>
        <div className="flex-1">
          <span className="flex items-center gap-1.5">
            <PlayerLink id={friend.id} className="font-medium">{friend.displayName}</PlayerLink>
            <FlairBadge flair={friend.flair} size={12} />
          </span>
          <p className="text-xs text-muted">{typing ? "est en train d'écrire…" : `@${friend.username}`}</p>
        </div>
        <button onClick={onRemove} className="text-xs text-muted hover:text-danger">Retirer des amis</button>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="flex-1 space-y-2 overflow-y-auto p-4"
      >
        {hasMore && (
          <button onClick={loadOlder} className="mx-auto block text-xs text-muted hover:text-ink">Messages précédents</button>
        )}
        {messages.length === 0 && !error && <p className="pt-16 text-center text-sm text-muted">Lance la conversation avec {friend.displayName}.</p>}
        {messages.map((m) => {
          const mine = m.senderId === me;
          return (
            <div key={m.id} className={`group flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
              <p
                title={new Date(m.createdAt).toLocaleString("fr-FR")}
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${mine ? "rounded-br-sm bg-violet text-white" : "rounded-bl-sm bg-surface-2"}`}
              >
                {m.body}
              </p>
              {!mine && (
                <ReportButton
                  target={{ id: friend.id, name: friend.displayName }}
                  directMessageId={m.id}
                  label="⚑"
                  className="text-xs text-muted opacity-100 hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                />
              )}
            </div>
          );
        })}
        {lastMine?.readAt && <p className="text-right text-[11px] text-muted">Vu</p>}
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-line/60 p-3">
        <input value={draft} onChange={(e) => onDraft(e.target.value)} maxLength={1000} placeholder="Écris un message" className="input" aria-label="Message" />
        <button disabled={!draft.trim()} className="btn-primary !px-4 !py-2">Envoyer</button>
      </form>
      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </div>
  );
}
