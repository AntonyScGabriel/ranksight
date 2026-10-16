"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CosmeticRefDto } from "@ranksight/shared";
import { media } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { FlairBadge, frameBackground } from "./Flair";
import { VipBadge } from "./VipBadge";

const NAV = [
  { href: "/play/daily", label: "Défis du jour", short: "Défis" },
  { href: "/play/infinite", label: "Infini", short: "Infini" },
  { href: "/versus", label: "Duels", short: "Duels" },
  { href: "/leaderboard", label: "Classements", short: "Top" },
  { href: "/chat", label: "Chat", short: "Chat" },
  { href: "/friends", label: "Amis", short: "Amis" },
];
/** Onglet affiché dans la barre du haut sur grand écran (et toujours dans le menu du compte) */
const NAV_WIDE = { href: "/suggestions", label: "Suggestions" };
/** Salons (publics et privés) : dans la barre du haut sur grand écran ; sinon depuis l'écran Duels et le menu du compte */
const NAV_ROOMS = { href: "/rooms", label: "Salons" };

export function Header() {
  const pathname = usePathname();
  const { me, loading, logout } = useSession();
  const { unread, versusPending, roomInvites } = useChat();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/60 bg-void/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="font-display text-lg font-bold tracking-wide">
            RANK<span className="text-neon">GUESS</span>
          </Link>
          <ul className="hidden gap-1 md:flex">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className={`relative rounded-lg px-3 py-2 text-sm transition hover:bg-surface hover:text-ink ${isActive(n.href) ? "text-ink" : "text-muted"}`}
                >
                  {n.label}
                  {n.href === "/friends" && unread > 0 && <Badge n={unread} />}
                  {n.href === "/versus" && versusPending > 0 && <Badge n={versusPending} />}
                </Link>
              </li>
            ))}
            <li className="hidden lg:block">
              <Link
                href={NAV_ROOMS.href}
                className={`relative rounded-lg px-3 py-2 text-sm transition hover:bg-surface hover:text-ink ${isActive(NAV_ROOMS.href) ? "text-ink" : "text-muted"}`}
              >
                {NAV_ROOMS.label}
                {roomInvites > 0 && <Badge n={roomInvites} />}
              </Link>
            </li>
            <li className="hidden xl:block">
              <Link
                href={NAV_WIDE.href}
                className={`rounded-lg px-3 py-2 text-sm transition hover:bg-surface hover:text-ink ${isActive(NAV_WIDE.href) ? "text-ink" : "text-muted"}`}
              >
                {NAV_WIDE.label}
              </Link>
            </li>
          </ul>

          <div className="ml-auto flex items-center gap-3">
            {!loading && !me && (
              <>
                <Link href="/signup" className="hidden text-sm text-muted hover:text-ink sm:inline">Créer un compte</Link>
                <Link href="/login" className="btn-primary !px-4 !py-2 text-sm">Se connecter</Link>
              </>
            )}
            {me && (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm transition hover:border-violet"
                  aria-haspopup="menu"
                  aria-expanded={open}
                >
                  <span className="relative">
                    <Avatar name={me.displayName} url={me.avatarUrl} frame={me.flair.frame} />
                    {me.newRewards > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-void bg-neon" aria-label="Nouvelle récompense" />}
                  </span>
                  <span className="hidden sm:inline">{me.displayName}</span>
                  <FlairBadge flair={me.flair} size={12} />
                  {me.vip.active && <VipBadge />}
                </button>
                {open && (
                  <div role="menu" className="glass absolute right-0 mt-2 w-56 overflow-hidden p-1 shadow-2xl">
                    <MenuLink href="/profile" onClick={() => setOpen(false)}>Mon profil</MenuLink>
                    <MenuLink href="/rewards" onClick={() => setOpen(false)}>
                      Mes récompenses
                      {me.newRewards > 0 && <span className="ml-2 rounded-full bg-neon px-1.5 text-[10px] font-bold text-void">{me.newRewards}</span>}
                    </MenuLink>
                    <MenuLink href="/achievements" onClick={() => setOpen(false)}>Mes succès</MenuLink>
                    <MenuLink href="/rooms" onClick={() => setOpen(false)}>Salons</MenuLink>
                    <MenuLink href="/shop" onClick={() => setOpen(false)}>Boutique VIP</MenuLink>
                    <MenuLink href="/my-clips" onClick={() => setOpen(false)}>Mes clips</MenuLink>
                    <MenuLink href="/submit" onClick={() => setOpen(false)}>Proposer un clip</MenuLink>
                    <MenuLink href="/suggestions" onClick={() => setOpen(false)}>Suggestions</MenuLink>
                    {me.role !== "USER" && (
                      <a
                        href={`${process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001"}${me.role === "REVIEWER" ? "/triage" : ""}`}
                        className="block rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        {me.role === "REVIEWER" ? "Tri des clips" : "Administration"}
                      </a>
                    )}
                    <button onClick={logout} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-surface-2">
                      Se déconnecter
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-void/85 backdrop-blur-xl md:hidden">
        <ul className="grid grid-cols-7">
          {[...NAV, { href: "/profile", label: "Profil", short: "Profil" }].map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                className={`relative flex h-16 items-center justify-center text-[11px] font-medium ${isActive(n.href) || (n.href === "/versus" && isActive("/rooms")) ? "text-neon" : "text-muted"}`}
              >
                {n.short}
                {n.href === "/friends" && unread > 0 && <Badge n={unread} />}
                {n.href === "/versus" && versusPending + roomInvites > 0 && <Badge n={versusPending + roomInvites} />}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function MenuLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="block rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink">
      {children}
    </Link>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
      {n > 9 ? "9+" : n}
    </span>
  );
}

/** Avatar du joueur (photo ou initiale), entouré de son cadre équipé s'il en a un */
export function Avatar({ name, url, size = 28, frame }: { name: string; url: string | null; size?: number; frame?: CosmeticRefDto | null }) {
  // Photo introuvable (supprimée, lien externe expiré) : on revient à l'initiale
  const [failed, setFailed] = useState<string | null>(null);
  const inner = url && failed !== url ? (
    <img src={media(url)} alt="" width={size} height={size} onError={() => setFailed(url)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet to-neon-blue font-display font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
  if (!frame) return inner;
  const ring = Math.max(2, Math.round(size / 14));
  return (
    <span
      title={`Cadre ${frame.name}`}
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={{ padding: ring, background: frameBackground(frame), boxShadow: `0 0 ${Math.round(size / 4)}px ${frame.color}55` }}
    >
      {inner}
    </span>
  );
}
