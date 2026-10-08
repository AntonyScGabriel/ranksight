import Link from "next/link";
import { NO_CLIP_MESSAGES } from "@ranksight/shared";

export function Panel({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="glass animate-rise mx-auto max-w-md space-y-4 p-8 text-center">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      {text && <p className="text-muted">{text}</p>}
      {children}
    </div>
  );
}

export function LoginRequired({ next, text = "Connecte-toi pour jouer et garder ta progression." }: { next: string; text?: string }) {
  return (
    <Panel title="Connexion requise" text={text}>
      <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn-primary">Se connecter</Link>
    </Panel>
  );
}

export function NoClip({ action }: { action?: React.ReactNode }) {
  return <Panel title={NO_CLIP_MESSAGES.title} text={NO_CLIP_MESSAGES.subtitle}>{action}</Panel>;
}

export function ErrorPanel({ retry }: { retry?: () => void }) {
  return (
    <Panel title="Oups" text="Impossible de charger cette page pour le moment.">
      {retry && <button onClick={retry} className="btn-ghost mx-auto">Réessayer</button>}
    </Panel>
  );
}

export function Skeleton({ className = "h-48" }: { className?: string }) {
  return <div className={`glass animate-pulse ${className}`} />;
}
