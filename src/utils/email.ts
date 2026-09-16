/**
 * Regex volutamente piu' severa di RFC 5322: vieta virgole, spazi e i segni di
 * minore/maggiore perche' l'indirizzo finisce nel campo `to` dell'API Resend,
 * dove una virgola verrebbe letta come piu' destinatari.
 */
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>.]+(\.[^\s@,;<>.]+)+$/;

const MAX_LEN = 254;

/**
 * Normalizza un indirizzo scritto a mano. Non lancia mai: chi chiama deve
 * poter salvare il bollettino anche con un indirizzo sbagliato.
 */
export function normalizzaEmail(grezzo: string | null | undefined): string | null {
  if (typeof grezzo !== 'string') return null;

  const pulito = grezzo.trim().toLowerCase();
  if (!pulito || pulito.length > MAX_LEN) return null;

  return EMAIL_RE.test(pulito) ? pulito : null;
}
