import { PrismaClient, Prisma, TipoVoce } from '@prisma/client';
import { AllegatiBollettinoService } from './allegatiBollettino.service.js';

export interface RigaInput {
  voceId?: number | null;
  descrizione?: string;
  quantita: number;
}

export interface CreateBollettinoInput {
  utenteId: number;
  clienteId?: number | null;
  cantiereId?: number | null;
  dataRiferimento: Date;
  attivita: string;
  numeroOperai: number;
  ore: number;
  mezzi: RigaInput[];
  materiali: RigaInput[];
  trasporti: RigaInput[];
  firmaOperatoreNome: string;
  firmaOperatoreImg: string;
  firmaCommittenteNome: string;
  firmaCommittenteImg: string;
  emailDestinatario?: string | null;
  emailStato?: string | null;
  allegatiIds?: number[];
  createdById: number;
}

export interface BollettinoFilters {
  utenteId?: number;
  clienteId?: number;
  cantiereId?: number;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Le firme sono due PNG base64 da decine di KB ciascuno. Prisma restituisce
 * tutti gli scalari se non si passa un `select`, quindi un elenco da 50 righe
 * spedirebbe qualche MB di base64 inutile al browser: le colonne delle
 * immagini sono escluse ovunque tranne che nel dettaglio usato per il PDF.
 */
const listSelect = {
  id: true,
  utenteId: true,
  clienteId: true,
  cantiereId: true,
  dataRiferimento: true,
  attivita: true,
  numeroOperai: true,
  ore: true,
  clienteNome: true,
  cantiereNome: true,
  firmaOperatoreNome: true,
  firmaCommittenteNome: true,
  // Stringhe corte: a differenza delle firme non pesano sull'elenco
  emailDestinatario: true,
  emailStato: true,
  emailInviataAt: true,
  emailErrore: true,
  createdAt: true,
  utente: { select: { id: true, nome: true, cognome: true } },
  // Metadati corti: al contrario delle firme non pesano sull'elenco, e cosi'
  // lista e archivio mostrano il conteggio senza una seconda chiamata
  allegati: {
    select: { id: true, nomeFile: true, mimeType: true, dimensione: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.BollettinoSelect;

export type BollettinoListItem = Prisma.BollettinoGetPayload<{ select: typeof listSelect }>;

const detailSelect = {
  ...listSelect,
  righe: {
    select: {
      id: true,
      tipo: true,
      voceId: true,
      descrizione: true,
      quantita: true,
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.BollettinoSelect;

export type BollettinoDetail = Prisma.BollettinoGetPayload<{ select: typeof detailSelect }>;

const fullSelect = {
  ...detailSelect,
  firmaOperatoreImg: true,
  firmaCommittenteImg: true,
} satisfies Prisma.BollettinoSelect;

export type BollettinoFull = Prisma.BollettinoGetPayload<{ select: typeof fullSelect }>;

export class BollettiniService {
  constructor(private prisma: PrismaClient) {}

  private buildWhere(filters: BollettinoFilters): Prisma.BollettinoWhereInput {
    return {
      ...(filters.utenteId ? { utenteId: filters.utenteId } : {}),
      ...(filters.cantiereId ? { cantiereId: filters.cantiereId } : {}),
      // I bollettini nuovi hanno `clienteId` valorizzato, quelli precedenti
      // alla colonna lo hanno NULL e sono raggiungibili solo via cantiere:
      // l'OR li tiene insieme senza dover riscrivere una riga di storico.
      ...(filters.clienteId
        ? {
            OR: [
              { clienteId: filters.clienteId },
              { cantiere: { clienteId: filters.clienteId } },
            ],
          }
        : {}),
      ...(filters.startDate || filters.endDate
        ? {
            dataRiferimento: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
    };
  }

  async getAll(filters: BollettinoFilters = {}): Promise<BollettinoListItem[]> {
    return this.prisma.bollettino.findMany({
      where: this.buildWhere(filters),
      select: listSelect,
      orderBy: [{ dataRiferimento: 'desc' }, { id: 'desc' }],
    });
  }

  async getById(id: number): Promise<BollettinoDetail | null> {
    return this.prisma.bollettino.findUnique({
      where: { id },
      select: detailSelect,
    });
  }

  /** Dettaglio comprensivo delle firme: usato solo per generare i PDF. */
  async getFull(id: number): Promise<BollettinoFull | null> {
    return this.prisma.bollettino.findUnique({
      where: { id },
      select: fullSelect,
    });
  }

  /** Bollettini di un cantiere in ordine di data: base del PDF cumulativo. */
  async getByCantiere(
    cantiereId: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<BollettinoFull[]> {
    return this.prisma.bollettino.findMany({
      where: this.buildWhere({ cantiereId, startDate, endDate }),
      select: fullSelect,
      orderBy: [{ dataRiferimento: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Bollettini di un cliente, cantieri compresi: base del cumulativo di
   * cliente, l'unico disponibile per i clienti che non hanno cantieri.
   */
  async getByCliente(
    clienteId: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<BollettinoFull[]> {
    return this.prisma.bollettino.findMany({
      where: this.buildWhere({ clienteId, startDate, endDate }),
      select: fullSelect,
      orderBy: [{ dataRiferimento: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Cliente e cantiere del bollettino. Il cantiere, quando c'e', resta la
   * fonte piu' precisa: da li' si ricava anche il cliente, cosi' un client che
   * manda il solo `cantiereId` continua a funzionare senza modifiche.
   */
  private async risolviDestinazione(input: CreateBollettinoInput): Promise<{
    clienteId: number;
    clienteNome: string;
    cantiereId: number | null;
    cantiereNome: string | null;
  }> {
    if (input.cantiereId) {
      const cantiere = await this.prisma.cantiere.findUnique({
        where: { id: input.cantiereId },
        select: { id: true, nome: true, clienteId: true, cliente: { select: { nome: true } } },
      });

      if (!cantiere) {
        throw new Error('Cantiere non trovato');
      }

      return {
        clienteId: cantiere.clienteId,
        clienteNome: cantiere.cliente.nome,
        cantiereId: cantiere.id,
        cantiereNome: cantiere.nome,
      };
    }

    if (!input.clienteId) {
      throw new Error('Cliente obbligatorio');
    }

    const cliente = await this.prisma.cliente.findUnique({
      where: { id: input.clienteId },
      select: { id: true, nome: true },
    });

    if (!cliente) {
      throw new Error('Cliente non trovato');
    }

    // Stessa regola delle attivita': il cantiere e' obbligatorio solo se il
    // cliente ne ha almeno uno attivo
    const cantieriAttivi = await this.prisma.cantiere.count({
      where: { clienteId: cliente.id, attivo: true },
    });

    if (cantieriAttivi > 0) {
      throw new Error('Il cantiere è obbligatorio per questo cliente');
    }

    return {
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      cantiereId: null,
      cantiereNome: null,
    };
  }

  async create(input: CreateBollettinoInput): Promise<{ id: number }> {
    const destinazione = await this.risolviDestinazione(input);

    const righe = await this.buildRighe(input);

    // Si filtra prima e si usa un `connect` annidato: l'operazione resta
    // atomica e non serve una update dopo la create, che e' il momento in cui
    // nessun errore e' piu' ammesso. Un id non ammissibile viene scartato in
    // silenzio: perdere un allegato e' sempre meglio che rifiutare un
    // bollettino gia' firmato.
    const allegati = input.allegatiIds?.length
      ? await this.prisma.allegatoBollettino.findMany({
          where: {
            id: { in: input.allegatiIds.slice(0, 10) },
            bollettinoId: null,
            caricatoDaId: input.utenteId,
          },
          select: { id: true },
        })
      : [];

    const bollettino = await this.prisma.bollettino.create({
      data: {
        utenteId: input.utenteId,
        clienteId: destinazione.clienteId,
        cantiereId: destinazione.cantiereId,
        dataRiferimento: input.dataRiferimento,
        attivita: input.attivita.trim(),
        numeroOperai: input.numeroOperai,
        ore: input.ore,
        clienteNome: destinazione.clienteNome,
        cantiereNome: destinazione.cantiereNome,
        firmaOperatoreNome: input.firmaOperatoreNome.trim(),
        firmaOperatoreImg: input.firmaOperatoreImg,
        firmaCommittenteNome: input.firmaCommittenteNome.trim(),
        firmaCommittenteImg: input.firmaCommittenteImg,
        emailDestinatario: input.emailDestinatario ?? null,
        emailStato: input.emailStato ?? null,
        createdById: input.createdById,
        righe: { create: righe },
        allegati: { connect: allegati.map((a) => ({ id: a.id })) },
      },
      select: { id: true },
    });

    return bollettino;
  }

  /**
   * Trasforma le tre liste in righe pronte da inserire, copiando il nome della
   * voce dall'anagrafica: il bollettino e' firmato, quindi il PDF rigenerato
   * domani deve mostrare gli stessi nomi di oggi anche se nel frattempo una
   * voce e' stata rinominata.
   */
  private async buildRighe(
    input: CreateBollettinoInput
  ): Promise<Prisma.RigaBollettinoCreateWithoutBollettinoInput[]> {
    const gruppi: { tipo: TipoVoce; righe: RigaInput[] }[] = [
      { tipo: 'MEZZO', righe: input.mezzi },
      { tipo: 'MATERIALE', righe: input.materiali },
      { tipo: 'TRASPORTO', righe: input.trasporti },
    ];

    const voceIds = gruppi
      .flatMap((g) => g.righe)
      .map((r) => r.voceId)
      .filter((id): id is number => typeof id === 'number');

    const voci = voceIds.length
      ? await this.prisma.voceBollettino.findMany({
          where: { id: { in: voceIds } },
          select: { id: true, tipo: true, nome: true },
        })
      : [];

    const vociById = new Map(voci.map((v) => [v.id, v]));

    return gruppi.flatMap(({ tipo, righe }) =>
      righe.map((riga) => {
        const voce = typeof riga.voceId === 'number' ? vociById.get(riga.voceId) : undefined;

        if (typeof riga.voceId === 'number' && !voce) {
          throw new Error('Voce non trovata');
        }

        if (voce && voce.tipo !== tipo) {
          throw new Error(`La voce "${voce.nome}" non appartiene a questa sezione`);
        }

        const descrizione = (voce?.nome ?? riga.descrizione ?? '').trim();

        if (!descrizione) {
          throw new Error('Ogni riga deve avere una descrizione');
        }

        return {
          tipo,
          voce: voce ? { connect: { id: voce.id } } : undefined,
          descrizione,
          quantita: riga.quantita,
        };
      })
    );
  }

  async delete(id: number): Promise<void> {
    // Prima i byte su R2: le righe hanno onDelete Cascade, quindi dopo la
    // delete le chiavi non sarebbero piu' recuperabili. L'errore si logga e
    // basta: un oggetto orfano su R2 non costa nulla, un bollettino che non si
    // riesce a cancellare si'.
    const allegati = new AllegatiBollettinoService(this.prisma);
    try {
      await allegati.rimuoviChiavi(await allegati.chiaviDiBollettino(id));
    } catch (error) {
      console.error(`[Bollettini] Rimozione allegati del bollettino ${id} fallita:`, error);
    }

    // Righe e allegati hanno onDelete: Cascade, spariscono con il bollettino
    await this.prisma.bollettino.delete({ where: { id } });
  }
}
