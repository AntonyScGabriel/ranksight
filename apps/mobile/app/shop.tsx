import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { VIP_PERKS, VIP_XP_MULTIPLIER, formatPrice, type ShopDto, type VipProductId } from "@ranksight/shared";
import { api } from "@/lib/api";
import { PLAY_BILLING_PLATFORM, usePlayBilling, type BillingResult } from "@/lib/billing";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { Card, GhostButton, Hud, Loading, Message, PrimaryButton } from "@/components/ui";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Écran VIP. Sur Android, les pass VIP s'achètent avec Google Play Billing (obligatoire pour un avantage numérique vendu
 * dans une application du Play Store) ; le serveur vérifie chaque achat auprès de Google avant d'activer le VIP.
 * Sur iPhone, l'écran affiche le statut VIP et ses avantages. Le VIP est lié au compte : il vaut aussi sur le site.
 */
export default function ShopScreen() {
  const { me, refresh } = useSession();
  const confirm = useConfirm();
  const [shop, setShop] = useState<ShopDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    api.shop().then((s) => {
      setShop(s);
      setFailed(false);
    }, () => setFailed(true));
  }, []);
  useFocusEffect(load);

  const onResult = useCallback(
    (r: BillingResult) => {
      if (r.kind === "paid") {
        setMessage({ text: r.vip.until ? `Merci ! Ton VIP est actif jusqu'au ${formatDate(r.vip.until)}.` : "Merci ! Ton achat est validé.", ok: true });
        void refresh();
        load();
      } else if (r.kind === "pending") {
        setMessage({ text: "Paiement en attente de validation par Google Play. Ton VIP sera activé dès qu'il sera confirmé.", ok: true });
      } else {
        setMessage({ text: r.message, ok: false });
      }
    },
    [refresh, load],
  );
  const billing = usePlayBilling(PLAY_BILLING_PLATFORM && shop?.googlePlayEnabled ? (me?.id ?? null) : null, onResult);

  const buy = async (product: VipProductId) => {
    const ok = await confirm({
      title: "Accès immédiat au VIP",
      message:
        "Je demande l'activation immédiate du VIP après le paiement via Google Play et je reconnais perdre mon droit de rétractation dès son activation (article L221-28 13° du Code de la consommation). J'accepte les conditions générales de vente.",
      confirmLabel: "Continuer vers le paiement",
    });
    if (ok === false) return;
    setMessage(null);
    await billing.buy(product);
  };

  if (failed && !shop) {
    return (
      <View style={{ padding: 16 }}>
        <Message title="Connexion au serveur impossible" text="Vérifie ta connexion internet puis réessaie.">
          <GhostButton label="Réessayer" onPress={load} />
        </Message>
      </View>
    );
  }
  if (!shop) return <Loading />;

  const storeOpen = PLAY_BILLING_PLATFORM && shop.googlePlayEnabled && billing.state !== "unavailable";

  if (!storeOpen) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Card style={{ borderColor: shop.vip.active ? colors.warn : colors.line, gap: 6 }}>
          <Text style={{ color: shop.vip.active ? colors.warn : colors.ink, fontSize: 18, fontWeight: "700" }}>
            {shop.vip.active && shop.vip.until ? `Tu es VIP jusqu'au ${formatDate(shop.vip.until)}` : "Tu n'es pas VIP pour le moment"}
          </Text>
          <Text style={{ color: colors.muted }}>Le statut VIP est lié à ton compte : il s&apos;applique sur le site et dans l&apos;application.</Text>
        </Card>
        {message && <Text style={{ color: message.ok ? colors.success : colors.danger }}>{message.text}</Text>}
        <Card style={{ gap: 8 }}>
          <Hud>Avantages VIP</Hud>
          {VIP_PERKS.map((perk) => <Text key={perk} style={{ color: colors.ink }}>✓ {perk}</Text>)}
        </Card>
        {PLAY_BILLING_PLATFORM && (
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {shop.googlePlayEnabled
              ? "L'achat du VIP est disponible dans la version de l'application installée depuis Google Play."
              : "L'achat du VIP dans l'application n'est pas encore ouvert. Reviens bientôt !"}
          </Text>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Text style={{ color: colors.muted, lineHeight: 20 }}>
        Passe VIP et gagne +{Math.round((VIP_XP_MULTIPLIER - 1) * 100)} % d&apos;XP sur chaque réponse. Paiement unique, sans abonnement.
      </Text>
      <Card style={{ borderColor: shop.vip.active ? colors.warn : colors.line }}>
        <Text style={{ color: colors.ink, fontWeight: "600" }}>
          {shop.vip.active && shop.vip.until ? `Tu es VIP jusqu'au ${formatDate(shop.vip.until)}.` : "Tu n'es pas VIP pour le moment."}
        </Text>
      </Card>
      {message && <Text style={{ color: message.ok ? colors.success : colors.danger }}>{message.text}</Text>}
      {shop.products.map((p) => {
        // Prix affiché par Google Play (monnaie et taxes du pays du joueur), à défaut le prix de référence
        const price = billing.prices[p.id] ?? formatPrice(p.priceCents);
        return (
          <View key={p.id} style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: p.id === "vip_3m" ? colors.warn : colors.line, padding: 16, gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>{p.name}</Text>
              {p.highlight && <Text style={{ color: colors.warn, fontWeight: "700" }}>{p.highlight}</Text>}
            </View>
            {shop.launchOffer && <Text style={{ color: colors.warn, fontSize: 12, fontWeight: "700", letterSpacing: 0.8 }}>PRIX DE LANCEMENT · DURÉE LIMITÉE</Text>}
            <Text style={{ color: colors.ink, fontSize: 30, fontWeight: "800" }}>{price}</Text>
            <Hud>{p.days} jours de VIP</Hud>
            {VIP_PERKS.map((perk) => <Text key={perk} style={{ color: colors.muted }}>✓ {perk}</Text>)}
            <PrimaryButton
              label={billing.state === "connecting" ? "Connexion à Google Play…" : billing.busy === p.id ? "Paiement en cours…" : `Acheter · ${price}`}
              onPress={() => buy(p.id)}
              disabled={billing.state !== "ready" || !billing.prices[p.id] || billing.busy !== null}
            />
          </View>
        );
      })}
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Paiement sécurisé par Google Play : tes informations bancaires ne passent jamais par RankGuess. Le VIP ne change ni les scores ni les classements.
      </Text>
    </ScrollView>
  );
}
