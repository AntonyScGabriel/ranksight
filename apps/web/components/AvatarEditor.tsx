"use client";

import { useRef, useState } from "react";
import { AVATAR_MAX_BYTES, AVATAR_TYPES, type FlairDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { Avatar } from "./Header";
import { errorMessage } from "./AuthForm";

/**
 * Photo de profil : choisir une image (JPEG, PNG ou WebP, 5 Mo max), recadrée en carré par le serveur,
 * ou revenir à l'initiale du pseudo.
 */
export function AvatarEditor({
  name, url, flair, onChanged,
}: { name: string; url: string | null; flair: FlairDto; onChanged: () => Promise<void> | void }) {
  const input = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return setError("Formats acceptés : JPEG, PNG ou WebP.");
    if (file.size > AVATAR_MAX_BYTES) return setError(`Image trop lourde (${AVATAR_MAX_BYTES / 1024 / 1024} Mo maximum).`);
    setPending(true);
    try {
      await api.uploadAvatar(file);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e, "La photo n'a pas pu être envoyée, réessaie."));
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: "Retirer ta photo ?", message: "L'initiale de ton pseudo sera affichée à la place.", confirmLabel: "Retirer" });
    if (ok === false) return;
    setPending(true);
    setError(null);
    try {
      await api.deleteAvatar();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        className="group relative mx-auto block w-fit rounded-full"
        aria-label="Changer la photo de profil"
      >
        <Avatar name={name} url={url} size={96} frame={flair.frame} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-void/70 text-xs font-semibold opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {pending ? "Envoi…" : "Changer"}
        </span>
      </button>
      <input ref={input} type="file" accept={AVATAR_TYPES.join(",")} className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <div className="flex justify-center gap-3 text-xs">
        <button type="button" onClick={() => input.current?.click()} disabled={pending} className="text-violet-soft hover:underline">
          {url ? "Changer la photo" : "Ajouter une photo"}
        </button>
        {url && (
          <button type="button" onClick={remove} disabled={pending} className="text-muted hover:text-danger">Retirer</button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
