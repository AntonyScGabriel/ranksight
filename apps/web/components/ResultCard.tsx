"use client";

import Link from "next/link";
import { RankEmblem } from "./RankEmblem";
import { BadgeChip, FrameSwatch } from "./Flair";
import { PLATFORM_LABEL, REGION_LABEL, type GuessResultDto, type Platform, type RankDto, type Region } from "@ranksight/shared";

const VERDICT: Record<number, [string, string]> = {
  0: ["PILE DESSUS", "text-success"],
  1: ["PROCHE", "text-neon"],
  2: ["À CÔTÉ", "text-warn"],
};

export function ResultCard({
  result, ranks, gameName, onNext, nextLabel = "Clip suivant",
}: { result: GuessResultDto; ranks: RankDto[]; gameName: string; onNext?: () => void; nextLabel?: string }) {
  const [label, color] = VERDICT[result.distance] ?? ["RATÉ", "text-danger"];
  const max = Math.max(1, ...Object.values(result.communityDistribution));

  const share = async () => {
    const squares = ranks.map((r) => (r.id === result.correctRank.id ? "🟪" : r.id === result.guessedRank.id ? "🟦" : "⬛")).join("");
    const text = `RankGuess · ${gameName} · ${new Date().toISOString().slice(0, 10)} — ${result.score} pts 🔥${result.dailyStreak}\n${squares}`;
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else await navigator.clipboard.writeText(text);
  };

  return (
    <div className="glass animate-rise space-y-6 p-6">
      <div className="flex items-end justify-between">
        <div>
          <p className={`font-display text-sm font-bold tracking-[0.2em] ${color}`}>{label}</p>
          <p className="font-display text-6xl font-bold">+{result.score}</p>
        </div>
        <div className="text-right">
          <p className="hud-label">XP</p>
          <p className="font-mono text-xl text-neon">+{result.xpGained}</p>
          {result.vipBoost && <p className="hud-label text-warn">Boost VIP ×1,5</p>}
          <p className="hud-label mt-1">Niv. {result.level} · 🔥 {result.dailyStreak}</p>
          {result.winStreak > 1 && <p className="hud-label mt-1 text-success">{result.winStreak} victoires d&apos;affilée</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <RankTile title="Rang réel" rank={result.correctRank} />
        <RankTile title="Ta réponse" rank={result.guessedRank} muted={result.distance > 0} />
      </div>

      {result.clipPlayer && (
        <p className="text-sm text-muted">
          Joueur du clip : <span className="font-semibold text-ink">{result.clipPlayer.inGamePseudo}</span>
          {result.clipPlayer.platform && ` · ${PLATFORM_LABEL[result.clipPlayer.platform as Platform] ?? result.clipPlayer.platform}`}
          {result.clipPlayer.region && ` · ${REGION_LABEL[result.clipPlayer.region as Region] ?? result.clipPlayer.region}`}
        </p>
      )}

      <div>
        <p className="hud-label mb-3">Réponses de la communauté</p>
        <ul className="space-y-1.5">
          {ranks.map((r) => {
            const pct = result.communityDistribution[r.id] ?? 0;
            return (
              <li key={r.id} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
                <span className={r.id === result.correctRank.id ? "font-semibold text-ink" : "text-muted"}>{r.name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/5">
                  <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${(pct / max) * 100}%`, background: r.color }} />
                </span>
                <span className="text-right font-mono text-xs text-muted">{pct}%</span>
              </li>
            );
          })}
        </ul>
      </div>

      {result.unlockedAchievements.length > 0 && (
        <div className="rounded-xl border border-violet/40 bg-violet/10 p-4">
          <p className="hud-label text-violet-soft">Succès débloqué</p>
          {result.unlockedAchievements.map((a) => <p key={a.code} className="font-display font-semibold">🏆 {a.name}</p>)}
          <Link href="/achievements" className="text-xs text-violet-soft hover:underline">Voir mes succès</Link>
        </div>
      )}

      {result.unlockedRewards.length > 0 && (
        <div className="rounded-xl border border-neon/40 bg-neon/10 p-4">
          <p className="hud-label text-neon">Nouvelle récompense</p>
          <ul className="mt-1 space-y-1">
            {result.unlockedRewards.map((r) => (
              <li key={r.id} className="flex items-center gap-2 font-display font-semibold">
                {r.type === "BADGE" ? <BadgeChip badge={r} size={12} /> : r.type === "FRAME" ? <FrameSwatch frame={r} size={20} /> : null}
                <span style={{ color: r.color }}>{r.name}</span>
                <span className="text-xs font-normal text-muted">{r.type === "TITLE" ? "titre" : r.type === "BADGE" ? "badge" : "cadre"}</span>
              </li>
            ))}
          </ul>
          <Link href="/rewards" className="text-xs text-neon hover:underline">Équiper</Link>
        </div>
      )}

      <div className="flex gap-3">
        {onNext && <button onClick={onNext} className="btn-primary flex-1">{nextLabel}</button>}
        <button onClick={share} className={onNext ? "btn-ghost" : "btn-primary flex-1"}>Partager</button>
      </div>
    </div>
  );
}

function RankTile({ title, rank, muted }: { title: string; rank: Omit<RankDto, "gameId">; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line p-4" style={{ background: `linear-gradient(135deg, ${rank.color}22, transparent)` }}>
      <RankEmblem rank={rank} size={48} className={muted ? "opacity-60" : ""} />
      <div className="min-w-0">
        <p className="hud-label">{title}</p>
        <p className={`truncate font-display text-xl font-bold ${muted ? "opacity-60" : ""}`} style={{ color: rank.color }}>{rank.name}</p>
      </div>
    </div>
  );
}
