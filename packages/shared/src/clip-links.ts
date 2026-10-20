import { z } from "zod";

/**
 * Clips proposés par un lien YouTube ou Medal : la vidéo reste chez YouTube ou Medal (rien n'est téléchargé ni stocké),
 * elle est lue avec leur lecteur intégré. Pour YouTube, seul le passage choisi (début, durée) est joué.
 */
export const ClipLinkProvider = z.enum(["YOUTUBE", "MEDAL"]);
export type ClipLinkProvider = z.infer<typeof ClipLinkProvider>;
export const CLIP_LINK_PROVIDER_LABEL: Record<ClipLinkProvider, string> = { YOUTUBE: "YouTube", MEDAL: "Medal" };

/** Nature de la vidéo d'un clip : fichier envoyé (lu par le lecteur vidéo) ou lecteur intégré YouTube / Medal */
export const ClipVideoKind = z.enum(["FILE", "YOUTUBE", "MEDAL"]);
export type ClipVideoKind = z.infer<typeof ClipVideoKind>;

export type ClipLink = { provider: ClipLinkProvider; videoId: string; startSec: number | null };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MEDAL_ID = /^[A-Za-z0-9_-]{5,40}$/;
/** Début maximal d'un passage YouTube (12 h) */
export const CLIP_LINK_MAX_START_SEC = 12 * 3600;

/** « 90 », « 90s », « 1m30s », « 1h2m3s » → secondes ; null si illisible */
function parseTime(t: string | null): number | null {
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !t) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Lien YouTube (watch, youtu.be, shorts, live, embed) ou Medal (medal.tv/clip/…, medal.tv/games/…/clips/…) :
 * fournisseur, identifiant de la vidéo et début éventuel (paramètre t= ou start=). null pour tout autre lien.
 */
export function parseClipLink(raw: string): ClipLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id: string | undefined;
    if (host === "youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (["shorts", "live", "embed"].includes(parts[0] ?? "")) id = parts[1];
    if (!id || !YOUTUBE_ID.test(id)) return null;
    const start = parseTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return { provider: "YOUTUBE", videoId: id, startSec: start === null ? null : Math.min(start, CLIP_LINK_MAX_START_SEC) };
  }
  if (host === "medal.tv") {
    // Préfixe de langue facultatif (medal.tv/fr/games/…)
    const p = /^[a-z]{2}(-[a-z]{2})?$/i.test(parts[0] ?? "") ? parts.slice(1) : parts;
    let id: string | undefined;
    if (p[0] === "clip" || p[0] === "clips") id = p[1];
    else if (p[0] === "games" && (p[2] === "clips" || p[2] === "clip")) id = p[3];
    if (!id || !MEDAL_ID.test(id)) return null;
    return { provider: "MEDAL", videoId: id, startSec: null };
  }
  return null;
}

/** Moment saisi dans le formulaire : « 90 », « 1:30 » ou « 1:02:03 » → secondes ; null si illisible */
export function parseClipClock(v: string): number | null {
  const s = v.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return null;
  return s.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** Secondes → « m:ss » */
export function formatClipClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/** Adresse publique de la vidéo (pour la modération : ouvrir la page d'origine, vérifier le titre et la chaîne) */
export function clipLinkPageUrl(provider: ClipLinkProvider, videoId: string): string {
  return provider === "YOUTUBE" ? `https://www.youtube.com/watch?v=${videoId}` : `https://medal.tv/clip/${videoId}`;
}

/**
 * Adresse du lecteur intégré. YouTube (domaine sans cookies) : passage début → fin, lecture automatique avec le son
 * (comme les clips envoyés en fichier : l'ambiance aide à deviner), sans vidéos suggérées d'autres chaînes. Medal :
 * lecture automatique avec le son, en boucle, sans boutons d'appel à l'action. Si le navigateur refuse la lecture
 * automatique avec le son, le lecteur attend un clic sur lecture.
 */
export function clipEmbedUrl(provider: ClipLinkProvider, videoId: string, startSec: number, durationSec: number): string {
  // Lecteur Medal : adresse /games/<jeu>/clip/<id> (le nom du jeu n'est pas vérifié par Medal ; /clip/<id> redirige
  // vers l'accueil, qui refuse d'être intégré)
  if (provider === "MEDAL") return `https://medal.tv/games/clips/clip/${videoId}?autoplay=1&muted=0&loop=1&cta=0`;
  const start = Math.max(0, Math.floor(startSec));
  const end = start + Math.max(1, Math.round(durationSec));
  return `https://www.youtube-nocookie.com/embed/${videoId}?start=${start}&end=${end}&autoplay=1&mute=0&playsinline=1&rel=0&iv_load_policy=3&modestbranding=1`;
}

/** Clé unique d'un clip à lien (même colonne que les fichiers) : un même passage d'une même vidéo n'est proposé qu'une fois */
export function clipLinkKey(provider: ClipLinkProvider, videoId: string, startSec: number): string {
  return `link/${provider.toLowerCase()}/${videoId}/${Math.floor(startSec)}`;
}
