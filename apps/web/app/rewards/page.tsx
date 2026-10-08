"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  COSMETIC_TYPE_PLURAL, type CosmeticRefDto, type CosmeticType, type EquipFlairInput, type FlairDto,
  type LockedCosmeticDto, type MyRewardsDto, type OwnedCosmeticDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { BadgeChip, FrameSwatch, TitleText } from "@/components/Flair";
import { VipBadge } from "@/components/VipBadge";
import { errorMessage } from "@/components/AuthForm";
import { ErrorPanel, LoginRequired, Skeleton } from "@/components/States";

const TYPES: CosmeticType[] = ["TITLE", "BADGE", "FRAME"];
const FIELD: Record<CosmeticType, keyof EquipFlairInput> = { TITLE: "titleId", BADGE: "badgeId", FRAME: "frameId" };
const SLOT: Record<CosmeticType, keyof FlairDto> = { TITLE: "title", BADGE: "badge", FRAME: "frame" };
const HELP: Record<CosmeticType, string> = {
  TITLE: "Affiché sous ton pseudo : chat, classements, duels et profil.",
  BADGE: "Petite icône à côté de ton pseudo.",
  FRAME: "Anneau de couleur autour de ta photo de profil.",
};

/** Mes récompenses : titres, badges et cadres obtenus (à équiper) et ceux qui restent à gagner. */
export default function RewardsPage() {
  const { me, loading, refresh } = useSession();
  const [data, setData] = useState<MyRewardsDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.rewards().then(
      (r) => {
        setData(r);
        setFailed(false);
        // Les nouvelles récompenses sont maintenant vues : la pastille du menu disparaît
        if (r.owned.some((o) => o.isNew)) void refresh();
      },
      () => setFailed(true),
    );
  }, [refresh]);

  const userId = me?.id;
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/rewards" text="Connecte-toi pour voir tes titres, badges et cadres." />;
  if (failed) return <ErrorPanel retry={() => { setFailed(false); load(); }} />;
  if (!data) return <Skeleton />;

  const equip = async (type: CosmeticType, id: string | null) => {
    setPending(`${type}:${id ?? "none"}`);
    setError(null);
    try {
      const equipped = await api.equip({ [FIELD[type]]: id });
      setData((d) => (d ? { ...d, equipped } : d));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const total = data.owned.length;

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Titres, badges et cadres</h1>
          <p className="text-muted">
            {total} récompense{total > 1 ? "s" : ""} obtenue{total > 1 ? "s" : ""}. Gagne-en d&apos;autres en montant de niveau et avec les{" "}
            <Link href="/achievements" className="text-violet-soft hover:underline">succès</Link>.
          </p>
        </div>
        <Preview name={me.displayName} url={me.avatarUrl} vip={me.vip.active} flair={data.equipped} />
      </header>

      {error && <p role="alert" className="rounded-xl border border-danger/40 px-4 py-2 text-sm text-danger">{error}</p>}

      {TYPES.map((type) => {
        const owned = data.owned.filter((o) => o.type === type);
        const current = data.equipped[SLOT[type]];
        return (
          <div key={type} className="space-y-3">
            <div>
              <h2 className="font-display text-xl font-semibold">{COSMETIC_TYPE_PLURAL[type]}</h2>
              <p className="text-sm text-muted">{HELP[type]}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <li>
                <button
                  onClick={() => equip(type, null)}
                  disabled={!current || pending !== null}
                  aria-pressed={!current}
                  className={`glass flex h-full w-full items-center gap-3 p-4 text-left transition ${!current ? "ring-2 ring-neon" : "hover:bg-surface-2"}`}
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-line text-muted">—</span>
                  <span>
                    <span className="block font-medium">Aucun</span>
                    <span className="text-xs text-muted">{!current ? "Équipé" : "Ne rien afficher"}</span>
                  </span>
                </button>
              </li>
              {owned.map((o) => (
                <li key={o.id}>
                  <OwnedCard
                    item={o}
                    equipped={current?.id === o.id}
                    busy={pending === `${type}:${o.id}`}
                    disabled={pending !== null}
                    onEquip={() => equip(type, o.id)}
                  />
                </li>
              ))}
            </ul>
            {owned.length === 0 && <p className="text-sm text-muted">Aucun {COSMETIC_TYPE_PLURAL[type].toLowerCase().slice(0, -1)} pour l&apos;instant.</p>}
          </div>
        );
      })}

      {data.locked.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="font-display text-xl font-semibold">À gagner</h2>
            <p className="text-sm text-muted">Tu es niveau {data.level}.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.locked.map((l) => <li key={l.id}><LockedCard item={l} level={data.level} /></li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function Visual({ item, size = 16 }: { item: CosmeticRefDto; size?: number }) {
  if (item.type === "BADGE") return <BadgeChip badge={item} size={size} />;
  if (item.type === "FRAME") return <FrameSwatch frame={item} size={size + 16} />;
  return <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: item.color }} />;
}

function OwnedCard({
  item, equipped, busy, disabled, onEquip,
}: { item: OwnedCosmeticDto; equipped: boolean; busy: boolean; disabled: boolean; onEquip: () => void }) {
  return (
    <button
      onClick={onEquip}
      disabled={equipped || disabled}
      aria-pressed={equipped}
      className={`glass flex h-full w-full items-start gap-3 p-4 text-left transition ${equipped ? "ring-2 ring-neon" : "hover:bg-surface-2"}`}
    >
      <Visual item={item} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {item.type === "TITLE" ? <TitleText title={item} className="!text-xs" /> : <span className="font-medium" style={{ color: item.color }}>{item.name}</span>}
          {item.isNew && <span className="rounded-full bg-neon px-1.5 text-[10px] font-bold text-void">Nouveau</span>}
        </span>
        {item.description && !item.hint.includes(item.description) && <span className="mt-0.5 block text-xs text-muted">{item.description}</span>}
        <span className="mt-1 block text-[11px] text-muted">
          Obtenu : {item.hint} · le {new Date(item.grantedAt).toLocaleDateString("fr-FR")}
        </span>
      </span>
      <span className={`text-xs ${equipped ? "text-neon" : "text-violet-soft"}`}>{busy ? "…" : equipped ? "Équipé" : "Équiper"}</span>
    </button>
  );
}

function LockedCard({ item, level }: { item: LockedCosmeticDto; level: number }) {
  const pct = item.unlock.kind === "level" ? Math.min(100, Math.round((level / item.unlock.level) * 100)) : null;
  // Description qui répète seulement la condition : non affichée
  const description = item.description && !item.description.toLowerCase().includes(item.unlock.kind === "level" ? `niveau ${item.unlock.level}` : item.unlock.achievement.toLowerCase())
    ? item.description
    : null;
  return (
    <div className="glass h-full space-y-2 p-4 opacity-80">
      <div className="flex items-start gap-3">
        <span className="grayscale"><Visual item={item} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium" style={{ color: item.color }}>{item.name}</p>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
      </div>
      <p className="text-xs text-muted">Pour l&apos;obtenir : {item.hint}</p>
      {pct !== null && (
        <div className="h-1.5 rounded-full bg-white/5">
          <div className="h-full rounded-full bg-gradient-to-r from-violet to-neon" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Aperçu : comment les autres joueurs te voient */
function Preview({ name, url, vip, flair }: { name: string; url: string | null; vip: boolean; flair: FlairDto }) {
  return (
    <div className="glass flex items-center gap-3 px-5 py-4">
      <Avatar name={name} url={url} size={48} frame={flair.frame} />
      <div>
        <p className="flex items-center gap-1.5 font-semibold">
          {name}
          {flair.badge && <BadgeChip badge={flair.badge} size={12} />}
          {vip && <VipBadge />}
        </p>
        {flair.title ? <TitleText title={flair.title} /> : <p className="text-xs text-muted">Aucun titre</p>}
      </div>
    </div>
  );
}
