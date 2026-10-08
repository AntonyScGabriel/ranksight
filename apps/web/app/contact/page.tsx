"use client";

import { useState } from "react";
import { ContactInput } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage, FormError } from "@/components/AuthForm";
import { LegalPage } from "@/components/LegalPage";

/** Formulaire de contact : transmis par email à l'équipe. */
export default function ContactPage() {
  const { me } = useSession();
  const [form, setForm] = useState({ email: "", subject: "", message: "", website: "" });
  const [state, setState] = useState<{ pending?: boolean; done?: boolean; error?: string | null }>({});
  const email = form.email || me?.email || "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ContactInput.safeParse({ ...form, email });
    if (!parsed.success) return setState({ error: parsed.error.issues[0]?.message ?? "Formulaire incomplet." });
    setState({ pending: true });
    try {
      await api.contact({ ...form, email });
      setState({ done: true });
    } catch (err) {
      setState({ error: errorMessage(err, "Le message n'a pas pu être envoyé, réessaie dans un instant.") });
    }
  };

  return (
    <LegalPage title="Contact">
      {state.done ? (
        <p className="text-success">Merci, ton message a bien été envoyé. Nous te répondrons par email.</p>
      ) : (
        <form onSubmit={submit} className="max-w-xl space-y-4" noValidate>
          <p className="text-sm text-muted">Question, bug, faille de sécurité, droits sur un clip, données personnelles : écris-nous.</p>
          <label className="block space-y-1.5 text-sm">
            <span>Ton email</span>
            <input type="email" required value={email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" autoComplete="email" />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Objet</span>
            <input required maxLength={120} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="input" />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Message</span>
            <textarea required maxLength={3000} rows={7} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="input" />
          </label>
          {/* Champ piège invisible pour les robots */}
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="absolute left-[-9999px] h-0 w-0 opacity-0" name="website" />
          <FormError message={state.error ?? null} />
          <button disabled={state.pending} className="btn-primary">{state.pending ? "Envoi…" : "Envoyer"}</button>
        </form>
      )}
    </LegalPage>
  );
}
