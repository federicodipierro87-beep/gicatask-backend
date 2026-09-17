import { PrismaClient } from '@prisma/client';
import { BollettiniService } from './bollettini.service.js';
import { BollettinoPdfService, nomeFilePdf } from './bollettinoPdf.service.js';
import { AllegatiBollettinoService } from './allegatiBollettino.service.js';
import { inviaEmail, isEmailConfigurata } from './email.service.js';
import { normalizzaEmail } from '../utils/email.js';

export type StatoEmail = 'IN_CORSO' | 'INVIATA' | 'ERRORE' | 'NON_VALIDA' | 'NON_CONFIGURATA';

export interface EsitoEmail {
  stato: StatoEmail;
  destinatario: string | null;
  messaggio?: string;
}

/** La colonna e' Text, ma un errore di 8 KB non aiuta nessuno. */
const MAX_ERRORE = 500;

/** Oltre questo totale gli allegati vengono lasciati fuori: la mail rimbalza. */
const MAX_ALLEGATI_BYTES = 15 * 1024 * 1024;

function tronca(valore: string, max: number): string {
  return valore.length > max ? valore.slice(0, max) : valore;
}

function escapeHtml(valore: string): string {
  return valore
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Orchestrazione dell'invio del PDF al committente.
 *
 * Contratto: **non lancia mai**. Viene chiamato dopo che il bollettino firmato
 * e' gia' stato salvato, e nessun suo fallimento deve poter essere letto dal
 * client come "salvataggio fallito": l'operatore rifirmerebbe tutto.
 */
export class BollettinoEmailService {
  private bollettini: BollettiniService;
  private pdf: BollettinoPdfService;
  private allegati: AllegatiBollettinoService;

  constructor(private prisma: PrismaClient) {
    this.bollettini = new BollettiniService(prisma);
    this.pdf = new BollettinoPdfService();
    this.allegati = new AllegatiBollettinoService(prisma);
  }

  async invia(bollettinoId: number, destinatarioGrezzo: string | null): Promise<EsitoEmail> {
    try {
      const grezzo = (destinatarioGrezzo ?? '').trim();

      // Nessun indirizzo richiesto: non c'e' niente da registrare
      if (!grezzo) {
        return { stato: 'NON_VALIDA', destinatario: null, messaggio: 'Nessun indirizzo indicato' };
      }

      const destinatario = normalizzaEmail(grezzo);

      if (!destinatario) {
        // Si conserva il grezzo: serve al responsabile per correggerlo
        await this.registra(bollettinoId, {
          emailDestinatario: tronca(grezzo, 254),
          emailStato: 'NON_VALIDA',
          emailErrore: 'Indirizzo non valido',
        });
        return {
          stato: 'NON_VALIDA',
          destinatario: grezzo,
          messaggio: 'L\'indirizzo indicato non sembra valido',
        };
      }

      if (!isEmailConfigurata()) {
        await this.registra(bollettinoId, {
          emailDestinatario: destinatario,
          emailStato: 'NON_CONFIGURATA',
          emailErrore: 'RESEND_API_KEY o MAIL_FROM non impostate',
        });
        return {
          stato: 'NON_CONFIGURATA',
          destinatario,
          messaggio: 'L\'invio e-mail non è ancora attivo',
        };
      }

      const bollettino = await this.bollettini.getFull(bollettinoId);

      if (!bollettino) {
        return { stato: 'ERRORE', destinatario, messaggio: 'Bollettino non trovato' };
      }

      const pdfBuffer = await this.pdf.generateSingolo(bollettino);
      const data = new Date(bollettino.dataRiferimento).toLocaleDateString('it-IT');

      // try/catch proprio: se R2 non risponde la mail parte comunque col solo
      // PDF, che e' il documento che conta
      let fileAllegati: { nomeFile: string; buffer: Buffer }[] = [];
      try {
        fileAllegati = await this.allegati.fileDiBollettino(bollettinoId, MAX_ALLEGATI_BYTES);
      } catch (error) {
        console.error(`[BollettinoEmail] Lettura allegati ${bollettinoId} fallita:`, error);
      }

      // Senza cantiere l'oggetto lo salta del tutto: un trattino con niente in
      // mezzo sembrerebbe un campo non compilato
      const riferimento = bollettino.cantiereNome
        ? `${bollettino.clienteNome} — ${bollettino.cantiereNome}`
        : bollettino.clienteNome;

      const risultato = await inviaEmail({
        to: destinatario,
        subject: `Bollettino ${riferimento} — ${data}`,
        // Niente immagini remote ne' link: peggiorerebbero il punteggio antispam
        html: this.corpoHtml(bollettino.clienteNome, bollettino.cantiereNome, data, fileAllegati.length),
        text: this.corpoTesto(bollettino.clienteNome, bollettino.cantiereNome, data, fileAllegati.length),
        attachments: [
          { filename: nomeFilePdf(bollettino), content: pdfBuffer.toString('base64') },
          ...fileAllegati.map((a) => ({
            filename: a.nomeFile,
            content: a.buffer.toString('base64'),
          })),
        ],
      });

      if (risultato.ok) {
        await this.registra(bollettinoId, {
          emailDestinatario: destinatario,
          emailStato: 'INVIATA',
          emailInviataAt: new Date(),
          emailMessageId: risultato.messageId,
          emailErrore: null,
        });
        return { stato: 'INVIATA', destinatario };
      }

      await this.registra(bollettinoId, {
        emailDestinatario: destinatario,
        emailStato: risultato.configurato ? 'ERRORE' : 'NON_CONFIGURATA',
        emailErrore: tronca(risultato.errore, MAX_ERRORE),
      });

      // Il dettaglio tecnico resta in DB e lo vede solo il responsabile
      return {
        stato: risultato.configurato ? 'ERRORE' : 'NON_CONFIGURATA',
        destinatario,
        messaggio: risultato.configurato
          ? 'Invio non riuscito'
          : 'L\'invio e-mail non è ancora attivo',
      };
    } catch (error) {
      const messaggio = error instanceof Error ? error.message : 'Errore';
      await this.registra(bollettinoId, {
        emailStato: 'ERRORE',
        emailErrore: tronca(messaggio, MAX_ERRORE),
      });
      return { stato: 'ERRORE', destinatario: null, messaggio: 'Invio non riuscito' };
    }
  }

  /** L'update non deve propagare: il bollettino e' gia' salvato. */
  private async registra(
    id: number,
    data: {
      emailDestinatario?: string;
      emailStato: StatoEmail;
      emailInviataAt?: Date;
      emailMessageId?: string | null;
      emailErrore?: string | null;
    }
  ): Promise<void> {
    try {
      await this.prisma.bollettino.update({ where: { id }, data });
    } catch {
      // ignorato di proposito
    }
  }

  private corpoHtml(
    cliente: string,
    cantiere: string | null,
    data: string,
    numeroAllegati: number
  ): string {
    const riferimento = cantiere
      ? ` per il cantiere <strong>${escapeHtml(cantiere)}</strong> (${escapeHtml(cliente)})`
      : ` per il cliente <strong>${escapeHtml(cliente)}</strong>`;

    return [
      '<p>Buongiorno,</p>',
      `<p>in allegato il bollettino dei lavori del <strong>${escapeHtml(data)}</strong>`,
      `${riferimento}.</p>`,
      '<p>Il documento è firmato dall\'operatore e dal committente.</p>',
      ...(numeroAllegati > 0
        ? [`<p>In allegato anche ${numeroAllegati} file.</p>`]
        : []),
      '<p>Cordiali saluti.</p>',
    ].join('');
  }

  private corpoTesto(
    cliente: string,
    cantiere: string | null,
    data: string,
    numeroAllegati: number
  ): string {
    const riferimento = cantiere
      ? `per il cantiere ${cantiere} (${cliente})`
      : `per il cliente ${cliente}`;

    return [
      'Buongiorno,',
      '',
      `in allegato il bollettino dei lavori del ${data} ${riferimento}.`,
      'Il documento è firmato dall\'operatore e dal committente.',
      ...(numeroAllegati > 0 ? [`In allegato anche ${numeroAllegati} file.`] : []),
      '',
      'Cordiali saluti.',
    ].join('\n');
  }
}
