import { PrismaClient, Prisma, TipoVoce } from '@prisma/client';

export interface RigaInput {
  voceId?: number | null;
  descrizione?: string;
  quantita: number;
}

export interface CreateBollettinoInput {
  utenteId: number;
  cantiereId: number;
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
  cantiereId: true,
  dataRiferimento: true,
  attivita: true,
  numeroOperai: true,
  ore: true,
  clienteNome: true,
  cantiereNome: true,
  firmaOperatoreNome: true,
  firmaCommittenteNome: true,
  createdAt: true,
  utente: { select: { id: true, nome: true, cognome: true } },
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
      ...(filters.clienteId ? { cantiere: { clienteId: filters.clienteId } } : {}),
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

  async create(input: CreateBollettinoInput): Promise<{ id: number }> {
    const cantiere = await this.prisma.cantiere.findUnique({
      where: { id: input.cantiereId },
      select: { id: true, nome: true, cliente: { select: { nome: true } } },
    });

    if (!cantiere) {
      throw new Error('Cantiere non trovato');
    }

    const righe = await this.buildRighe(input);

    const bollettino = await this.prisma.bollettino.create({
      data: {
        utenteId: input.utenteId,
        cantiereId: cantiere.id,
        dataRiferimento: input.dataRiferimento,
        attivita: input.attivita.trim(),
        numeroOperai: input.numeroOperai,
        ore: input.ore,
        clienteNome: cantiere.cliente.nome,
        cantiereNome: cantiere.nome,
        firmaOperatoreNome: input.firmaOperatoreNome.trim(),
        firmaOperatoreImg: input.firmaOperatoreImg,
        firmaCommittenteNome: input.firmaCommittenteNome.trim(),
        firmaCommittenteImg: input.firmaCommittenteImg,
        createdById: input.createdById,
        righe: { create: righe },
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
    // Le righe hanno onDelete: Cascade, quindi spariscono con il bollettino
    await this.prisma.bollettino.delete({ where: { id } });
  }
}
