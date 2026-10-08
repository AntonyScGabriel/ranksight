"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConversationDto, FriendRequestsDto, UserSearchResultDto, UserSummaryDto } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { FlairBadge, TitleText } from "@/components/Flair";
import { ChatPanel } from "@/components/ChatPanel";
import { PlayerLink } from "@/components/PlayerLink";
import { LoginRequired, Skeleton } from "@/components/States";

export default function FriendsPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Friends />
    </Suspense>
  );
}

function Friends() {
  const { me, loading } = useSession();
  const confirm = useConfirm();
  const { onMessage, refreshUnread } = useChat();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("chat");

  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [requests, setRequests] = useState<FriendRequestsDto>({ received: [], sent: [] });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResultDto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([api.conversations(), api.friendRequests()]);
    setConversations(c);
    setRequests(r);
  }, []);

  useEffect(() => {
    if (!me) return;
    Promise.all([api.conversations(), api.friendRequests()]).then(
      ([c, r]) => {
        setConversations(c);
        setRequests(r);
      },
      () => setNotice("Impossible de charger tes amis pour le moment."),
    );
  }, [me]);

  // Nouveau message : on remonte la conversation et on met à jour les compteurs
  useEffect(() => onMessage(() => void load().catch(() => undefined)), [onMessage, load]);

  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const t = window.setTimeout(() => api.searchUsers(query).then(setResults).catch(() => setResults([])), 250);
    return () => window.clearTimeout(t);
  }, [query, searching]);
  const visibleResults = searching ? results : [];

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setNotice(null);
    try {
      await fn();
      if (message) setNotice(message);
      await load();
      if (query.trim().length >= 2) setResults(await api.searchUsers(query));
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Action impossible pour le moment.");
    }
  };

  const open = (id: string | null) => router.replace(id ? `/friends?chat=${id}` : "/friends", { scroll: false });
  const friendOpen = conversations.find((c) => c.friend.id === openId)?.friend ?? null;

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/friends" text="Connecte-toi pour retrouver tes amis et discuter avec eux." />;

  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Amis</h1>
      {notice && <p className="glass p-3 text-sm">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <aside className={`space-y-6 ${friendOpen ? "hidden lg:block" : ""}`}>
          <div className="glass space-y-3 p-4">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un joueur" className="input" aria-label="Rechercher un joueur" />
            {visibleResults.length > 0 && (
              <ul className="space-y-1">
                {visibleResults.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2">
                    <UserLine user={u} />
                    <RelationButton user={u} act={act} />
                  </li>
                ))}
              </ul>
            )}
            {searching && visibleResults.length === 0 && <p className="text-sm text-muted">Aucun joueur trouvé.</p>}
          </div>

          {requests.received.length > 0 && (
            <div className="glass space-y-2 p-4">
              <p className="hud-label">Demandes reçues</p>
              {requests.received.map((u) => (
                <div key={u.id} className="flex items-center gap-3">
                  <UserLine user={u} />
                  <button onClick={() => act(() => api.acceptFriend(u.id), `${u.displayName} fait maintenant partie de tes amis.`)} className="rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white">Accepter</button>
                  <button onClick={() => act(() => api.declineFriend(u.id))} className="rounded-lg px-2 py-1.5 text-xs text-muted hover:text-danger">Refuser</button>
                </div>
              ))}
            </div>
          )}

          {requests.sent.length > 0 && (
            <div className="glass space-y-2 p-4">
              <p className="hud-label">Demandes envoyées</p>
              {requests.sent.map((u) => (
                <div key={u.id} className="flex items-center gap-3">
                  <UserLine user={u} />
                  <button onClick={() => act(() => api.declineFriend(u.id))} className="rounded-lg px-2 py-1.5 text-xs text-muted hover:text-danger">Annuler</button>
                </div>
              ))}
            </div>
          )}

          <div className="glass overflow-hidden">
            <p className="hud-label p-4 pb-2">Mes amis ({conversations.length})</p>
            {conversations.length === 0 && <p className="px-4 pb-4 text-sm text-muted">Recherche un joueur par son pseudo pour l&apos;ajouter.</p>}
            <ul>
              {conversations.map((c) => (
                <li key={c.friend.id}>
                  <button
                    onClick={() => open(c.friend.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 ${openId === c.friend.id ? "bg-surface-2" : ""}`}
                  >
                    <Avatar name={c.friend.displayName} url={c.friend.avatarUrl} size={40} frame={c.friend.flair.frame} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">{c.friend.displayName}<FlairBadge flair={c.friend.flair} size={12} /></span>
                      <span className="block truncate text-xs text-muted">
                        {c.lastMessage ? `${c.lastMessage.senderId === me.id ? "Toi : " : ""}${c.lastMessage.body}` : `Niveau ${c.friend.level}`}
                      </span>
                    </span>
                    {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">{c.unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className={friendOpen ? "" : "hidden lg:block"}>
          {friendOpen ? (
            <ChatPanel
              key={friendOpen.id}
              me={me.id}
              friend={friendOpen}
              onBack={() => open(null)}
              onRead={() => {
                refreshUnread();
                void load().catch(() => undefined);
              }}
              onRemove={async () => {
                const ok = await confirm({
                  title: "Retirer cet ami ?",
                  message: `${friendOpen.displayName} ne fera plus partie de tes amis et votre conversation ne sera plus accessible.`,
                  confirmLabel: "Retirer",
                  danger: true,
                });
                if (ok === false) return;
                void act(() => api.removeFriend(friendOpen.id), `${friendOpen.displayName} a été retiré de tes amis.`).then(() => open(null));
              }}
            />
          ) : (
            <div className="glass grid h-[28rem] place-items-center p-8 text-center text-muted">Choisis un ami pour discuter.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function UserLine({ user }: { user: UserSummaryDto }) {
  return (
    <>
      <PlayerLink id={user.id}><Avatar name={user.displayName} url={user.avatarUrl} size={36} frame={user.flair.frame} /></PlayerLink>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <PlayerLink id={user.id} className="truncate font-medium">{user.displayName}</PlayerLink>
          <FlairBadge flair={user.flair} size={12} />
        </span>
        {user.flair.title && <TitleText title={user.flair.title} className="block truncate" />}
        <span className="block truncate text-xs text-muted">@{user.username} · niveau {user.level}</span>
      </span>
    </>
  );
}

function RelationButton({ user, act }: { user: UserSearchResultDto; act: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  switch (user.relation) {
    case "friends":
      return <span className="text-xs text-success">Ami</span>;
    case "request_sent":
      return <span className="text-xs text-muted">Demande envoyée</span>;
    case "request_received":
      return <button onClick={() => act(() => api.acceptFriend(user.id), `${user.displayName} fait maintenant partie de tes amis.`)} className="rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white">Accepter</button>;
    default:
      return <button onClick={() => act(() => api.sendFriendRequest(user.id), `Demande envoyée à ${user.displayName}.`)} className="rounded-lg border border-violet px-3 py-1.5 text-xs font-semibold text-violet-soft hover:bg-violet hover:text-white">Ajouter</button>;
  }
}
