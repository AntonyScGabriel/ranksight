"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { mfa, type MfaStatus } from "@/lib/api";

const CodeInput = ({ value, onChange, recovery }: { value: string; onChange: (v: string) => void; recovery?: boolean }) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value.trim())}
    inputMode={recovery ? "text" : "numeric"}
    autoComplete="one-time-code"
    maxLength={recovery ? 9 : 6}
    placeholder={recovery ? "XXXX-XXXX" : "123456"}
    aria-label={recovery ? "Code de secours" : "Code à 6 chiffres"}
    className="input text-center font-mono text-xl tracking-[0.3em]"
    autoFocus
  />
);

/** Saisie du code pour déverrouiller l'administration (une fois par session et par 12 heures). */
export function MfaPrompt({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await mfa.verify(code);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 p-8 text-center">
        <h1 className="font-display text-2xl font-bold">Double authentification</h1>
        <p className="text-sm text-muted">
          {recovery ? "Saisis un de tes codes de secours (chacun ne sert qu'une fois)." : "Saisis le code à 6 chiffres affiché par ton application d'authentification."}
        </p>
        <CodeInput value={code} onChange={setCode} recovery={recovery} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button disabled={pending || code.length < 6} className="btn-primary w-full">{pending ? "Vérification…" : "Valider"}</button>
        <div className="flex justify-between text-xs">
          <button type="button" onClick={() => { setRecovery(!recovery); setCode(""); setError(null); }} className="text-muted hover:text-ink">
            {recovery ? "Utiliser l'application" : "Utiliser un code de secours"}
          </button>
          <button type="button" onClick={onLogout} className="text-muted hover:text-danger">Se déconnecter</button>
        </div>
      </form>
    </div>
  );
}

/** Activation, état et désactivation de la double authentification. */
export function MfaSettings({ status, onChange }: { status: MfaStatus; onChange: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!setup || setup.qr) return;
    QRCode.toDataURL(setup.uri, { margin: 1, width: 220 }).then((qr) => setSetup((s) => (s ? { ...s, qr } : s)), () => undefined);
  }, [setup]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (codes) {
    return (
      <div className="glass max-w-xl space-y-4 p-6">
        <h2 className="font-display text-xl font-semibold text-success">Double authentification activée</h2>
        <p className="text-sm">
          Garde ces <strong>codes de secours</strong> en lieu sûr (gestionnaire de mots de passe, papier). Chacun permet de te connecter
          une fois si tu perds ton téléphone. Ils ne seront plus affichés.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-lg">
          {codes.map((c) => <li key={c} className="rounded-lg bg-surface-2 px-3 py-2 text-center">{c}</li>)}
        </ul>
        <button onClick={() => { setCodes(null); onChange(); }} className="btn-primary">J&apos;ai enregistré mes codes</button>
      </div>
    );
  }

  if (status.enabled) {
    return (
      <div className="glass max-w-xl space-y-4 p-6">
        <h2 className="font-display text-xl font-semibold">Double authentification <span className="text-success">activée</span></h2>
        <p className="text-sm text-muted">
          Depuis le {status.enabledAt ? new Date(status.enabledAt).toLocaleDateString("fr-FR") : "—"} · {status.recoveryCodesLeft} code(s) de secours restant(s).
          {status.recoveryCodesLeft < 3 && " Pense à la désactiver puis la réactiver pour obtenir de nouveaux codes."}
        </p>
        {disabling ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await mfa.disable(code); setDisabling(false); setCode(""); onChange(); }); }} className="space-y-3">
            <p className="text-sm">Saisis un code de ton application (ou un code de secours) pour confirmer.</p>
            <CodeInput value={code} onChange={setCode} recovery={code.includes("-") || /[A-Za-z]/.test(code)} />
            <div className="flex gap-3">
              <button disabled={code.length < 6} className="btn-primary hover:!bg-danger">Désactiver</button>
              <button type="button" onClick={() => { setDisabling(false); setCode(""); }} className="btn-ghost">Annuler</button>
            </div>
          </form>
        ) : (
          !status.required && <button onClick={() => setDisabling(true)} className="btn-ghost text-danger">Désactiver la double authentification</button>
        )}
        {status.required && <p className="text-xs text-muted">Obligatoire pour l&apos;administration sur ce serveur : elle ne peut pas être désactivée ici.</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="glass max-w-xl space-y-4 p-6">
      <h2 className="font-display text-xl font-semibold">Activer la double authentification</h2>
      <p className="text-sm text-muted">
        Protège l&apos;administration même si ton mot de passe est volé : un code à 6 chiffres de ton téléphone sera demandé.
        Applications compatibles : Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden…
      </p>
      {!setup ? (
        <button onClick={() => run(async () => { const s = await mfa.setup(); setSetup({ ...s, qr: "" }); })} className="btn-primary">Commencer</button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await mfa.enable(code); setCodes(r.recoveryCodes); setSetup(null); setCode(""); }); }} className="space-y-4">
          <ol className="list-inside list-decimal space-y-2 text-sm">
            <li>Dans ton application, ajoute un compte en scannant ce QR code :</li>
          </ol>
          {setup.qr ? <img src={setup.qr} alt="QR code de configuration" width={220} height={220} className="rounded-lg bg-white p-2" /> : <div className="h-[220px] w-[220px] rounded-lg bg-surface-2" />}
          <p className="text-xs text-muted">Ou saisis cette clé à la main : <code className="select-all break-all text-ink">{setup.secret}</code></p>
          <p className="text-sm">2. Saisis le code à 6 chiffres affiché par l&apos;application :</p>
          <CodeInput value={code} onChange={setCode} />
          <button disabled={code.length !== 6} className="btn-primary">Activer</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
