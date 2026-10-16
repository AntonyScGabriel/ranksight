"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TOURNAMENT_STATUS_LABEL, formatRoomCode, normalizeRoomCode, type TournamentPreviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { LoginRequired, Panel, Skeleton } from "@/components/States";

/** Lien d'invitation à un tournoi : aperçu, puis inscription gratuite. */
export default function JoinTournamentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = normalizeRoomCode(decodeURIComponent(raw));
  const { me, loading } = useSession();
  const router = useRouter();
  const [preview, setPreview] = useState<TournamentPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me || !code) return;
    api.tournamentPreview(code).then(
      (p) => (p.member ? router.replace(`/tournaments/${p.id}`) : setPreview(p)),
      (e) => setError(errorMessage(e, "Aucun tournoi ouvert avec ce code.")),
    );
  }, [me, code, router]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next={`/tournaments/join/${raw}`} text="Connecte-toi (ou crée un compte gratuit) pour t'inscrire à ce tournoi. Pas besoin d'être VIP." />;
  if (!code) return <Panel title="Code invalide" text="Le code d'un tournoi fait 8 caractères, lettres et chiffres."><Link href="/tournaments" className="btn-ghost mx-auto w-fit">Tournois</Link></Panel>;
  if (error && !preview) return <Panel title="Tournoi introuvable" text={error}><Link href="/tournaments" className="btn-ghost mx-auto w-fit">Tournois</Link></Panel>;
  if (!preview) return <Skeleton />;

  const open = preview.status === "LOBBY" && preview.players < preview.capacity;
  return (
    <Panel title={`Tournoi de ${preview.host}`}>
      <p className="font-mono text-lg tracking-widest text-neon">{formatRoomCode(preview.code)}</p>
      <ul className="space-y-1 text-sm text-muted">
        <li>{preview.game.name} · {preview.rounds} manches par match</li>
        <li>{preview.players}/{preview.capacity} inscrits · {TOURNAMENT_STATUS_LABEL[preview.status]}</li>
      </ul>
      {open ? (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const t = await api.joinTournament(preview.code);
              router.push(`/tournaments/${t.id}`);
            } catch (e) {
              setError(errorMessage(e, "Impossible de s'inscrire à ce tournoi."));
              setBusy(false);
            }
          }}
          className="btn-primary mx-auto"
        >
          S&apos;inscrire gratuitement
        </button>
      ) : (
        <p className="text-sm text-warn">{preview.status === "LOBBY" ? "Ce tournoi est complet." : "Le tournoi a déjà commencé ou est terminé."}</p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Panel>
  );
}
