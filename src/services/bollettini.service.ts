import { PrismaClient, Prisma, TipoVoce } from '@prisma/client';
import { AllegatiBollettinoService } from './allegatiBollettino.service.js';

export interface RigaInput {
  voceId?: number | null;
  // Solo per i mezzi: veicolo dell'anagrafica Gica Noleggi
  veicoloId?: number | null;
  descrizione?: string;
  quantita: number;
}

export interface CollaboratoreInput {
  utenteId: number;
  ore: number;
}

export interface CreateBollettinoInput {
  utenteId: number;
  clienteId?: number | null;
  cantiereId?: number | null;
  // Selezione multipla; `cantiereId` resta per i client che mandano il singolo
  cantieriIds?: number[];
  // Utenti presenti sul lavoro, ciascuno con le sue ore. Se c'e',
  // `numeroOperai` e' il conteggio e `oreTotali` la somma delle ore
  collaboratori?: CollaboratoreInput[];
  // Forma precedente, senza ore: resta accettata
  collaboratoriIds?: number[];
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
  oreTotali: true,
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
  cantieri: {
    select: { cantiereId: true, nome: true },
    orderBy: { id: 'asc' },
  },
  collaboratori: {
    select: { utenteId: true, nome: true, ore: true },
    orderBy: { id: 'asc' },
  },
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
      veicoloId: true,
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
    // Due OR distinti (cantiere e cliente) non possono stare nella stessa
    // chiave: vanno in AND
    const and: Prisma.BollettinoWhereInput[] = [];

    // `cantiereId` e' il primo dei cantieri selezionati: gli altri si trovano
    // solo nella tabella di collegamento
    if (filters.cantiereId) {
      and.push({
        OR: [
          { cantiereId: filters.cantiereId },
          { cantieri: { some: { cantiereId: filters.cantiereId } } },
        ],
      });
    }

    // I bollettini nuovi hanno `clienteId` valorizzato, quelli precedenti
    // alla colonna lo hanno NULL e sono raggiungibili solo via cantiere:
    // l'OR li tiene insieme senza dover riscrivere una riga di storico.
    if (filters.clienteId) {
      and.push({
        OR: [
          { clienteId: filters.clienteId },
          { cantiere: { clienteId: filters.clienteId } },
        ],
      });
    }

    return {
      ...(filters.utenteId ? { utenteId: filters.utenteId } : {}),
      ...(and.length ? { AND: and } : {}),
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
   * Cliente e cantieri del bollettino. I cantieri, quando ci sono, restano la
   * fonte piu' precisa: da li' si ricava anche il cliente, cosi' un client che
   * manda i soli id dei cantieri continua a funzionare. Devono appartenere
   * tutti allo stesso cliente.
   */
  private async risolviDestinazione(input: CreateBollettinoInput): Promise<{
    clienteId: number;
    clienteNome: string;
    cantieri: { id: number; nome: string }[];
  }> {
    const cantieriIds = [
      ...new Set([
        ...(input.cantieriIds ?? []),
        ...(input.cantiereId ? [input.cantiereId] : []),
      ]),
    ];

    if (cantieriIds.length > 0) {
      const trovati = await this.prisma.cantiere.findMany({
        where: { id: { in: cantieriIds } },
        select: { id: true, nome: true, clienteId: true, cliente: { select: { nome: true } } },
      });

      const primo = trovati[0];
      if (!primo || trovati.length !== cantieriIds.length) {
        throw new Error('Cantiere non trovato');
      }

      const clienteId = primo.clienteId;

      if (trovati.some((c) => c.clienteId !== clienteId)) {
        throw new Error('I cantieri devono appartenere allo stesso cliente');
      }

      if (input.clienteId && input.clienteId !== clienteId) {
        throw new Error('Il cantiere non appartiene al cliente selezionato');
      }

      // Nell'ordine scelto dall'operatore, non in quello del database
      const byId = new Map(trovati.map((c) => [c.id, c]));

      return {
        clienteId,
        clienteNome: primo.cliente.nome,
        cantieri: cantieriIds.map((id) => ({ id, nome: byId.get(id)!.nome })),
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
      cantieri: [],
    };
  }

  /** Collaboratori con il nome copiato dall'anagrafica utenti. */
  private async risolviCollaboratori(
    righe: { utenteId: number; ore: number | null }[]
  ): Promise<{ utenteId: number; nome: string; ore: number | null }[]> {
    const unici = [...new Set(righe.map((r) => r.utenteId))];
    if (unici.length !== righe.length) {
      throw new Error('Lo stesso collaboratore è inserito due volte');
    }
    if (unici.length === 0) return [];

    const utenti = await this.prisma.utente.findMany({
      where: { id: { in: unici } },
      select: { id: true, nome: true, cognome: true },
    });

    if (utenti.length !== unici.length) {
      throw new Error('Collaboratore non trovato');
    }

    const byId = new Map(utenti.map((u) => [u.id, u]));

    return righe.map(({ utenteId, ore }) => {
      const u = byId.get(utenteId)!;
      return { utenteId, nome: `${u.nome} ${u.cognome}`.trim(), ore };
    });
  }

  async create(input: CreateBollettinoInput): Promise<{ id: number }> {
    const destinazione = await this.risolviDestinazione(input);
    const conOre = Boolean(input.collaboratori);
    const collaboratori = input.collaboratori
      ? await this.risolviCollaboratori(input.collaboratori)
      : input.collaboratoriIds
        ? await this.risolviCollaboratori(
            input.collaboratoriIds.map((utenteId) => ({ utenteId, ore: null }))
          )
        : null;
    const oreTotali = conOre
      ? (collaboratori ?? []).reduce((s, c) => s + (c.ore ?? 0), 0)
      : null;

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
        cantiereId: destinazione.cantieri[0]?.id ?? null,
        dataRiferimento: input.dataRiferimento,
        attivita: input.attivita.trim(),
        numeroOperai: collaboratori ? collaboratori.length : input.numeroOperai,
        // Con le ore per collaboratore l'ora "per operaio" non esiste piu':
        // vale 0 e il totale sta in `oreTotali`
        ore: conOre ? 0 : input.ore,
        oreTotali,
        clienteNome: destinazione.clienteNome,
        cantiereNome: destinazione.cantieri.length
          ? destinazione.cantieri.map((c) => c.nome).join(', ')
          : null,
        firmaOperatoreNome: input.firmaOperatoreNome.trim(),
        firmaOperatoreImg: input.firmaOperatoreImg,
        firmaCommittenteNome: input.firmaCommittenteNome.trim(),
        firmaCommittenteImg: input.firmaCommittenteImg,
        emailDestinatario: input.emailDestinatario ?? null,
        emailStato: input.emailStato ?? null,
        createdById: input.createdById,
        righe: { create: righe },
        cantieri: {
          create: destinazione.cantieri.map((c) => ({
            cantiere: { connect: { id: c.id } },
            nome: c.nome,
          })),
        },
        collaboratori: {
          create: (collaboratori ?? []).map((c) => ({
            utente: { connect: { id: c.utenteId } },
            nome: c.nome,
            ore: c.ore,
          })),
        },
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

    const veicoloIds = input.mezzi
      .map((r) => r.veicoloId)
      .filter((id): id is number => typeof id === 'number');

    const veicoli = veicoloIds.length
      ? await this.prisma.dreamVeicolo.findMany({
          where: { id: { in: veicoloIds } },
          select: { id: true, nome: true },
        })
      : [];

    const veicoliById = new Map(veicoli.map((v) => [v.id, v]));

    return gruppi.flatMap(({ tipo, righe }) =>
      righe.map((riga) => {
        // Il veicolo vale solo nella sezione mezzi, e li' ha la precedenza
        if (tipo === 'MEZZO' && typeof riga.veicoloId === 'number') {
          const veicolo = veicoliById.get(riga.veicoloId);

          if (!veicolo) {
            throw new Error('Mezzo non trovato');
          }

          return {
            tipo,
            veicolo: { connect: { id: veicolo.id } },
            descrizione: veicolo.nome,
            quantita: riga.quantita,
          };
        }

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
