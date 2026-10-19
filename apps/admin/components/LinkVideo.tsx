import { CLIP_LINK_PROVIDER_LABEL, type ClipVideoKind } from "@ranksight/shared";

/**
 * Clip proposé par un lien : lecteur intégré YouTube / Medal (le passage que verront les joueurs) et lien vers la page
 * d'origine, pour vérifier que ni le titre, ni la chaîne, ni la description ne révèlent le rang.
 */
export function LinkVideo({ src, kind, pageUrl }: { src: string; kind: ClipVideoKind; pageUrl: string | null }) {
  const provider = kind === "MEDAL" ? CLIP_LINK_PROVIDER_LABEL.MEDAL : CLIP_LINK_PROVIDER_LABEL.YOUTUBE;
  return (
    <div className="space-y-2">
      {/* L'administration n'envoie aucun référent ; le lecteur YouTube en exige un (origine seule) */}
      <iframe src={src} title={`Clip ${provider}`} allow="autoplay; encrypted-media; fullscreen" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full rounded-xl bg-black" />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
        <span>Clip proposé par un lien {provider} : vérifie aussi le titre, la chaîne et la description de la vidéo.</span>
        {pageUrl && <a href={pageUrl} target="_blank" rel="noreferrer noopener" className="font-semibold text-neon underline">Ouvrir sur {provider} ↗</a>}
      </div>
    </div>
  );
}
