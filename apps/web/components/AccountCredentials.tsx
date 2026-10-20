"use client";

import { useState } from "react";
import { ChangePasswordInput, Email, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { errorMessage } from "./AuthForm";

type Open = "none" | "password" | "email";

/**
 * Profil : changer de mot de passe (l'actuel est demandé, toutes les sessions sont ensuite fermées) ou d'adresse email
 * (remplacée une fois la nouvelle confirmée par le lien qui lui est envoyé).
 */
export function AccountCredentials() {
  const [open, setOpen] = useState<Open>("none");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const toggle = (o: Open) => {
    setOpen((v) => (v === o ? "none" : o));
    setCurrent("");
    setPassword("");
    setConfirmPw("");
    setEmail("");
    setNotice(null);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ChangePasswordInput.safeParse({ currentPassword: current, password, passwordConfirm: confirmPw });
    if (!parsed.success) return setNotice({ text: firstIssue(parsed.error), ok: false });
    setPending(true);
    setNotice(null);
    try {
      await api.changePassword(parsed.data);
      // Toutes les sessions sont fermées : reconnexion avec le nouveau mot de passe
      window.location.assign("/login?motdepasse=1");
    } catch (err) {
      setNotice({ text: errorMessage(err), ok: false });
      setPending(false);
    }
  };

  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Email.safeParse(email);
    if (!parsed.success) return setNotice({ text: firstIssue(parsed.error), ok: false });
    if (!current) return setNotice({ text: "Indique ton mot de passe actuel.", ok: false });
    setPending(true);
    setNotice(null);
    try {
      const r = await api.changeEmail(parsed.data, current);
      setNotice({
        text: r.pending
          ? `Un lien de confirmation a été envoyé à ${parsed.data}. Ton adresse changera dès que tu l'auras ouvert.`
          : `Adresse corrigée : un lien de confirmation a été envoyé à ${parsed.data}.`,
        ok: true,
      });
      setCurrent("");
      setEmail("");
    } catch (err) {
      setNotice({ text: errorMessage(err), ok: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => toggle("password")} aria-expanded={open === "password"} className="btn-ghost justify-center text-sm">
          Changer de mot de passe
        </button>
        <button type="button" onClick={() => toggle("email")} aria-expanded={open === "email"} className="btn-ghost justify-center text-sm">
          Changer d&apos;email
        </button>
      </div>

      {open === "password" && (
        <form onSubmit={changePassword} className="space-y-2" data-testid="change-password">
          <input type="password" autoComplete="current-password" placeholder="Mot de passe actuel" value={current} onChange={(e) => setCurrent(e.target.value)} className="input" />
          <input type="password" autoComplete="new-password" placeholder="Nouveau mot de passe (8 caractères, une lettre, un chiffre)" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
          <input type="password" autoComplete="new-password" placeholder="Confirme le nouveau mot de passe" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="input" />
          <p className="text-xs text-muted">Tous tes appareils seront déconnectés : tu te reconnecteras avec le nouveau mot de passe.</p>
          <button disabled={pending} className="btn-primary w-full">{pending ? "Enregistrement…" : "Enregistrer le mot de passe"}</button>
        </form>
      )}

      {open === "email" && (
        <form onSubmit={changeEmail} className="space-y-2" data-testid="change-email">
          <input type="email" autoComplete="email" placeholder="Nouvelle adresse email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          <input type="password" autoComplete="current-password" placeholder="Mot de passe actuel" value={current} onChange={(e) => setCurrent(e.target.value)} className="input" />
          <p className="text-xs text-muted">
            Compte Google ou Discord sans mot de passe : crée-en un d&apos;abord avec « Mot de passe oublié » sur la page de connexion.
          </p>
          <button disabled={pending} className="btn-primary w-full">{pending ? "Envoi…" : "Envoyer le lien de confirmation"}</button>
        </form>
      )}

      {notice && <p role="status" className={`text-xs ${notice.ok ? "text-success" : "text-danger"}`}>{notice.text}</p>}
    </div>
  );
}
