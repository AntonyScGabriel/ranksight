import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { ConfirmProvider } from "@/lib/confirm";
// Polices hébergées avec le site (aucune requête vers Google Fonts : rien n'est transmis à un tiers)
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = { title: "RankGuess · Administration", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh">
        <ConfirmProvider>
          <AdminShell>{children}</AdminShell>
        </ConfirmProvider>
      </body>
    </html>
  );
}
