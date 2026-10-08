import type { MetadataRoute } from "next";

const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [
    ["", 1], ["/play/daily", 0.9], ["/play/infinite", 0.8], ["/leaderboard", 0.7], ["/how-to-play", 0.7], ["/faq", 0.5],
    ["/signup", 0.6], ["/contact", 0.3], ["/legal/mentions", 0.1], ["/legal/cgu", 0.1], ["/legal/cgv", 0.1],
    ["/legal/confidentialite", 0.1], ["/legal/cookies", 0.1], ["/legal/suppression-compte", 0.1],
  ];
  return pages.map(([path, priority]) => ({ url: `${site}${path}`, changeFrequency: path.startsWith("/legal") ? "yearly" : "daily", priority }));
}
