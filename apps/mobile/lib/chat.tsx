import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { io, type Socket } from "socket.io-client";
import {
  CHAT_EVENTS, GLOBAL_CHAT_EVENTS, ROOM_EVENT, ROOM_INVITE_EVENT, TOURNAMENT_EVENT, VERSUS_EVENT,
  type ChatMessageDto, type GlobalMessageDto, type RoomInviteDto, type VersusMatchDto,
} from "@ranksight/shared";
import { api, API_ORIGIN, tokens } from "./api";
import { useSession } from "./session";

type Listener = (m: ChatMessageDto) => void;
type GlobalHandlers = {
  onMessage: (m: GlobalMessageDto) => void;
  onDeleted: (p: { id: string }) => void;
  /** Mode lent changé par la modération */
  onSettings?: (p: { slowModeSec: number }) => void;
};

interface ChatValue {
  unread: number;
  refreshUnread: () => void;
  onMessage: (fn: Listener) => () => void;
  /** Chat global : rejoint le salon tant que l'écran est ouvert ; renvoie la fonction pour le quitter */
  joinGlobal: (handlers: GlobalHandlers) => () => void;
  socket: Socket | null;
  /** Duels : un duel du joueur a changé (invitation, adversaire qui a joué, résultat) */
  onVersus: (fn: (e: { id: string }) => void) => () => void;
  /** Invitations de duel en attente de réponse (badge de l'onglet Duels) */
  versusPending: number;
  /** Dernière invitation reçue à un duel en direct (bandeau « Rejoindre ») */
  invite: VersusMatchDto | null;
  dismissInvite: () => void;
  /** Salons privés : un salon du joueur a changé (arrivée, départ, manche, fin) ou une invitation est arrivée */
  onRoom: (fn: (e: { id: string }) => void) => () => void;
  /** Invitations dans un salon privé (badge de l'onglet Duels) */
  roomInvites: number;
  /** Dernière invitation reçue dans un salon privé (bandeau « Voir ») */
  roomInvite: RoomInviteDto | null;
  dismissRoomInvite: () => void;
  /** Tournois : un tournoi du joueur a changé (inscription, match prêt, résultat) */
  onTournament: (fn: (e: { id: string }) => void) => () => void;
  /** Connexion temps réel (re)établie, après une coupure réseau par exemple : l'écran relit son état sur le serveur */
  onConnect: (fn: () => void) => () => void;
}

const ChatContext = createContext<ChatValue>({
  unread: 0, refreshUnread: () => {}, onMessage: () => () => {}, joinGlobal: () => () => {}, socket: null, onVersus: () => () => {}, versusPending: 0, invite: null, dismissInvite: () => {},
  onRoom: () => () => {}, roomInvites: 0, roomInvite: null, dismissRoomInvite: () => {}, onTournament: () => () => {}, onConnect: () => () => {},
});

/**
 * Connexion temps réel unique (namespace /ws/chat) tant que l'application est ouverte et le joueur connecté :
 * messagerie privée (non-lus) et chat global (salon rejoint seulement quand l'écran Chat est affiché).
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const [unread, setUnread] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const listeners = useRef(new Set<Listener>());
  const globalHandlers = useRef(new Set<GlobalHandlers>());
  const socketRef = useRef<Socket | null>(null);
  const versusListeners = useRef(new Set<(e: { id: string }) => void>());
  const [versusPending, setVersusPending] = useState(0);
  const [invite, setInvite] = useState<VersusMatchDto | null>(null);
  const seenInvites = useRef(new Set<string>());

  const roomListeners = useRef(new Set<(e: { id: string }) => void>());
  const connectListeners = useRef(new Set<() => void>());
  const tournamentListeners = useRef(new Set<(e: { id: string }) => void>());
  const [roomInvites, setRoomInvites] = useState(0);
  const [roomInvite, setRoomInvite] = useState<RoomInviteDto | null>(null);
  const seenRoomInvites = useRef(new Set<string>());
  const refreshRooms = useCallback(() => {
    api.rooms().then((r) => {
      setRoomInvites(r.invites.length);
      const fresh = r.invites.find((i) => !seenRoomInvites.current.has(i.roomId));
      r.invites.forEach((i) => seenRoomInvites.current.add(i.roomId));
      setRoomInvite((current) => fresh ?? (current && r.invites.some((i) => i.roomId === current.roomId) ? current : null));
    }, () => undefined);
  }, []);

  const refreshUnread = useCallback(() => {
    api.unread().then((r) => setUnread(r.unread)).catch(() => undefined);
  }, []);
  const refreshVersus = useCallback(() => {
    api.versusList().then((r) => {
      const pending = r.matches.filter((m) => m.canAccept);
      setVersusPending(pending.length);
      const fresh = pending.find((m) => !seenInvites.current.has(m.id));
      pending.forEach((m) => seenInvites.current.add(m.id));
      // Nouvelle invitation : bandeau ; une invitation qui n'est plus valable disparaît
      setInvite((current) => fresh ?? (current && pending.some((m) => m.id === current.id) ? current : null));
    }, () => undefined);
  }, []);

  useEffect(() => {
    if (!me) return;
    refreshUnread();
    refreshVersus();
    refreshRooms();
    // Le jeton est relu à chaque (re)connexion : il peut avoir été renouvelé entre-temps
    const s = io(`${API_ORIGIN}/ws/chat`, {
      transports: ["websocket"],
      auth: (cb) => {
        void tokens.access().then((token) => cb({ token }));
      },
    });
    s.on(CHAT_EVENTS.message, (m: ChatMessageDto) => {
      listeners.current.forEach((fn) => fn(m));
      if (m.senderId !== me.id) refreshUnread();
    });
    s.on(CHAT_EVENTS.read, refreshUnread);
    s.on(VERSUS_EVENT, (e: { id: string }) => {
      versusListeners.current.forEach((fn) => fn(e));
      refreshVersus();
    });
    s.on(ROOM_EVENT, (e: { id: string }) => roomListeners.current.forEach((fn) => fn(e)));
    s.on(TOURNAMENT_EVENT, (e: { id: string }) => tournamentListeners.current.forEach((fn) => fn(e)));
    s.on(ROOM_INVITE_EVENT, (e: { id: string }) => {
      roomListeners.current.forEach((fn) => fn(e));
      refreshRooms();
    });
    s.on(GLOBAL_CHAT_EVENTS.message, (m: GlobalMessageDto) => globalHandlers.current.forEach((h) => h.onMessage(m)));
    s.on(GLOBAL_CHAT_EVENTS.deleted, (p: { id: string }) => globalHandlers.current.forEach((h) => h.onDeleted(p)));
    s.on(GLOBAL_CHAT_EVENTS.settings, (p: { slowModeSec: number }) => globalHandlers.current.forEach((h) => h.onSettings?.(p)));
    s.on("connect", () => {
      if (globalHandlers.current.size) s.emit(GLOBAL_CHAT_EVENTS.join);
      connectListeners.current.forEach((fn) => fn());
    });
    socketRef.current = s;
    setSocket(s);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      refreshUnread();
      refreshVersus();
      refreshRooms();
    });
    return () => {
      sub.remove();
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [me, refreshUnread, refreshVersus, refreshRooms]);

  const onMessage = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
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

  const onVersus = useCallback((fn: (e: { id: string }) => void) => {
    versusListeners.current.add(fn);
    return () => {
      versusListeners.current.delete(fn);
    };
  }, []);

  const onConnect = useCallback((fn: () => void) => {
    connectListeners.current.add(fn);
    return () => {
      connectListeners.current.delete(fn);
    };
  }, []);

  const onRoom = useCallback((fn: (e: { id: string }) => void) => {
    roomListeners.current.add(fn);
    return () => {
      roomListeners.current.delete(fn);
    };
  }, []);

  const onTournament = useCallback((fn: (e: { id: string }) => void) => {
    tournamentListeners.current.add(fn);
    return () => {
      tournamentListeners.current.delete(fn);
    };
  }, []);

  return (
    <ChatContext.Provider
      value={{ unread: me ? unread : 0, refreshUnread, onMessage, joinGlobal, socket, onVersus, versusPending: me ? versusPending : 0,
        invite: me ? invite : null, dismissInvite: () => setInvite(null),
        onRoom, roomInvites: me ? roomInvites : 0, roomInvite: me ? roomInvite : null, dismissRoomInvite: () => setRoomInvite(null),
        onTournament, onConnect,
      }}
    >{children}</ChatContext.Provider>
  );
}

export const useChat = () => useContext(ChatContext);
