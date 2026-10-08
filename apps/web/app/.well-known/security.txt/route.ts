/** /.well-known/security.txt (RFC 9116) : où signaler une faille de sécurité */
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export const dynamic = "force-static";

export function GET() {
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const body = [
    `Contact: ${site}/contact`,
    `Expires: ${expires}`,
    "Preferred-Languages: fr, en",
    `Canonical: ${site}/.well-known/security.txt`,
    `Policy: ${site}/faq`,
  ].join("\n");
  return new Response(`${body}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
