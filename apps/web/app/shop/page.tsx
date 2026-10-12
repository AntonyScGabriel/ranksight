"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  VIP_PERKS, VIP_XP_MULTIPLIER, formatPrice, type GiftChoice, type PurchaseDto, type ShopDto, type UserSummaryDto, type VipProductId,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { ErrorPanel, LoginRequired, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

const PRODUCT_NAMES: Record<string, string> = {
  vip_1m: "VIP 1 mois", vip_3m: "VIP 3 mois", vip_12m: "VIP 12 mois", manual: "VIP offert par l'équipe", gift_code: "Code cadeau",
};
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const formatDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

type Product = ShopDto["products"][number];
type Notice = { text: string; ok: boolean; code?: string };

export default function ShopPage() {
  return (
    <Suspense>
      <Shop />
    </Suspense>
  );
}

/** Boutique : passes VIP (paiement par carte via Stripe), VIP à offrir, codes cadeaux, statut VIP et historique. */
function Shop() {
  const { me, loading, refresh } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const [shop, setShop] = useState<ShopDto | null>(null);
  const [purchases, setPurchases] = useState<PurchaseDto[]>([]);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<VipProductId | null>(null);
  const [giftFor, setGiftFor] = useState<Product | null>(null);
  const [message, setMessage] = useState<Notice | null>(
    params.get("cancelled") ? { text: "Paiement annulé : aucun montant n'a été débité.", ok: false } : null,
  );
  const codeFromLink = params.get("code") ?? "";

  const load = useCallback(() => {
    Promise.all([api.shop(), api.purchases()]).then(
      ([s, p]) => {
        setShop(s);
        setPurchases(p);
      },
      () => setFailed(true),
    );
  }, []);

  // Retour de la page de paiement : confirmation de l'achat
  const sessionId = params.get("session_id");
  useEffect(() => {
    if (!me) return;
    if (!sessionId) return load();
    api
      .confirmCheckout(sessionId)
      .then((r) => {
        if (r.status === "FAILED") setMessage({ text: "Le paiement n'a pas abouti : aucun montant n'a été débité.", ok: false });
        else if (r.status !== "PAID") setMessage({ text: "Paiement en cours de validation : ce sera prêt dans quelques instants.", ok: true });
        else if (r.gift?.code) setMessage({ text: "Merci ! Voici ton code cadeau à transmettre (il reste aussi dans « Mes achats ») :", ok: true, code: r.gift.code });
        else if (r.gift?.to) setMessage({ text: `Merci ! ${r.gift.to} a reçu son VIP et vient d'être prévenu.`, ok: true });
        else if (r.vip.until) setMessage({ text: `Merci ! Ton VIP est actif jusqu'au ${formatDate(r.vip.until)}.`, ok: true });
        void refresh();
      })
      .catch((e) => setMessage({ text: errorMessage(e, "Impossible de vérifier le paiement pour le moment."), ok: false }))
      .finally(() => {
        router.replace("/shop");
        load();
      });
  }, [me, sessionId, load, refresh, router]);

  const [waiver, setWaiver] = useState(false);

  const pay = async (product: VipProductId, gift?: GiftChoice) => {
    if (!waiver) {
      setGiftFor(null);
      setMessage({ text: "Coche la case d'exécution immédiate, au-dessus des offres, pour continuer.", ok: false });
      return;
    }
    setPending(product);
    setMessage(null);
    try {
      const { url } = await api.checkout(product, gift);
      window.location.assign(url);
    } catch (e) {
      setGiftFor(null);
      setMessage({ text: errorMessage(e, "Le paiement n'a pas pu démarrer, réessaie."), ok: false });
      setPending(null);
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next={codeFromLink ? `/shop?code=${encodeURIComponent(codeFromLink)}` : "/shop"} text="Connecte-toi pour accéder à la boutique." />;
  if (failed) return <ErrorPanel retry={() => { setFailed(false); load(); }} />;
  if (!shop) return <Skeleton />;

  const boost = Math.round((VIP_XP_MULTIPLIER - 1) * 100);

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold">Boutique</h1>
        <p className="max-w-2xl text-muted">
          Passe VIP et gagne <strong className="text-ink">+{boost} % d&apos;XP</strong> sur chaque réponse. Paiement unique par carte,
          sans abonnement ni renouvellement automatique. Tu peux aussi offrir le VIP à un ami.
        </p>
      </header>

      {shop.promo && (
        <div className="glass flex flex-wrap items-center gap-3 border-warn/50 p-4">
          <span className="rounded-full bg-warn/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-warn">{shop.promo.label}</span>
          <p className="text-sm">
            Les passes VIP sont <strong>en promo</strong>
            {shop.promo.endsAt ? <> jusqu&apos;au {formatDateTime(shop.promo.endsAt)}</> : ", pour une durée limitée"}.
          </p>
        </div>
      )}

      <div className={`glass flex flex-wrap items-center justify-between gap-3 p-5 ${shop.vip.active ? "border-warn/50" : ""}`}>
        <div className="flex items-center gap-3">
          {shop.vip.active && <VipBadge className="!text-xs" />}
          <p className="font-medium">
            {shop.vip.active && shop.vip.until
              ? `Tu es VIP jusqu'au ${formatDate(shop.vip.until)}. Un nouveau pass s'ajoute à cette date.`
              : "Tu n'es pas VIP pour le moment."}
          </p>
        </div>
      </div>

      {message && <NoticeBox notice={message} />}

      <label className="glass flex items-start gap-3 p-4 text-sm">
        <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet" />
        <span>
          Je demande l&apos;exécution immédiate après le paiement (activation du VIP ou remise du code cadeau) et je reconnais perdre
          mon droit de rétractation dès ce moment (article L221-28 13° du Code de la consommation). J&apos;accepte les{" "}
          <Link href="/legal/cgv" target="_blank" className="text-violet-soft underline">conditions générales de vente</Link>.
        </span>
      </label>

      <ul className="grid gap-4 md:grid-cols-3">
        {shop.products.map((p) => (
          <li key={p.id} className={`glass relative flex flex-col gap-4 p-6 ${p.id === "vip_3m" ? "border-warn/50" : ""}`}>
            {p.highlight && (
              <span className="absolute right-4 top-4 rounded-full bg-warn/15 px-2.5 py-0.5 text-xs font-semibold text-warn">{p.highlight}</span>
            )}
            <div>
              <p className="font-display text-xl font-semibold">{p.name}</p>
              <p className="text-sm text-muted">{p.days} jours de VIP</p>
            </div>
            <div>
              {shop.promo && p.regularPriceCents !== p.priceCents && (
                <p className="text-xs font-semibold uppercase tracking-wider text-warn">Prix promo · {shop.promo.label}</p>
              )}
              <p className="font-display text-4xl font-bold">{formatPrice(p.priceCents)}</p>
              {shop.promo && p.regularPriceCents !== p.priceCents && (
                <p className="text-xs text-muted">Puis {formatPrice(p.regularPriceCents)} à la fin de la promo</p>
              )}
            </div>
            <ul className="flex-1 space-y-1.5 text-sm text-muted">
              {VIP_PERKS.map((perk) => <li key={perk}>✓ {perk}</li>)}
            </ul>
            <div className="grid gap-2">
              <button onClick={() => pay(p.id)} disabled={!shop.paymentsEnabled || pending !== null} className="btn-primary w-full">
                {pending === p.id && !giftFor ? "Redirection…" : `Acheter · ${formatPrice(p.priceCents)}`}
              </button>
              <button onClick={() => setGiftFor(p)} disabled={!shop.paymentsEnabled || pending !== null} className="btn-ghost w-full">
                🎁 Offrir
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!shop.paymentsEnabled && <p className="text-sm text-muted">Le paiement par carte n&apos;est pas encore ouvert. Reviens bientôt !</p>}
      <p className="text-xs text-muted">Paiement sécurisé par Stripe : tes informations bancaires ne passent jamais par RankGuess. Le VIP ne change ni les scores ni les classements.</p>

      <RedeemForm initialCode={codeFromLink} onRedeemed={(text) => { setMessage({ text, ok: true }); void refresh(); load(); router.replace("/shop"); }} />

      {purchases.length > 0 && <Purchases items={purchases} />}

      {giftFor && (
        <GiftDialog
          product={giftFor}
          pending={pending === giftFor.id}
          onClose={() => pending === null && setGiftFor(null)}
          onPay={(gift) => pay(giftFor.id, gift)}
        />
      )}
    </section>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  return (
    <div role="status" className={`space-y-2 rounded-xl border p-3 text-sm ${notice.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>
      <p>{notice.text}</p>
      {notice.code && <GiftCodeValue code={notice.code} />}
    </div>
  );
}

/** Code cadeau avec bouton de copie (le code seul et le lien direct vers la boutique) */
function GiftCodeValue({ code, used = false }: { code: string; used?: boolean }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? code : `${window.location.origin}/shop?code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className={`rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-sm tracking-wider text-ink ${used ? "line-through opacity-60" : ""}`}>{code}</code>
      {used ? (
        <span className="text-xs text-muted">Déjà utilisé</span>
      ) : (
        <>
          <button type="button" onClick={() => copy("code")} className="text-xs text-violet-soft hover:underline">{copied === "code" ? "Copié !" : "Copier le code"}</button>
          <button type="button" onClick={() => copy("link")} className="text-xs text-violet-soft hover:underline">{copied === "link" ? "Lien copié !" : "Copier le lien"}</button>
        </>
      )}
    </span>
  );
}

/** Choix du destinataire : un ami (VIP ajouté directement) ou un code cadeau à transmettre */
function GiftDialog({ product, pending, onClose, onPay }: { product: Product; pending: boolean; onClose: () => void; onPay: (gift: GiftChoice) => void }) {
  const [friends, setFriends] = useState<UserSummaryDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<"friend" | "code">("friend");
  const [friendId, setFriendId] = useState("");

  useEffect(() => {
    api.friends().then(
      (list) => {
        setFriends(list);
        if (!list.length) setMode("code");
      },
      () => setLoadError(true),
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canPay = mode === "code" || !!friendId;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="gift-title" className="glass animate-rise w-full max-w-md space-y-4 p-6 shadow-2xl">
        <div>
          <h2 id="gift-title" className="font-display text-xl font-bold">Offrir le {product.name}</h2>
          <p className="text-sm text-muted">{product.days} jours de VIP · {formatPrice(product.priceCents)}</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="sr-only">Comment l&apos;offrir ?</legend>
          <label className={`flex items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-sm ${friends?.length ? "hover:bg-surface-2" : "opacity-60"}`}>
            <input type="radio" name="gift-mode" checked={mode === "friend"} disabled={!friends?.length} onChange={() => setMode("friend")} className="mt-0.5 accent-violet" />
            <span>
              <span className="block font-medium">À un ami</span>
              <span className="block text-xs text-muted">Son VIP est activé dès le paiement et il reçoit une notification.</span>
            </span>
          </label>
          {mode === "friend" && friends && friends.length > 0 && (
            <select value={friendId} onChange={(e) => setFriendId(e.target.value)} className="input" aria-label="Ami à qui offrir le VIP">
              <option value="">Choisis un ami…</option>
              {friends.map((f) => <option key={f.id} value={f.id}>{f.displayName}</option>)}
            </select>
          )}
          {friends && !friends.length && (
            <p className="text-xs text-muted">
              Ta liste d&apos;amis est vide : <Link href="/friends" className="text-violet-soft underline">ajoute des amis</Link> ou offre un code.
            </p>
          )}
          {loadError && <p className="text-xs text-danger">Ta liste d&apos;amis n&apos;a pas pu être chargée : tu peux offrir un code.</p>}
          <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-surface-2">
            <input type="radio" name="gift-mode" checked={mode === "code"} onChange={() => setMode("code")} className="mt-0.5 accent-violet" />
            <span>
              <span className="block font-medium">Avec un code cadeau</span>
              <span className="block text-xs text-muted">Tu reçois un code à transmettre à qui tu veux (par message, dans une carte…). Il s&apos;utilise une seule fois.</span>
            </span>
          </label>
        </fieldset>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={pending} className="btn-ghost">Annuler</button>
          <button
            onClick={() => onPay(mode === "friend" ? { type: "friend", friendId } : { type: "code" })}
            disabled={!canPay || pending}
            className="btn-primary"
          >
            {pending ? "Redirection…" : `Payer ${formatPrice(product.priceCents)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Utiliser un code cadeau (prérempli quand le joueur arrive par un lien /shop?code=…) */
function RedeemForm({ initialCode, onRedeemed }: { initialCode: string; onRedeemed: (text: string) => void }) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ pending: true, error: null });
    try {
      const r = await api.redeemGiftCode(code);
      setCode("");
      setState({ pending: false, error: null });
      onRedeemed(`${r.from ? `Cadeau de ${r.from} : ` : "Code validé : "}${r.days} jours de VIP ajoutés. Tu es VIP jusqu'au ${formatDate(r.until)}.`);
    } catch (err) {
      setState({ pending: false, error: errorMessage(err, "Ce code n'a pas pu être utilisé, réessaie.") });
    }
  };

  return (
    <form onSubmit={submit} id="code-cadeau" className={`glass space-y-3 p-5 ${initialCode ? "border-violet/60" : ""}`}>
      <div>
        <h2 className="font-display text-lg font-semibold">Tu as un code cadeau ?</h2>
        <p className="text-sm text-muted">Saisis-le ici : les jours de VIP s&apos;ajoutent tout de suite à ton compte.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="RG-XXXX-XXXX-XXXX"
          aria-label="Code cadeau"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          className="input min-w-[14rem] flex-1 font-mono tracking-wider"
        />
        <button type="submit" disabled={code.trim().length < 8 || state.pending} className="btn-primary">{state.pending ? "Vérification…" : "Utiliser le code"}</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

function Purchases({ items }: { items: PurchaseDto[] }) {
  return (
    <div className="space-y-3">
      <h2 className="hud-label">Mes achats et cadeaux</h2>
      <ul className="glass divide-y divide-line/60">
        {items.map((p) => (
          <li key={p.id} className="space-y-2 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {PRODUCT_NAMES[p.product] ?? p.product} · {p.days} jours
                {p.giftTo && <span className="text-violet-soft"> · offert à {p.giftTo}</span>}
                {p.giftFrom && <span className="text-violet-soft"> · cadeau de {p.giftFrom}</span>}
                {p.giftCode && <span className="text-violet-soft"> · code cadeau</span>}
              </span>
              <span className="text-muted">
                {new Date(p.createdAt).toLocaleDateString("fr-FR")} ·{" "}
                {p.giftFrom ? "Reçu" : p.redeemedCode ? "Code utilisé" : p.gift ? "Offert" : p.store === "google_play" ? "Google Play" : formatPrice(p.amountCents)}
                {p.status === "FAILED" && " · non abouti"}
                {p.status === "REFUNDED" && " · remboursé"}
              </span>
            </div>
            {p.giftCode && p.status === "PAID" && <GiftCodeValue code={p.giftCode.code} used={p.giftCode.used} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
