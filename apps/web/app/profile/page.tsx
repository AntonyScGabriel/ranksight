"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pseudo, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { VipBadge } from "@/components/VipBadge";
import { AccountSecurity } from "@/components/AccountSecurity";
import { AvatarEditor } from "@/components/AvatarEditor";
import { FlairBadge, TitleText } from "@/components/Flair";
import { errorMessage } from "@/components/AuthForm";
import { LoginRequired, Skeleton } from "@/components/States";

type GameStat = Awaited<ReturnType<typeof api.myStats>>[number];

export default function ProfilePage() {
  const { me, loading, logout, refresh } = useSession();
  const [editing, setEditing] = useState(false);
  const [pseudo, setPseudo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<GameStat[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (me) api.myStats().then(setStats).catch(() => setStats([]));
  }, [me]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/profile" text="Connecte-toi pour voir ton profil et tes statistiques." />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Pseudo.safeParse(pseudo);
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setSaving(true);
    setError(null);
    try {
      await api.updatePseudo(parsed.data);
      await refresh();
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    const typed = await confirm({
      title: "Supprimer ton compte ?",
      message: (
        <>
          Cette action est <strong className="text-ink">définitive</strong> : ton pseudo, ton email, tes amis, tes messages du chat
          global et les clips que tu as proposés seront supprimés. Ta progression ne pourra pas être récupérée.
          {me.vip.active && " Ton VIP en cours sera perdu."}
        </>
      ),
      confirmLabel: "Supprimer mon compte",
      danger: true,
      requireText: me.displayName,
    });
    if (typed === false) return;
    setDeleteError(null);
    try {
      await api.deleteAccount(typed.trim());
      window.location.assign("/");
    } catch (e) {
      setDeleteError(errorMessage(e, "Suppression impossible, réessaie."));
    }
  };

  const pct = me.progress.next ? Math.round((me.progress.current / me.progress.next) * 100) : 100;
  const overall: [string, string | number][] = [
    ["Série en cours", me.dailyStreak],
    ["Meilleure série", me.bestDailyStreak],
    ["Réponses", me.totalGuesses],
    ["Rangs exacts", me.totalGuesses ? `${Math.round((me.exactGuesses / me.totalGuesses) * 100)} %` : "—"],
    ["Série de victoires", me.winStreak],
    ["Record de victoires", me.bestWinStreak],
    ["Record Infini", me.infiniteBest],
    ["XP", me.xp.toLocaleString("fr-FR")],
  ];
  const methods = [
    ...(me.hasPassword ? ["Email et mot de passe"] : []),
    ...me.linkedProviders.map((p) => (p === "GOOGLE" ? "Google" : "Discord")),
  ];

  return (
    <section className="grid gap-6 md:grid-cols-[20rem_1fr]">
      <div className="space-y-6">
        <div className="glass space-y-4 p-6 text-center">
          <AvatarEditor name={me.displayName} url={me.avatarUrl} flair={me.flair} onChanged={refresh} />
          <div>
            <p className="hud-label">Pseudo RankGuess</p>
            {editing ? (
              <form onSubmit={save} className="mt-2 space-y-2 text-left">
                <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={20} autoFocus className={`input ${error ? "border-danger" : ""}`} />
                {error && <p className="text-xs text-danger">{error}</p>}
                <div className="flex gap-2">
                  <button disabled={saving} className="btn-primary flex-1 !py-2 text-sm">{saving ? "…" : "Enregistrer"}</button>
                  <button type="button" onClick={() => { setEditing(false); setError(null); }} className="btn-ghost">Annuler</button>
                </div>
              </form>
            ) : (
              <>
                <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold">
                  {me.displayName}
                  <FlairBadge flair={me.flair} size={16} />
                  {me.vip.active && <VipBadge />}
                </h1>
                {me.flair.title && <TitleText title={me.flair.title} className="block !text-xs" />}
                <button onClick={() => { setPseudo(me.displayName); setEditing(true); }} className="text-xs text-violet-soft hover:underline">
                  Modifier
                </button>
              </>
            )}
            <p className="mt-1 text-xs text-muted">Affiché dans les classements, le chat et la liste d&apos;amis.</p>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted">
              <span>Niveau {me.level}</span>
              <span>{pct} %</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/5">
              <div className="h-full rounded-full bg-gradient-to-r from-violet to-neon" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="space-y-1 text-left text-sm">
            {me.email && <p className="text-muted">Email : <span className="text-ink">{me.email}</span></p>}
            <p className="text-muted">Connexion : <span className="text-ink">{methods.join(", ") || "—"}</span></p>
          </div>
          <div className="space-y-2 pt-2">
            <Link href="/rewards" className="btn-ghost w-full justify-center">
              Titres, badges et cadres
              {me.newRewards > 0 && <span className="ml-2 rounded-full bg-neon px-1.5 text-[10px] font-bold text-void">{me.newRewards}</span>}
            </Link>
            <Link href="/achievements" className="btn-ghost w-full justify-center">Mes succès</Link>
            <Link href="/my-clips" className="btn-ghost w-full justify-center">Mes clips</Link>
            <Link href="/shop" className="btn-ghost w-full justify-center">
              {me.vip.active && me.vip.until ? `VIP jusqu'au ${new Date(me.vip.until).toLocaleDateString("fr-FR")}` : "Boutique VIP"}
            </Link>
            <Link href="/submit" className="btn-ghost w-full justify-center">Proposer un clip</Link>
            <button onClick={logout} className="w-full rounded-xl px-4 py-2.5 text-sm text-danger transition hover:bg-danger/10">
              Se déconnecter
            </button>
          </div>
        </div>

        <div className="glass space-y-3 p-6">
          <div>
            <h2 className="font-display text-lg font-semibold">Pseudo en jeu (clips)</h2>
            <p className="text-xs text-muted">Le pseudo du joueur filmé, indiqué à chaque clip proposé. Il ne remplace pas ton pseudo RankGuess.</p>
          </div>
          {me.inGamePseudos.length ? (
            <ul className="space-y-1.5 text-sm">
              {me.inGamePseudos.map((p) => (
                <li key={`${p.game.slug}:${p.inGamePseudo}`} className="flex justify-between gap-3">
                  <span className="text-muted">{p.game.name}</span>
                  <span className="font-medium">{p.inGamePseudo}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Aucun clip proposé pour l&apos;instant.</p>
          )}
        </div>

        <AccountSecurity me={me} />

        <div className="glass space-y-3 border-danger/30 p-6">
          <h2 className="font-display text-lg font-semibold">Supprimer mon compte</h2>
          <p className="text-xs text-muted">Suppression définitive de ton compte et de tes données personnelles.</p>
          {deleteError && <p role="alert" className="text-xs text-danger">{deleteError}</p>}
          <button onClick={deleteAccount} className="w-full rounded-xl border border-danger/50 px-4 py-2.5 text-sm text-danger transition hover:bg-danger/10">
            Supprimer mon compte
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {overall.map(([k, v]) => (
            <div key={k} className="glass p-5">
              <p className="hud-label">{k}</p>
              <p className="mt-1 font-display text-3xl font-bold">{v}</p>
            </div>
          ))}
        </div>
        {stats.length > 0 && (
          <div className="glass overflow-x-auto p-6">
            <h2 className="mb-3 font-display text-lg font-semibold">Par jeu</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr><th className="py-1 font-normal">Jeu</th><th className="font-normal">Réponses</th><th className="font-normal">Rangs exacts</th><th className="font-normal">Score moyen</th></tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.game.slug} className="border-t border-line/60">
                    <td className="py-2">{s.game.name}</td>
                    <td>{s.guesses}</td>
                    <td>{Math.round(s.accuracy * 100)} %</td>
                    <td>{Math.round(s.avgScore)} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
