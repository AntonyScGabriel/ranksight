import type { MetadataRoute } from "next";

/** Site installable sur l'écran d'accueil du téléphone ou de l'ordinateur */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RankGuess — Devine le rang",
    short_name: "RankGuess",
    description: "Regarde un clip, devine le rang du joueur, bats tes amis.",
    start_url: "/play/daily",
    display: "standalone",
    background_color: "#07060b",
    theme_color: "#07060b",
    lang: "fr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
