"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROOM_MODE_LABEL, ROOM_STATUS_LABEL, ROOM_VISIBILITY_LABEL, formatRoomCode, normalizeRoomCode, type RoomPreviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { LoginRequired, Panel, Skeleton } from "@/components/States";

/** Lien d'invitation : aperçu du salon, puis « Rejoindre » (gratuit). */
export default function JoinRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = normalizeRoomCode(decodeURIComponent(raw));
  const { me, loading } = useSession();
  const router = useRouter();
  const [preview, setPreview] = useState<RoomPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me || !code) return;
    api.roomPreview(code).then(
      (p) => (p.member && p.status !== "CLOSED" ? router.replace(`/rooms/${p.id}`) : setPreview(p)),
      (e) => setError(errorMessage(e, "Aucun salon ouvert avec ce code.")),
    );
  }, [me, code, router]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next={`/rooms/join/${raw}`} text="Connecte-toi (ou crée un compte gratuit) pour rejoindre ce salon. Pas besoin d'être VIP." />;
  if (!code) return <Panel title="Code invalide" text="Le code d'un salon fait 8 caractères, lettres et chiffres."><Link href="/rooms" className="btn-ghost mx-auto w-fit">Salons</Link></Panel>;
  if (error && !preview) return <Panel title="Salon introuvable" text={error}><Link href="/rooms" className="btn-ghost mx-auto w-fit">Salons</Link></Panel>;
  if (!preview) return <Skeleton />;

  const open = preview.status === "LOBBY" && preview.players < preview.maxPlayers;
  return (
    <Panel title={preview.host ? `Salon de ${preview.host}` : "Salon gratuit"}>
      <p className="font-mono text-lg tracking-widest text-neon">{formatRoomCode(preview.code)}</p>
      <ul className="space-y-1 text-sm text-muted">
        <li>Salon {ROOM_VISIBILITY_LABEL[preview.visibility].toLowerCase()} · {ROOM_MODE_LABEL[preview.mode]} · partie non classée</li>
        <li>{preview.game.name} · {preview.rounds} manches · {preview.roundSec} s par manche</li>
        <li>{preview.players}/{preview.maxPlayers} joueurs · {ROOM_STATUS_LABEL[preview.status]}</li>
      </ul>
      {open ? (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const room = await api.joinRoom(preview.code);
              router.push(`/rooms/${room.id}`);
            } catch (e) {
              setError(errorMessage(e, "Impossible de rejoindre ce salon."));
              setBusy(false);
            }
          }}
          className="btn-primary mx-auto"
        >
          Rejoindre gratuitement
        </button>
      ) : (
        <p className="text-sm text-warn">
          {preview.status === "LOBBY" ? "Ce salon est complet." : "La partie a déjà commencé."}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Panel>
  );
}
