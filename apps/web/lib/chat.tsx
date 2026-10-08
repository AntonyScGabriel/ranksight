"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { CHAT_EVENTS, GLOBAL_CHAT_EVENTS, VERSUS_EVENT, type ChatMessageDto, type GlobalMessageDto, type VersusMatchDto } from "@ranksight/shared";
import { api, WS_URL } from "./api";
import { useSession } from "./session";

type Listener<T> = (payload: T) => void;

interface ChatValue {
  unread: number;
  refreshUnread: () => void;
  onMessage: (fn: Listener<ChatMessageDto>) => () => void;
  onTyping: (fn: Listener<{ from: string }>) => () => void;
  sendTyping: (to: string) => void;
  /** Chat global : rejoint le salon tant que l'écran est ouvert ; renvoie la fonction pour le quitter */
  joinGlobal: (handlers: {
    onMessage: Listener<GlobalMessageDto>;
    onDeleted: Listener<{ id: string }>;
    /** Mode lent changé par la modération */
    onSettings?: Listener<{ slowModeSec: number }>;
  }) => () => void;
  /** Un duel du joueur a changé (invitation, adversaire qui a joué, fin) */
  onVersus: (fn: Listener<{ id: string }>) => () => void;
  /** Invitations de duel en attente de réponse (badge de navigation) */
  versusPending: number;
}

type GlobalHandlers = Parameters<ChatValue["joinGlobal"]>[0];

const noop = () => () => {};
const ChatContext = createContext<ChatValue>({
  unread: 0, refreshUnread: () => {}, onMessage: noop, onTyping: noop, sendTyping: () => {}, joinGlobal: noop, onVersus: noop, versusPending: 0,
});

/**
 * Connexion temps réel unique pour tout le site (namespace /ws/chat) :
 * - messagerie privée : compteur de non-lus et notification discrète hors de la page Amis ;
 * - chat global : le salon n'est rejoint que lorsque l'écran du chat est ouvert.
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<ChatMessageDto | null>(null);
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const socketRef = useRef<Socket | null>(null);
  const messageListeners = useRef(new Set<Listener<ChatMessageDto>>());
  const typingListeners = useRef(new Set<Listener<{ from: string }>>());
  const globalHandlers = useRef(new Set<GlobalHandlers>());
  const versusListeners = useRef(new Set<Listener<{ id: string }>>());
  const [versusPending, setVersusPending] = useState(0);
  // Invitation à un duel en direct : bandeau « Rejoindre » sur toutes les pages (l'ami attend)
  const [invite, setInvite] = useState<VersusMatchDto | null>(null);
  const seenInvites = useRef(new Set<string>());
  const refreshVersus = useCallback(() => {
    api.versusList().then((r) => {
      const pending = r.matches.filter((m) => m.canAccept);
      setVersusPending(pending.length);
      const fresh = pending.find((m) => !seenInvites.current.has(m.id));
      pending.forEach((m) => seenInvites.current.add(m.id));
      setInvite((current) => {
        if (fresh && !pathRef.current.startsWith(`/versus/${fresh.id}`)) return fresh;
        // L'invitation affichée n'est plus valable (annulée, expirée, acceptée ailleurs)
        return current && pending.some((m) => m.id === current.id) ? current : null;
      });
    }, () => undefined);
  }, []);

  const refreshUnread = useCallback(() => {
    api.unread().then((r) => setUnread(r.unread), () => undefined);
  }, []);

  useEffect(() => {
    if (!me) return;
    refreshUnread();
    refreshVersus();
    const s = io(`${WS_URL}/ws/chat`, { transports: ["websocket"], withCredentials: true });
    s.on(CHAT_EVENTS.message, (m: ChatMessageDto) => {
      messageListeners.current.forEach((fn) => fn(m));
      if (m.senderId === me.id) return;
      refreshUnread();
      if (!pathRef.current.startsWith("/friends")) {
        setToast(m);
        window.setTimeout(() => setToast((t) => (t?.id === m.id ? null : t)), 5000);
      }
    });
    s.on(CHAT_EVENTS.typing, (p: { from: string }) => typingListeners.current.forEach((fn) => fn(p)));
    s.on(CHAT_EVENTS.read, refreshUnread);
    s.on(VERSUS_EVENT, (e: { id: string }) => {
      versusListeners.current.forEach((fn) => fn(e));
      refreshVersus();
    });
    s.on(GLOBAL_CHAT_EVENTS.message, (m: GlobalMessageDto) => globalHandlers.current.forEach((h) => h.onMessage(m)));
    s.on(GLOBAL_CHAT_EVENTS.deleted, (p: { id: string }) => globalHandlers.current.forEach((h) => h.onDeleted(p)));
    s.on(GLOBAL_CHAT_EVENTS.settings, (p: { slowModeSec: number }) => globalHandlers.current.forEach((h) => h.onSettings?.(p)));
    // (Re)connexion : on rejoint le salon global si l'écran du chat est ouvert
    s.on("connect", () => {
      if (globalHandlers.current.size) s.emit(GLOBAL_CHAT_EVENTS.join);
    });
    socketRef.current = s;
    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [me, refreshUnread, refreshVersus]);

  const onMessage = useCallback((fn: Listener<ChatMessageDto>) => {
    messageListeners.current.add(fn);
    return () => {
      messageListeners.current.delete(fn);
    };
  }, []);

  const onTyping = useCallback((fn: Listener<{ from: string }>) => {
    typingListeners.current.add(fn);
    return () => {
      typingListeners.current.delete(fn);
    };
  }, []);

  const sendTyping = useCallback((to: string) => {
    socketRef.current?.emit(CHAT_EVENTS.typing, { to });
  }, []);

  const onVersus = useCallback((fn: Listener<{ id: string }>) => {
    versusListeners.current.add(fn);
    return () => {
      versusListeners.current.delete(fn);
    };
  }, []);

  const joinGlobal = useCallback((handlers: GlobalHandlers) => {
    globalHandlers.current.add(handlers);
    if (socketRef.current?.connected) socketRef.current.emit(GLOBAL_CHAT_EVENTS.join);
    return () => {
      globalHandlers.current.delete(handlers);
      if (!globalHandlers.current.size) socketRef.current?.emit(GLOBAL_CHAT_EVENTS.leave);
    };
  }, []);

  return (
    <ChatContext.Provider value={{ unread: me ? unread : 0, refreshUnread, onMessage, onTyping, sendTyping, joinGlobal, onVersus, versusPending: me ? versusPending : 0 }}>
      {children}
      {invite && (
        <div role="alert" className="glass animate-rise fixed bottom-20 left-4 right-4 z-50 flex items-center gap-3 p-4 shadow-2xl sm:left-auto sm:max-w-sm md:bottom-6">
          <div className="min-w-0 flex-1">
            <p className="hud-label text-neon">Duel en direct</p>
            <p className="mt-1 text-sm"><strong>{invite.opponent?.displayName}</strong> te défie{invite.game ? ` sur ${invite.game.name}` : ""} et t&apos;attend.</p>
          </div>
          <Link href={`/versus/${invite.id}`} onClick={() => setInvite(null)} className="btn-primary !px-4 !py-2 text-sm">Rejoindre</Link>
          <button onClick={() => setInvite(null)} aria-label="Fermer" className="text-muted hover:text-ink">✕</button>
        </div>
      )}
      {toast && (
        <Link
          href={`/friends?chat=${toast.senderId}`}
          onClick={() => setToast(null)}
          className="glass animate-rise fixed bottom-20 right-4 z-50 max-w-xs p-4 shadow-2xl md:bottom-6"
        >
          <p className="hud-label text-violet-soft">Nouveau message</p>
          <p className="mt-1 line-clamp-2 text-sm">{toast.body}</p>
        </Link>
      )}
    </ChatContext.Provider>
  );
}

export const useChat = () => useContext(ChatContext);
