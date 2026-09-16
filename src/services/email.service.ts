import { config } from '../config/index.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Tetto duro alla chiamata di rete: questa sta dentro la POST che salva le
 * firme, quindi non puo' restare appesa. Difetto accettato: se Resend risponde
 * oltre il timeout la mail parte comunque ma noi la segniamo ERRORE, e un
 * reinvio produrrebbe un doppione. Fastidio, non perdita di dati.
 */
const TIMEOUT_MS = 10_000;

export interface AllegatoEmail {
  filename: string;
  /** Contenuto gia' codificato base64, senza prefisso `data:`. */
  content: string;
}

export interface MessaggioEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: AllegatoEmail[];
}

export type RisultatoInvio =
  | { ok: true; messageId: string | null }
  | { ok: false; errore: string; configurato: boolean };

export function isEmailConfigurata(): boolean {
  return Boolean(config.email.resendApiKey && config.email.from);
}

/**
 * Trasporto verso Resend con `fetch` nativo (Node >= 18), senza SDK: serve una
 * sola chiamata, una dipendenza in meno nella build e soprattutto un timeout
 * controllabile.
 *
 * Non lancia mai: l'esito e' sempre nel valore di ritorno.
 */
export async function inviaEmail(messaggio: MessaggioEmail): Promise<RisultatoInvio> {
  if (!isEmailConfigurata()) {
    return { ok: false, errore: 'Invio e-mail non configurato', configurato: false };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.email.from,
        to: [messaggio.to],
        ...(config.email.replyTo ? { reply_to: config.email.replyTo } : {}),
        subject: messaggio.subject,
        html: messaggio.html,
        text: messaggio.text,
        ...(messaggio.attachments?.length ? { attachments: messaggio.attachments } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const corpo = (await response.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!response.ok) {
      // `message`/`name` sono l'unica diagnosi utile: "domain is not verified",
      // "API key is invalid"... senza, i casi sono indistinguibili.
      const dettaglio = corpo?.message ?? corpo?.name ?? `HTTP ${response.status}`;
      return { ok: false, errore: dettaglio, configurato: true };
    }

    return { ok: true, messageId: corpo?.id ?? null };
  } catch (error) {
    const errore =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? `Timeout dopo ${TIMEOUT_MS / 1000}s`
          : error.message
        : 'Errore di rete';
    return { ok: false, errore, configurato: true };
  }
}
