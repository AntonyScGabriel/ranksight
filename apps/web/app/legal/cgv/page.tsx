import type { Metadata } from "next";
import { VIP_PERKS } from "@ranksight/shared";
import { LegalPage, Section } from "@/components/LegalPage";
import { VipPriceTable } from "@/components/VipPriceTable";
import { LEGAL, orMissing } from "@/lib/legal";

export const metadata: Metadata = { title: "Conditions générales de vente" };

export default function CgvPage() {
  return (
    <LegalPage title="Conditions générales de vente" current="/legal/cgv">
      <Section title="1. Vendeur">
        <p>
          {orMissing(LEGAL.publisherName)} — {orMissing(LEGAL.publisherStatus)} — {orMissing(LEGAL.address)} — SIRET {orMissing(LEGAL.siret)} —
          contact : {orMissing(LEGAL.email)}.
        </p>
      </Section>
      <Section title="2. Produits">
        <p>Passes VIP, achat unique sans abonnement ni renouvellement automatique :</p>
        <VipPriceTable />
        <p>
          Le prix appliqué est toujours celui affiché dans la boutique au moment de la commande. Une modification des prix
          (dont la fin d&apos;une offre) ne change pas les commandes déjà payées.
        </p>
        <p>Avantages : {VIP_PERKS.join(" ; ")}. Un pass acheté pendant un VIP en cours prolonge sa date de fin.</p>
        <p>
          Dans l&apos;application Android, le prix est celui affiché par Google Play au moment de l&apos;achat (dans la monnaie
          et avec les taxes du pays du compte Google).
        </p>
        <p>{LEGAL.vatNote}.</p>
      </Section>
      <Section title="3. Commande et paiement">
        <p>
          La commande se fait en étant connecté, depuis la boutique du site ou depuis l&apos;application Android. Sur le site, le
          paiement par carte est traité par Stripe ; dans l&apos;application Android, il est traité par Google Play, selon les
          conditions de Google. Dans les deux cas, les données bancaires ne transitent jamais par RankGuess. La commande est ferme
          dès la validation du paiement ; une confirmation est envoyée par email (et par Google pour un achat Google Play).
        </p>
      </Section>
      <Section title="4. Livraison">
        <p>
          Le VIP est activé immédiatement après le paiement sur le compte concerné (le sien ou celui de l&apos;ami à qui il est
          offert), sur le site et dans l&apos;application. Un code cadeau est affiché dès le paiement et envoyé par email.
        </p>
      </Section>
      <Section title="5. VIP offert et codes cadeaux">
        <p>
          Depuis la boutique du site, un pass peut être offert : à un joueur de sa liste d&apos;amis (le VIP est activé sur son
          compte dès le paiement et il en est prévenu), ou sous forme de code cadeau remis à l&apos;acheteur, qui le transmet à qui
          il veut. Un code s&apos;utilise une seule fois, depuis la boutique du site, par un compte à l&apos;adresse email
          vérifiée ; il n&apos;a pas de date de fin, n&apos;est ni échangeable contre de l&apos;argent ni remboursable une fois
          utilisé. L&apos;acheteur retrouve son code dans l&apos;historique de ses achats ; il lui appartient de le garder pour
          lui jusqu&apos;à ce qu&apos;il le transmette.
        </p>
        <p>
          Des codes peuvent aussi être distribués gratuitement par RankGuess (concours, partenariats) : leurs conditions
          (durée du VIP, date limite, nombre d&apos;utilisations) sont précisées lors de leur distribution.
        </p>
      </Section>
      <Section title="6. Droit de rétractation">
        <p>
          Le VIP est un contenu numérique fourni immédiatement. Conformément à l&apos;article L221-28 13° du Code de la consommation,
          avant de payer, tu demandes expressément son exécution immédiate et reconnais perdre ton droit de rétractation une fois
          le VIP activé ou le code cadeau remis (case à cocher sur le site, confirmation dans l&apos;application). Si le VIP n&apos;a pas pu être activé,
          contacte-nous : la commande est remboursée.
        </p>
        <p>
          Un achat fait dans l&apos;application Android peut aussi faire l&apos;objet d&apos;une demande de remboursement auprès de
          Google Play, selon les règles de Google. Un achat remboursé (par RankGuess ou par Google) retire du VIP les jours
          correspondants (sur le compte de l&apos;ami à qui il a été offert, le cas échéant) ; un code cadeau remboursé est désactivé.
        </p>
      </Section>
      <Section title="7. Garanties et réclamations">
        <p>
          Le VIP bénéficie de la garantie légale de conformité des contenus numériques (articles L224-25-12 et suivants du Code de
          la consommation). Pour toute réclamation : page <a href="/contact">Contact</a> ou {orMissing(LEGAL.email)}.
        </p>
      </Section>
      <Section title="8. Médiation">
        <p>
          En cas de litige non résolu, tu peux recourir gratuitement au médiateur de la consommation :{" "}
          {LEGAL.mediatorName ? (LEGAL.mediatorUrl ? <a href={LEGAL.mediatorUrl}>{LEGAL.mediatorName}</a> : LEGAL.mediatorName) : "Non renseigné"}.
          Plateforme européenne de règlement en ligne des litiges : <a href="https://ec.europa.eu/consumers/odr">ec.europa.eu/consumers/odr</a>.
        </p>
      </Section>
      <Section title="9. Droit applicable">
        <p>Droit français. Ces conditions s&apos;appliquent à toute commande passée depuis leur date de mise à jour.</p>
      </Section>
    </LegalPage>
  );
}
