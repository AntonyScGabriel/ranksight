"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ACHIEVEMENT_CATEGORY_LABEL, COSMETIC_TYPE_LABEL, type AchievementCategory, type PublicProfileDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { errorMessage } from "@/components/AuthForm";
import { Panel, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";
import { ReportButton } from "@/components/ReportButton";
import { BadgeChip, FlairBadge, FrameSwatch, TitleText } from "@/components/Flair";

/** Profil public d'un joueur, avec les actions d'amitié et de duel. */
export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const router = useRouter();
  const confirm = useConfirm();
  const [p, setP] = useState<PublicProfileDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    api.profile(id).then(setP, () => setMissing(true));
  }, [id]);
  useEffect(load, [load, me]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ text: success, ok: true });
      load();
    } catch (e) {
      setNotice({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const challenge = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const m = await api.createVersus(p.id, "all");
      router.push(`/versus/${m.id}`);
    } catch (e) {
      setNotice({ text: errorMessage(e), ok: false });
      setBusy(false);
    }
  };

  const unfriend = async () => {
    if (!p) return;
    const ok = await confirm({
      title: "Retirer cet ami ?",
      message: `${p.displayName} ne fera plus partie de tes amis et votre conversation ne sera plus accessible.`,
      confirmLabel: "Retirer",
      danger: true,
    });
    if (ok !== false) void act(() => api.removeFriend(p.id), `${p.displayName} a été retiré de tes amis.`);
  };

  const block = async () => {
    if (!p) return;
    const ok = await confirm({
      title: `Bloquer ${p.displayName} ?`,
      message: "Vous ne serez plus amis, il ne pourra plus t'écrire, t'envoyer de demande d'ami ni te défier, et tu ne verras plus ses messages dans le chat global.",
      confirmLabel: "Bloquer",
      danger: true,
    });
    if (ok !== false) void act(() => api.block(p.id), `${p.displayName} est bloqué.`);
  };

  if (missing) return <Panel title="Joueur introuvable" text="Ce compte n'existe pas ou a été supprimé." />;
  if (!p) return <Skeleton />;

  const stats: [string, string | number][] = [
    ["Niveau", p.level],
    ["Réponses", p.stats.totalGuesses],
    ["Rangs exacts", p.stats.totalGuesses ? `${Math.round(p.stats.exactRate * 100)} %` : "—"],
    ["Record de victoires", p.stats.bestWinStreak],
    ["Meilleure série", `${p.stats.bestDailyStreak} j`],
    ["Record Infini", p.stats.infiniteBest],
  ];

  return (
    <section className="grid gap-6 md:grid-cols-[20rem_1fr]">
      <div className="glass h-fit space-y-4 p-6 text-center">
        <div className="mx-auto w-fit"><Avatar name={p.displayName} url={p.avatarUrl} size={96} frame={p.flair.frame} /></div>
        <div className="space-y-1">
          <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold">
            {p.displayName}
            <FlairBadge flair={p.flair} size={16} />
            {p.vip && <VipBadge />}
          </h1>
          {p.flair.title && <TitleText title={p.flair.title} className="block !text-xs" />}
          <p className="text-xs text-muted">Membre depuis le {new Date(p.createdAt).toLocaleDateString("fr-FR")}</p>
        </div>

        {p.relation === null && (
          <Link href={`/login?next=/players/${p.id}`} className="btn-primary w-full">Se connecter pour l&apos;ajouter</Link>
        )}
        {p.relation === "self" && <Link href="/profile" className="btn-ghost w-full justify-center">Modifier mon profil</Link>}
        {p.relation === "none" && (
          <button disabled={busy} onClick={() => act(() => api.sendFriendRequest(p.id), "Demande d'ami envoyée.")} className="btn-primary w-full">
            Ajouter en ami
          </button>
        )}
        {p.relation === "request_sent" && (
          <button disabled={busy} onClick={() => act(() => api.declineFriend(p.id), "Demande annulée.")} className="btn-ghost w-full justify-center">
            Demande envoyée · Annuler
          </button>
        )}
        {p.relation === "request_received" && (
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => act(() => api.acceptFriend(p.id), `${p.displayName} fait maintenant partie de tes amis.`)} className="btn-primary flex-1">Accepter</button>
            <button disabled={busy} onClick={() => act(() => api.declineFriend(p.id), "Demande refusée.")} className="btn-ghost">Refuser</button>
          </div>
        )}
        {p.relation === "friends" && (
          <div className="space-y-2">
            <button disabled={busy} onClick={challenge} className="btn-primary w-full">Défier en duel</button>
            <Link href={`/friends?chat=${p.id}`} className="btn-ghost w-full justify-center">Envoyer un message</Link>
            <button disabled={busy} onClick={unfriend} className="text-xs text-muted hover:text-danger">Retirer des amis</button>
          </div>
        )}
        {notice && <p role="status" className={`text-sm ${notice.ok ? "text-success" : "text-danger"}`}>{notice.text}</p>}
        {p.relation !== null && p.relation !== "self" && (
          <div className="flex justify-center gap-4 text-xs">
            <ReportButton target={{ id: p.id, name: p.displayName }} />
            {p.blockedByMe ? (
              <button disabled={busy} onClick={() => act(() => api.unblock(p.id), `${p.displayName} est débloqué.`)} className="text-muted hover:text-ink">Débloquer</button>
            ) : (
              <button disabled={busy} onClick={block} className="text-muted hover:text-danger">Bloquer</button>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 border-t border-line/60 pt-4 text-sm">
          <div><p className="font-display text-xl font-bold text-success">{p.versus.wins}</p><p className="text-xs text-muted">Victoires</p></div>
          <div><p className="font-display text-xl font-bold">{p.versus.draws}</p><p className="text-xs text-muted">Égalités</p></div>
          <div><p className="font-display text-xl font-bold text-danger">{p.versus.losses}</p><p className="text-xs text-muted">Défaites</p></div>
        </div>
        <p className="hud-label">Bilan des duels</p>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {stats.map(([k, v]) => (
            <div key={k} className="glass p-5">
              <p className="hud-label">{k}</p>
              <p className="mt-1 font-display text-3xl font-bold">{v}</p>
            </div>
          ))}
        </div>
        {p.collection.length > 0 && (
          <div className="glass space-y-3 p-6">
            <h2 className="font-display text-lg font-semibold">Titres et badges ({p.collection.length})</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {p.collection.map((c) => (
                <li key={c.id} className="flex items-start gap-3 rounded-xl border px-3 py-2" style={{ borderColor: `${c.color}55` }}>
                  <span className="mt-0.5 shrink-0">
                    {c.type === "BADGE" ? <BadgeChip badge={c} size={12} /> : c.type === "FRAME" ? <FrameSwatch frame={c} size={20} /> : <span aria-hidden className="mt-1.5 block h-2 w-2 rounded-full" style={{ background: c.color }} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium" style={{ color: c.color }}>
                      {c.name} <span className="text-[11px] font-normal text-muted">· {COSMETIC_TYPE_LABEL[c.type]}</span>
                    </span>
                    <span className="block text-xs text-muted">{c.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="glass space-y-3 p-6">
          <h2 className="font-display text-lg font-semibold">Succès obtenus ({p.achievements.length})</h2>
          {p.achievements.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {p.achievements.map((a) => (
                <li key={a.code} className="flex items-start gap-3 rounded-xl border border-line p-3">
                  <span aria-hidden className="text-xl">{a.category === "SEASON" ? "👑" : "🏆"}</span>
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted">
                      {ACHIEVEMENT_CATEGORY_LABEL[a.category as AchievementCategory] ?? a.category} · {new Date(a.unlockedAt).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Aucun succès pour l&apos;instant.</p>
          )}
        </div>
      </div>
    </section>
  );
}
