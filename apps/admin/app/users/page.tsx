"use client";

import { useCallback, useEffect, useState } from "react";
import { ASSIGNABLE_ROLES, ROLE_LABEL, isAdminRole, isStaffRole, type UserRole, COSMETIC_SOURCE_LABEL, COSMETIC_TYPE_LABEL, type AdminCosmeticDto, type CosmeticRefDto, type CosmeticSource } from "@ranksight/shared";
import { adminFetch, media, session, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { BadgeChip, FrameSwatch } from "@/components/Flair";

type U = {
  id: string; username: string; displayName: string; email: string | null; role: string; status: string; level: number; createdAt: string;
  avatarUrl: string | null;
  vip: { active: boolean; until: string | null };
  emailVerified: boolean;
  chatMutedUntil: string | null;
  mfaEnabled: boolean;
};

const VIP_DURATIONS = [[30, "30 jours"], [90, "90 jours"], [365, "1 an"]] as const;

export default function UsersPage() {
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<U[]>([]);
  const [ownerExists, setOwnerExists] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rewardsOf, setRewardsOf] = useState<U | null>(null);

  const load = useCallback((query: string) => {
    adminFetch<{ items: U[]; ownerExists: boolean }>(`/users?q=${encodeURIComponent(query)}`).then(
      (r) => {
        setItems(r.items);
        setOwnerExists(r.ownerExists);
      },
      (e: Error) => setMessage(e.message),
    );
  }, []);
  useEffect(() => {
    load("");
    session.me().then(setMe, () => setMe(null));
  }, [load]);

  const isAdmin = isAdminRole(me?.role);
  const isOwner = me?.role === "OWNER";

  const run = async (action: () => Promise<unknown>, success: string) => {
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    }
    load(q);
  };

  const patch = async (u: U, body: Partial<Pick<U, "role" | "status">>, label: string) => {
    const ok = await confirm({ title: `${label} ?`, message: `Compte : ${u.displayName}. L'action est inscrite au journal d'audit.`, confirmLabel: label });
    if (ok === false) return load(q);
    await run(() => adminFetch(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) }), `${u.displayName} : modification enregistrée.`);
  };

  const remove = async (u: U) => {
    const ok = await confirm({
      title: `Supprimer le compte ${u.displayName} ?`,
      message: "Suppression définitive : pseudo, email, connexions, amis, messages du chat global et clips proposés. Les réponses restent dans les statistiques des clips, de façon anonyme.",
      confirmLabel: "Supprimer le compte",
      danger: true,
      requireText: u.displayName,
    });
    if (ok === false) return;
    await run(() => adminFetch(`/users/${u.id}`, { method: "DELETE" }), `Le compte ${u.displayName} a été supprimé.`);
  };

  /** Faille exploitée ou triche : remise à zéro complète de la progression du joueur */
  const resetStats = async (u: U) => {
    const ok = await confirm({
      title: `Réinitialiser les statistiques de ${u.displayName} ?`,
      message:
        "Remise à zéro : XP et niveau, scores et places dans tous les classements (y compris les saisons archivées), pourcentage de réussite, séries, record Infini, statistiques par jeu, succès et bilan des duels. Ses anciennes réponses ne comptent plus, mais il ne peut pas rejouer les défis du jour déjà faits. Action irréversible, inscrite au journal d'audit.",
      confirmLabel: "Réinitialiser",
      danger: true,
      requireText: u.displayName,
    });
    if (ok === false) return;
    await run(
      () => adminFetch(`/users/${u.id}/reset-stats`, { method: "POST" }),
      `Statistiques de ${u.displayName} remises à zéro.`,
    );
  };

  const mute = async (u: U, hours: number, label: string) => {
    const ok = await confirm({
      title: hours ? `Couper le chat de ${u.displayName} (${label}) ?` : `Rétablir le chat de ${u.displayName} ?`,
      message: hours ? "Il ne pourra plus écrire dans le chat global ni envoyer de messages privés pendant cette durée." : "Il pourra de nouveau écrire.",
      confirmLabel: hours ? "Couper le chat" : "Rétablir",
      danger: hours > 0,
    });
    if (ok === false) return;
    await run(() => adminFetch(`/users/${u.id}/mute`, { method: "POST", body: JSON.stringify({ hours }) }), hours ? `Chat de ${u.displayName} coupé (${label}).` : `Chat de ${u.displayName} rétabli.`);
  };

  const resetMfa = async (u: U) => {
    const ok = await confirm({
      title: `Retirer la double authentification de ${u.displayName} ?`,
      message: "À faire seulement si cette personne a perdu son téléphone et ses codes de secours, après avoir vérifié son identité. Elle devra la réactiver.",
      confirmLabel: "Retirer la 2FA",
      danger: true,
    });
    if (ok === false) return;
    await run(() => adminFetch(`/users/${u.id}/mfa/reset`, { method: "POST" }), `Double authentification retirée pour ${u.displayName}.`);
  };

  /** Email jamais reçu (filtre anti-spam, faute de frappe corrigée par le joueur, panne d'envoi) */
  const verifyEmail = async (u: U) => {
    const ok = await confirm({
      title: `Confirmer l'email de ${u.displayName} ?`,
      message: `L'adresse ${u.email} sera considérée comme confirmée sans le lien envoyé par email. Vérifie d'abord que la demande vient bien de ce joueur.`,
      confirmLabel: "Confirmer l'email",
    });
    if (ok === false) return;
    await run(() => adminFetch(`/users/${u.id}/verify-email`, { method: "POST" }), `Email de ${u.displayName} confirmé.`);
  };

  const removeAvatar = async (u: U) => {
    const ok = await confirm({ title: `Retirer la photo de profil de ${u.displayName} ?`, message: "L'initiale de son pseudo sera affichée à la place.", confirmLabel: "Retirer la photo", danger: true });
    if (ok === false) return;
    await run(() => adminFetch(`/users/${u.id}/avatar`, { method: "DELETE" }), `Photo de ${u.displayName} retirée.`);
  };

  const giveVip = async (u: U, days: number, label: string) => {
    const ok = await confirm({
      title: `Offrir ${label} de VIP à ${u.displayName} ?`,
      message: u.vip.active ? "La durée s'ajoute à son VIP en cours." : "Le VIP commence immédiatement.",
      confirmLabel: "Offrir",
    });
    if (ok === false) return;
    await run(() => adminFetch(`/users/${u.id}/vip`, { method: "POST", body: JSON.stringify({ days }) }), `VIP offert à ${u.displayName}.`);
  };

  const removeVip = async (u: U) => {
    const ok = await confirm({ title: `Retirer le VIP de ${u.displayName} ?`, message: "Le VIP prend fin immédiatement.", confirmLabel: "Retirer le VIP", danger: true });
    if (ok === false) return;
    await run(() => adminFetch(`/users/${u.id}/vip`, { method: "DELETE" }), `VIP retiré à ${u.displayName}.`);
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Utilisateurs</h1>
      <form onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pseudo ou email…" className="w-full max-w-sm rounded-lg border border-line bg-surface p-2.5" />
      </form>
      {message && <p role="status" className="text-sm">{message}</p>}
      <div className="glass overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="px-4 py-2 font-normal">Joueur</th><th className="px-4 font-normal">Niveau</th><th className="px-4 font-normal">Statut</th><th className="px-4 font-normal">Rôle</th><th className="px-4 font-normal">VIP</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {items.map((u) => {
              const self = u.id === me?.id;
              // Compte du fondateur intouchable ; comptes administrateurs gérés par le fondateur seul (s'il existe)
              const locked = !self && (u.role === "OWNER" || (u.role === "ADMIN" && ownerExists && !isOwner));
              const canEdit = isAdmin && !self && !locked;
              return (
                <tr key={u.id}>
                  <td className="flex items-start gap-3 px-4 py-3">
                    <UserAvatar u={u} />
                    <div>
                    <p className="font-medium">{u.displayName}</p>
                    <p className="text-xs text-muted">
                      @{u.username}{u.email ? ` · ${u.email}` : ""}
                      {u.email && !u.emailVerified && <span className="ml-1 text-warn">(non confirmé)</span>}
                    </p>
                    {isAdmin && !locked && u.email && !u.emailVerified && u.status !== "DELETED" && (
                      <button onClick={() => verifyEmail(u)} className="mt-1 text-[11px] text-violet-soft hover:underline">Confirmer l&apos;email</button>
                    )}
                    <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {u.mfaEnabled && <span className="rounded bg-success/15 px-1.5 text-success">2FA</span>}
                      {u.chatMutedUntil && <span className="rounded bg-warn/15 px-1.5 text-warn">chat coupé jusqu&apos;au {new Date(u.chatMutedUntil).toLocaleString("fr-FR")}</span>}
                    </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">Niv. {u.level}</td>
                  <td className="px-4 py-3"><span className={u.status === "ACTIVE" ? "text-success" : "text-danger"}>{u.status === "ACTIVE" ? "Actif" : u.status === "BANNED" ? "Banni" : "Suspendu"}</span></td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={!canEdit}
                      title={locked ? (u.role === "OWNER" ? "Compte du fondateur : protégé" : "Seul le fondateur peut gérer un administrateur") : undefined}
                      onChange={(e) => patch(u, { role: e.target.value }, `Passer ${u.displayName} en ${ROLE_LABEL[e.target.value as UserRole].toLowerCase()}`)}
                      className="rounded border border-line bg-surface p-1 disabled:opacity-50"
                    >
                      {u.role === "OWNER" && <option value="OWNER">{ROLE_LABEL.OWNER}</option>}
                      {ASSIGNABLE_ROLES.filter((r) => r !== "ADMIN" || isOwner || !ownerExists || u.role === "ADMIN").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {u.vip.active && u.vip.until ? (
                      <span className="text-warn">Jusqu&apos;au {new Date(u.vip.until).toLocaleDateString("fr-FR")}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {isAdmin && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {VIP_DURATIONS.map(([days, label]) => (
                          <button key={days} onClick={() => giveVip(u, days, label)} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-warn hover:text-warn">
                            +{label}
                          </button>
                        ))}
                        {u.vip.active && !locked && (
                          <button onClick={() => removeVip(u)} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-danger hover:text-danger">Retirer</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="space-x-2 whitespace-nowrap px-4 py-3 text-right">
                    <button onClick={() => setRewardsOf(u)} className="btn-ghost !py-1">Récompenses</button>
                    {u.avatarUrl && !locked && <button onClick={() => removeAvatar(u)} className="btn-ghost !py-1">Retirer la photo</button>}
                    {locked && <span className="text-xs text-muted">{u.role === "OWNER" ? "Compte protégé" : "Géré par le fondateur"}</span>}
                    {!isStaffRole(u.role) && (
                      u.chatMutedUntil
                        ? <button onClick={() => mute(u, 0, "")} className="btn-ghost !py-1">Rétablir le chat</button>
                        : (
                          <select
                            value=""
                            onChange={(e) => { const [h, l] = e.target.value.split("|"); if (h) void mute(u, Number(h), l); }}
                            aria-label={`Couper le chat de ${u.displayName}`}
                            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                          >
                            <option value="">Couper le chat…</option>
                            <option value="1|1 heure">1 heure</option>
                            <option value="24|24 heures">24 heures</option>
                            <option value="168|7 jours">7 jours</option>
                            <option value="720|30 jours">30 jours</option>
                          </select>
                        )
                    )}
                    {canEdit && u.mfaEnabled && (
                      <button onClick={() => resetMfa(u)} className="btn-ghost !py-1">Retirer la 2FA</button>
                    )}
                    {(isAdmin && (self || !locked)) && (
                      <button onClick={() => resetStats(u)} className="btn-ghost !py-1 hover:!border-warn hover:!text-warn">Réinitialiser les stats</button>
                    )}
                    {canEdit && (
                      <>
                        {u.status === "ACTIVE"
                          ? <button onClick={() => patch(u, { status: "BANNED" }, `Bannir ${u.displayName}`)} className="btn-ghost !py-1 hover:!border-danger hover:!text-danger">Bannir</button>
                          : <button onClick={() => patch(u, { status: "ACTIVE" }, `Réactiver ${u.displayName}`)} className="btn-ghost !py-1">Réactiver</button>}
                        {!isAdminRole(u.role) && (
                          <button onClick={() => remove(u)} className="btn-ghost !py-1 hover:!border-danger hover:!text-danger">Supprimer</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Aucun compte trouvé.</td></tr>}
          </tbody>
        </table>
      </div>
      {isAdmin === false && me && <p className="text-xs text-muted">Seul un administrateur peut modifier, bannir ou supprimer un compte.</p>}
      {rewardsOf && <UserRewards user={rewardsOf} canEdit={isAdmin} onClose={() => setRewardsOf(null)} />}
    </div>
  );
}

function UserAvatar({ u }: { u: U }) {
  if (u.avatarUrl) return <img src={media(u.avatarUrl)} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet to-neon-blue font-display font-bold text-white">
      {u.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

type Owned = CosmeticRefDto & { isActive: boolean; source: CosmeticSource; note: string | null; grantedAt: string; grantedBy: string | null };

/** Récompenses d'un joueur : liste, attribution et retrait (attribution manuelle ou de saison) */
function UserRewards({ user, canEdit, onClose }: { user: U; canEdit: boolean; onClose: () => void }) {
  const confirm = useConfirm();
  const [owned, setOwned] = useState<Owned[] | null>(null);
  const [all, setAll] = useState<AdminCosmeticDto[]>([]);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    adminFetch<Owned[]>(`/users/${user.id}/cosmetics`).then(setOwned, (e: Error) => setMessage({ text: e.message, ok: false }));
  }, [user.id]);
  useEffect(() => {
    load();
    adminFetch<AdminCosmeticDto[]>("/cosmetics").then(setAll, () => setAll([]));
  }, [load]);

  const ownedIds = new Set((owned ?? []).map((o) => o.id));
  // Récompenses attribuables à la main : actives, sans déblocage automatique, pas encore obtenues
  const grantable = all.filter((c) => c.isActive && !c.unlockLevel && !c.unlockAchievement && !ownedIds.has(c.id));

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice) return;
    setMessage(null);
    try {
      await adminFetch(`/users/${user.id}/cosmetics`, { method: "POST", body: JSON.stringify({ cosmeticId: choice, note: note.trim() || null }) });
      setMessage({ text: "Récompense attribuée.", ok: true });
      setChoice("");
      setNote("");
      load();
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  const revoke = async (o: Owned) => {
    const ok = await confirm({ title: `Retirer « ${o.name} » à ${user.displayName} ?`, message: "S'il l'avait équipée, elle est retirée de son profil.", confirmLabel: "Retirer", danger: true });
    if (ok === false) return;
    setMessage(null);
    try {
      await adminFetch(`/users/${user.id}/cosmetics/${o.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="rewards-title" className="glass max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="rewards-title" className="font-display text-xl font-bold">Récompenses de {user.displayName}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Fermer">✕</button>
        </div>
        {canEdit && (
          <form onSubmit={grant} className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <select value={choice} onChange={(e) => setChoice(e.target.value)} className="input min-w-48 flex-1" aria-label="Récompense à attribuer">
                <option value="">Attribuer une récompense…</option>
                {grantable.map((c) => <option key={c.id} value={c.id}>{COSMETIC_TYPE_LABEL[c.type]} · {c.name}</option>)}
              </select>
              <button disabled={!choice} className="btn-primary !py-2">Attribuer</button>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Raison (interne, facultatif) : ex. chaîne YouTube vérifiée" className="input" />
          </form>
        )}
        {message && <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
        {!owned ? <p className="text-sm text-muted">Chargement…</p> : owned.length === 0 ? (
          <p className="text-sm text-muted">Aucune récompense pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-line/60 text-sm">
            {owned.map((o) => (
              <li key={o.id} className={`flex flex-wrap items-center gap-3 py-2 ${o.isActive ? "" : "opacity-50"}`}>
                {o.type === "BADGE" ? <BadgeChip badge={o} size={12} /> : o.type === "FRAME" ? <FrameSwatch frame={o} size={22} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />}
                <span className="font-medium" style={{ color: o.color }}>{o.name}</span>
                <span className="text-xs text-muted">
                  {COSMETIC_TYPE_LABEL[o.type]} · {COSMETIC_SOURCE_LABEL[o.source]} · {new Date(o.grantedAt).toLocaleDateString("fr-FR")}
                  {o.grantedBy ? ` · par ${o.grantedBy}` : ""}{o.note ? ` · ${o.note}` : ""}
                </span>
                {canEdit && (o.source === "MANUAL" || o.source === "SEASON") && (
                  <button onClick={() => revoke(o)} className="ml-auto text-xs text-danger hover:underline">Retirer</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Les récompenses de niveau et de succès sont données automatiquement. Crée ou modifie les récompenses dans la page « Récompenses ».</p>
      </div>
    </div>
  );
}
