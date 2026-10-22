import { Prisma, PrismaClient, Carburante } from '@prisma/client';
import { AllegatiNoleggioService } from './allegatiNoleggio.service.js';
import { normalizzaEmail } from '../utils/email.js';

/** Mezza giornata, poi giorni interi fino a 90. */
export const GIORNI_MAX = 90;

export function giorniValidi(giorni: number): boolean {
  return giorni === 0.5 || (Number.isInteger(giorni) && giorni >= 1 && giorni <= GIORNI_MAX);
}

export interface CreateNoleggioInput {
  utenteId: number;
  /** Data di uscita del veicolo. */
  data: Date;
  dataIngresso: Date;
  cantiereNome?: string | null;
  salvaCantiere?: boolean;
  clienteNome: string;
  salvaCliente?: boolean;
  veicoloNome: string;
  salvaVeicolo?: boolean;
  giorni: number;
  pieno: boolean;
  carburante?: string | null;
  danni: boolean;
  danniNote?: string | null;
  emailFatturazione?: string | null;
  aggiornaEmailCliente?: boolean;
  firmaNome: string;
  firmaImg: string;
  scontrinoIds?: number[];
  danniIds?: number[];
  emailStato?: string | null;
}

export interface NoleggioFilters {
  utenteId?: number;
  startDate?: Date;
  endDate?: Date;
}

/** Senza la firma: e' un PNG base64 da decine di KB, serve solo al PDF. */
const listSelect = {
  id: true,
  utenteId: true,
  data: true,
  dataIngresso: true,
  cantiereId: true,
  cantiereNome: true,
  clienteId: true,
  clienteNome: true,
  veicoloId: true,
  veicoloNome: true,
  giorni: true,
  pieno: true,
  carburante: true,
  danni: true,
  danniNote: true,
  emailFatturazione: true,
  firmaNome: true,
  emailStato: true,
  emailInviataAt: true,
  emailErrore: true,
  createdAt: true,
  utente: { select: { id: true, nome: true, cognome: true } },
  allegati: {
    select: { id: true, tipo: true, nomeFile: true, mimeType: true, dimensione: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.NoleggioSelect;

const fullSelect = { ...listSelect, firmaImg: true } satisfies Prisma.NoleggioSelect;

export type NoleggioFull = Prisma.NoleggioGetPayload<{ select: typeof fullSelect }>;

/** Spazi doppi e a capo ridotti: il nome finisce in anagrafica e nel PDF. */
function pulisciNome(valore: string | null | undefined, max = 200): string {
  return (valore ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const insensibile = (nome: string) => ({ equals: nome, mode: 'insensitive' as const });

export class NoleggiService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Suggerimenti del form: clienti coi loro cantieri e l'indirizzo di
   * fatturazione, veicoli della Banca dati. Solo le voci attive.
   */
  async anagrafiche() {
    const [clienti, veicoli] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { attivo: true },
        select: {
          id: true,
          nome: true,
          emailFatturazione: true,
          cantieri: {
            where: { attivo: true },
            select: { id: true, nome: true },
            orderBy: { nome: 'asc' },
          },
        },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.dreamVeicolo.findMany({
        where: { attivo: true },
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      }),
    ]);

    return { clienti, veicoli };
  }

  async getAll(filters: NoleggioFilters) {
    return this.prisma.noleggio.findMany({
      where: {
        ...(filters.utenteId ? { utenteId: filters.utenteId } : {}),
        ...(filters.startDate || filters.endDate
          ? {
              data: {
                ...(filters.startDate ? { gte: filters.startDate } : {}),
                ...(filters.endDate ? { lte: filters.endDate } : {}),
              },
            }
          : {}),
      },
      select: listSelect,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
    });
  }

  async getById(id: number) {
    return this.prisma.noleggio.findUnique({ where: { id }, select: listSelect });
  }

  async getFull(id: number): Promise<NoleggioFull | null> {
    return this.prisma.noleggio.findUnique({ where: { id }, select: fullSelect });
  }

  /**
   * Salva il verbale firmato. Cantiere, cliente e veicolo sono testo libero:
   * se il nome corrisponde a una voce di anagrafica (maiuscole a parte) il
   * verbale la collega; se non c'e' e l'operatore ha chiesto di salvarla, la
   * crea. Tutto in una transazione: o si salva il verbale con le anagrafiche,
   * o niente.
   *
   * Lancia Error con un messaggio leggibile, che la rotta gira come 400.
   */
  async create(input: CreateNoleggioInput): Promise<{ id: number }> {
    const clienteNome = pulisciNome(input.clienteNome);
    const cantiereNome = pulisciNome(input.cantiereNome) || null;
    const veicoloNome = pulisciNome(input.veicoloNome);

    if (!clienteNome) throw new Error('Indica il cliente');
    if (!veicoloNome) throw new Error('Indica il veicolo');
    if (input.dataIngresso < input.data) {
      throw new Error('La data di ingresso non può essere prima della data di uscita');
    }
    if (!giorniValidi(input.giorni)) {
      throw new Error(`I giorni vanno da mezza giornata a ${GIORNI_MAX}`);
    }

    let carburante: Carburante | null = null;
    if (input.pieno) {
      if (input.carburante !== 'DIESEL' && input.carburante !== 'BENZINA') {
        throw new Error('Indica se il pieno è di diesel o di benzina');
      }
      carburante = input.carburante;
    }

    if (!input.firmaNome.trim() || !input.firmaImg) {
      throw new Error('Manca la firma di chi ha effettuato il noleggio');
    }

    const email = (input.emailFatturazione ?? '').trim();
    const emailNormalizzata = normalizzaEmail(email);

    // Le foto valgono solo se la casella corrispondente e' spuntata: quelle
    // rimaste fuori restano orfane e la pulizia notturna le cancella
    const scontrinoIds = input.pieno ? (input.scontrinoIds ?? []).slice(0, 10) : [];
    const danniIds = input.danni ? (input.danniIds ?? []).slice(0, 10) : [];

    return this.prisma.$transaction(async (tx) => {
      // Cliente
      let cliente = await tx.cliente.findFirst({
        where: { nome: insensibile(clienteNome) },
        select: { id: true, attivo: true },
        // Prima gli attivi: con un omonimo disattivato si collega quello in uso
        orderBy: [{ attivo: 'desc' }, { id: 'asc' }],
      });

      if (!cliente && input.salvaCliente) {
        cliente = await tx.cliente.create({
          data: { nome: clienteNome },
          select: { id: true, attivo: true },
        });
      } else if (cliente && !cliente.attivo && input.salvaCliente) {
        await tx.cliente.update({ where: { id: cliente.id }, data: { attivo: true } });
      }

      // Cantiere: in anagrafica sta sotto un cliente, quindi senza cliente
      // salvato resta solo testo
      let cantiereId: number | null = null;
      if (cantiereNome && cliente) {
        let cantiere = await tx.cantiere.findFirst({
          where: { clienteId: cliente.id, nome: insensibile(cantiereNome) },
          select: { id: true, attivo: true },
          orderBy: [{ attivo: 'desc' }, { id: 'asc' }],
        });

        if (!cantiere && input.salvaCantiere) {
          cantiere = await tx.cantiere.create({
            data: { clienteId: cliente.id, nome: cantiereNome },
            select: { id: true, attivo: true },
          });
        } else if (cantiere && !cantiere.attivo && input.salvaCantiere) {
          await tx.cantiere.update({ where: { id: cantiere.id }, data: { attivo: true } });
        }

        cantiereId = cantiere?.id ?? null;
      }

      // Veicolo: il nome e' unico nella Banca dati veicoli
      let veicolo = await tx.dreamVeicolo.findFirst({
        where: { nome: insensibile(veicoloNome) },
        select: { id: true, attivo: true },
      });

      if (!veicolo && input.salvaVeicolo) {
        veicolo = await tx.dreamVeicolo.create({
          data: { nome: veicoloNome },
          select: { id: true, attivo: true },
        });
      } else if (veicolo && !veicolo.attivo && input.salvaVeicolo) {
        await tx.dreamVeicolo.update({ where: { id: veicolo.id }, data: { attivo: true } });
      }

      // Indirizzo di fatturazione in anagrafica: solo se valido e se il
      // cliente esiste
      if (input.aggiornaEmailCliente && cliente && emailNormalizzata) {
        await tx.cliente.update({
          where: { id: cliente.id },
          data: { emailFatturazione: emailNormalizzata },
        });
      }

      const noleggio = await tx.noleggio.create({
        data: {
          utenteId: input.utenteId,
          data: input.data,
          dataIngresso: input.dataIngresso,
          cantiereId,
          cantiereNome,
          clienteId: cliente?.id ?? null,
          clienteNome,
          veicoloId: veicolo?.id ?? null,
          veicoloNome,
          giorni: input.giorni,
          pieno: input.pieno,
          carburante,
          danni: input.danni,
          danniNote: input.danni ? input.danniNote?.trim() || null : null,
          emailFatturazione: email ? email.slice(0, 254) : null,
          firmaNome: input.firmaNome.trim().slice(0, 200),
          firmaImg: input.firmaImg,
          emailStato: input.emailStato ?? null,
        },
        select: { id: true },
      });

      // Solo orfani propri: un id altrui o gia' collegato viene ignorato
      for (const [tipo, ids] of [['SCONTRINO', scontrinoIds], ['DANNI', danniIds]] as const) {
        if (ids.length === 0) continue;
        await tx.allegatoNoleggio.updateMany({
          where: { id: { in: ids }, noleggioId: null, caricatoDaId: input.utenteId },
          data: { noleggioId: noleggio.id, tipo },
        });
      }

      return noleggio;
    });
  }

  async delete(id: number): Promise<void> {
    // Prima i byte su R2: con la cascade le chiavi sparirebbero insieme alle
    // righe. Un oggetto orfano su R2 non costa nulla, quindi l'errore si logga
    const allegati = new AllegatiNoleggioService(this.prisma);
    try {
      await allegati.rimuoviChiavi(await allegati.chiaviDiNoleggio(id));
    } catch (error) {
      console.error(`[Noleggi] Rimozione foto del verbale ${id} fallita:`, error);
    }

    await this.prisma.noleggio.delete({ where: { id } });
  }
}
