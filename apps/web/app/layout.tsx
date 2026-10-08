import type { Metadata, Viewport } from "next";
import { AccountGates } from "@/components/AccountGates";
import { Footer } from "@/components/Footer";
import { ErrorReporting } from "@/components/ErrorReporting";
import { Header } from "@/components/Header";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import { ChatProvider } from "@/lib/chat";
import { ConfirmProvider } from "@/lib/confirm";
import { SessionProvider } from "@/lib/session";
// Polices hébergées avec le site (aucune requête vers Google Fonts : rien n'est transmis à un tiers)
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "RankGuess — Devine le rang", template: "%s · RankGuess" },
  applicationName: "RankGuess",
  keywords: ["rankdle", "deviner le rang", "League of Legends", "Valorant", "Rocket League", "Counter-Strike 2", "jeu", "clips"],
  alternates: { canonical: "/" },
  description: "League of Legends, Valorant, Rocket League, Counter-Strike 2 : regarde un clip, devine le rang du joueur, bats tes amis.",
  // Aperçu des liens partagés (Discord, X, WhatsApp…) : image app/opengraph-image.png
  openGraph: { type: "website", siteName: "RankGuess", locale: "fr_FR", title: "RankGuess — Devine le rang" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#07060b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh">
        <SessionProvider>
          <ConfirmProvider>
            <ChatProvider>
              <Header />
              <AnnouncementBar />
              <AccountGates />
              <main className="mx-auto max-w-6xl px-4 pb-10 pt-8">{children}</main>
              <Footer />
              <ErrorReporting />
            </ChatProvider>
          </ConfirmProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
