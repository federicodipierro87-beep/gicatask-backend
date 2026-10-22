import { PrismaClient } from '@prisma/client';
import { NoleggiService } from './noleggi.service.js';
import { NoleggioPdfService, formatGiorni, nomeFileNoleggio } from './noleggioPdf.service.js';
import { AllegatiNoleggioService, type FileNoleggio } from './allegatiNoleggio.service.js';
import { inviaEmail, isEmailConfigurata } from './email.service.js';
import type { EsitoEmail, StatoEmail } from './bollettinoEmail.service.js';
import { normalizzaEmail } from '../utils/email.js';

const MAX_ERRORE = 500;

/** Le foto finiscono anche nel PDF: insieme devono restare sotto i ~40 MB di Resend. */
const MAX_FOTO_BYTES = 15 * 1024 * 1024;

function escapeHtml(valore: string): string {
  return valore
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Invio del verbale di noleggio all'indirizzo di fatturazione. Stesso
 * contratto di `BollettinoEmailService`: **non lancia mai**, perche' viene
 * chiamato dopo che il verbale firmato e' gia' salvato.
 */
export class NoleggioEmailService {
  private noleggi: NoleggiService;
  private pdf: NoleggioPdfService;
  private allegati: AllegatiNoleggioService;

  constructor(private prisma: PrismaClient) {
    this.noleggi = new NoleggiService(prisma);
    this.pdf = new NoleggioPdfService();
    this.allegati = new AllegatiNoleggioService(prisma);
  }

  async invia(noleggioId: number, destinatarioGrezzo: string | null): Promise<EsitoEmail> {
    try {
      const grezzo = (destinatarioGrezzo ?? '').trim();

      if (!grezzo) {
        return { stato: 'NON_VALIDA', destinatario: null, messaggio: 'Nessun indirizzo di fatturazione' };
      }

      const destinatario = normalizzaEmail(grezzo);

      if (!destinatario) {
        await this.registra(noleggioId, {
          emailFatturazione: grezzo.slice(0, 254),
          emailStato: 'NON_VALIDA',
          emailErrore: 'Indirizzo non valido',
        });
        return { stato: 'NON_VALIDA', destinatario: grezzo, messaggio: 'L\'indirizzo indicato non sembra valido' };
      }

      if (!isEmailConfigurata()) {
        await this.registra(noleggioId, {
          emailFatturazione: destinatario,
          emailStato: 'NON_CONFIGURATA',
          emailErrore: 'RESEND_API_KEY o MAIL_FROM non impostate',
        });
        return { stato: 'NON_CONFIGURATA', destinatario, messaggio: 'L\'invio e-mail non è ancora attivo' };
      }

      const noleggio = await this.noleggi.getFull(noleggioId);
      if (!noleggio) {
        return { stato: 'ERRORE', destinatario, messaggio: 'Noleggio non trovato' };
      }

      // Se R2 non risponde la mail parte col solo PDF, che e' il documento
      let foto: FileNoleggio[] = [];
      try {
        foto = await this.allegati.fileDiNoleggio(noleggioId, MAX_FOTO_BYTES);
      } catch (error) {
        console.error(`[NoleggioEmail] Lettura foto ${noleggioId} fallita:`, error);
      }

      const pdfBuffer = await this.pdf.generate(noleggio, foto);
      const data = new Date(noleggio.data).toLocaleDateString('it-IT');
      // "dal ... al ..." coi verbali che hanno la data di ingresso
      const periodo = noleggio.dataIngresso
        ? `dal ${data} al ${new Date(noleggio.dataIngresso).toLocaleDateString('it-IT')}`
        : `del ${data}`;
      const durata = formatGiorni(noleggio.giorni).toLowerCase();

      const risultato = await inviaEmail({
        to: destinatario,
        subject: `Noleggio ${noleggio.veicoloNome} — ${noleggio.clienteNome} — ${data}`,
        html: [
          '<p>Buongiorno,</p>',
          `<p>in allegato il verbale del noleggio di <strong>${escapeHtml(noleggio.veicoloNome)}</strong> `,
          `per <strong>${escapeHtml(noleggio.clienteNome)}</strong>`,
          noleggio.cantiereNome ? ` (cantiere ${escapeHtml(noleggio.cantiereNome)})` : '',
          `, ${escapeHtml(periodo)}, durata ${escapeHtml(durata)}.</p>`,
          foto.length > 0 ? `<p>In allegato anche ${foto.length} foto.</p>` : '',
          '<p>Cordiali saluti.</p>',
        ].join(''),
        text: [
          'Buongiorno,',
          '',
          `in allegato il verbale del noleggio di ${noleggio.veicoloNome} per ${noleggio.clienteNome}` +
            (noleggio.cantiereNome ? ` (cantiere ${noleggio.cantiereNome})` : '') +
            `, ${periodo}, durata ${durata}.`,
          ...(foto.length > 0 ? [`In allegato anche ${foto.length} foto.`] : []),
          '',
          'Cordiali saluti.',
        ].join('\n'),
        attachments: [
          { filename: nomeFileNoleggio(noleggio), content: pdfBuffer.toString('base64') },
          ...foto.map((f) => ({ filename: f.nomeFile, content: f.buffer.toString('base64') })),
        ],
      });

      if (risultato.ok) {
        await this.registra(noleggioId, {
          emailFatturazione: destinatario,
          emailStato: 'INVIATA',
          emailInviataAt: new Date(),
          emailMessageId: risultato.messageId,
          emailErrore: null,
        });
        return { stato: 'INVIATA', destinatario };
      }

      const stato: StatoEmail = risultato.configurato ? 'ERRORE' : 'NON_CONFIGURATA';
      await this.registra(noleggioId, {
        emailFatturazione: destinatario,
        emailStato: stato,
        emailErrore: risultato.errore.slice(0, MAX_ERRORE),
      });

      return {
        stato,
        destinatario,
        messaggio: risultato.configurato ? 'Invio non riuscito' : 'L\'invio e-mail non è ancora attivo',
      };
    } catch (error) {
      const messaggio = error instanceof Error ? error.message : 'Errore';
      await this.registra(noleggioId, { emailStato: 'ERRORE', emailErrore: messaggio.slice(0, MAX_ERRORE) });
      return { stato: 'ERRORE', destinatario: null, messaggio: 'Invio non riuscito' };
    }
  }

  /** L'update non deve propagare: il verbale e' gia' salvato. */
  private async registra(
    id: number,
    data: {
      emailFatturazione?: string;
      emailStato: StatoEmail;
      emailInviataAt?: Date;
      emailMessageId?: string | null;
      emailErrore?: string | null;
    }
  ): Promise<void> {
    try {
      await this.prisma.noleggio.update({ where: { id }, data });
    } catch {
      // ignorato di proposito
    }
  }
}
