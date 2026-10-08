/** Badge affiché à côté du pseudo des joueurs VIP. */
export function VipBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Joueur VIP"
      className={`inline-flex items-center rounded bg-gradient-to-r from-warn to-[#f59e0b] px-1.5 py-px align-middle text-[10px] font-bold tracking-wider text-black ${className}`}
    >
      VIP
    </span>
  );
}
