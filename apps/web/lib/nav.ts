/** Adresse interne uniquement : évite toute redirection vers un autre site après la connexion. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/play/daily";
}
