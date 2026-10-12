import type { MetadataRoute } from "next";

const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Pages publiques indexables ; les pages de compte et de jeu personnelles ne le sont pas. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/profile", "/friends", "/chat", "/my-clips", "/submit", "/shop", "/versus/", "/reset-password", "/verify-email", "/achievements", "/suggestions"],
    },
    sitemap: `${site}/sitemap.xml`,
  };
}
