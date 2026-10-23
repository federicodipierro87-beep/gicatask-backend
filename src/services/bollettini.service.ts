import { PrismaClient, Prisma, TipoVoce, DurataNoleggio } from '@prisma/client';
import { AllegatiBollettinoService } from './allegatiBollettino.service.js';
import { calculateDurationMinutes, isValidTimeFormat } from '../utils/duration.js';

export interface RigaInput {
  voceId?: number | null;
  // Solo per i mezzi: veicolo dell'anagrafica Gica Noleggi
  veicoloId?: number | null;
  descrizione?: string;
  quantita: number;
}

export interface FasceOrarie {
  oraInizioMattino?: string | null;
  oraFineMattino?: string | null;
  oraInizioPomeriggio?: string | null;
  oraFinePomeriggio?: string | null;
}

export interface SquadraInput extends FasceOrarie {
  numeroOperai: number;
  // "A" o "B", solo nei Bollettini Nuovi
  categoria?: string | null;
}

const CATEGORIE_OPERAI = ['A', 'B'];

export interface CollaboratoreInput {
  utenteId: number;
  ore: number;
}

/** Noleggio del modello 2: veicolo della Banca dati veicoli e durata. */
export interface NoleggioInput {
  veicoloId: number;
  durata: DurataNoleggio;
}

export interface CreateBollettinoInput {
  utenteId: number;
  // 1 = classico, 2 = sezione "Bollettini Nuovi"
  modello: 1 | 2;
  // Solo modello 2
  riferimentoCantiere?: string | null;
  mezziTesto?: string | null;
  trasportiTesto?: string | null;
  noleggi?: NoleggioInput[];
  clienteId?: number | null;
  // Cliente scritto a mano, al posto di `clienteId`: se non c'e' in anagrafica
  // viene aggiunto insieme al bollettino
  clienteNome?: string | null;
  cantiereId?: number | null;
  // Selezione multipla; `cantiereId` resta per i client che mandano il singolo
  cantieriIds?: number[];
  // Utenti presenti sul lavoro, ciascuno con le sue ore. Se c'e',
  // `numeroOperai` e' il conteggio e `oreTotali` la somma delle ore
  collaboratori?: CollaboratoreInput[];
  // Forma precedente, senza ore: resta accettata
  collaboratoriIds?: number[];
  // Fasce della giornata, come nelle attivita'
  fasce?: FasceOrarie;
  // Operai a gruppi con i propri orari. Se c'e', prevale sui collaboratori:
  // `numeroOperai` e' la somma degli operai e `oreTotali` quella delle ore
  squadre?: SquadraInput[];
  materialiTesto?: string | null;
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
  // Stato scelto da chi compila; poi lo cambia il responsabile dall'archivio
  fatturato?: boolean;
  createdById: number;
}

function pulisciNome(valore: string | null | undefined, max = 200): string {
  return (valore ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const insensibile = (nome: string) => ({ equals: nome, mode: 'insensitive' as const });

// Chiave arbitraria dell'advisory lock che serializza la numerazione: due
// salvataggi contemporanei leggerebbero lo stesso massimo
const LOCK_NUMERAZIONE = 7150001;

/** Anno solare in Svizzera: a Capodanno l'UTC resta indietro di un'ora. */
function annoCorrente(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zurich', year: 'numeric' }).format(new Date())
  );
}

async function bloccaNumerazione(tx: Prisma.TransactionClient): Promise<void> {
  // Rilasciato da solo alla fine della transazione
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NUMERAZIONE}::bigint)`;
}

/**
 * Numera i bollettini che non hanno ancora un numero, anno per anno in ordine
 * di id, proseguendo dal massimo gia' assegnato. Va chiamata col lock preso.
 */
async function assegnaNumeriMancanti(tx: Prisma.TransactionClient): Promise<number> {
  return tx.$executeRaw`
    WITH mancanti AS (
      SELECT id,
             EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Zurich')::int AS a
      FROM bollettini
      WHERE numero IS NULL
    ),
    numerati AS (
      SELECT m.id, m.a,
             COALESCE((SELECT MAX(b.numero) FROM bollettini b WHERE b.anno = m.a), 0)
               + ROW_NUMBER() OVER (PARTITION BY m.a ORDER BY m.id) AS n
      FROM mancanti m
    )
    UPDATE bollettini SET anno = numerati.a, numero = numerati.n
    FROM numerati
    WHERE bollettini.id = numerati.id
  `;
}

/**
 * All'avvio: numera i bollettini precedenti alla numerazione e quelli
 * ripristinati da un backup che non la aveva. Innocua quando non manca nulla.
 */
export async function numeraBollettiniMancanti(prisma: PrismaClient): Promise<void> {
  const numerati = await prisma.$transaction(async (tx) => {
    await bloccaNumerazione(tx);
    return assegnaNumeriMancanti(tx);
  });

  if (numerati > 0) {
    console.log(`[Bollettini] Numerati ${numerati} bollettini senza numero`);
  }
}

export interface BollettinoFilters {
  utenteId?: number;
  clienteId?: number;
  cantiereId?: number;
  startDate?: Date;
  endDate?: Date;
  // Assente: tutti, come prima del flag (elenco del dipendente, cumulativi)
  fatturato?: boolean;
  // Assente: entrambi i modelli (archivio del responsabile)
  modello?: number;
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
  oraInizioMattino: true,
  oraFineMattino: true,
  oraInizioPomeriggio: true,
  oraFinePomeriggio: true,
  materialiTesto: true,
  modello: true,
  riferimentoCantiere: true,
  mezziTesto: true,
  trasportiTesto: true,
  clienteNome: true,
  cantiereNome: true,
  firmaOperatoreNome: true,
  firmaCommittenteNome: true,
  // Stringhe corte: a differenza delle firme non pesano sull'elenco
  emailDestinatario: true,
  emailStato: true,
  emailInviataAt: true,
  emailErrore: true,
  anno: true,
  numero: true,
  fatturato: true,
  fatturatoAt: true,
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
  squadre: {
    select: {
      numeroOperai: true,
      categoria: true,
      oraInizioMattino: true,
      oraFineMattino: true,
      oraInizioPomeriggio: true,
      oraFinePomeriggio: true,
      ore: true,
    },
    orderBy: { id: 'asc' },
  },
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
  noleggi: {
    select: { veicoloId: true, descrizione: true, durata: true },
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

/**
 * Fasce normalizzate (stringa vuota -> null) e loro durata in minuti. Una
 * fascia vale solo con inizio e fine; ne basta una sola delle due. Stessa
 * regola delle attivita': fine prima dell'inizio = turno che finisce il
 * giorno dopo.
 */
function risolviFasce(f: FasceOrarie | undefined, dove: string): {
  fasce: Required<{ [K in keyof FasceOrarie]: string | null }>;
  minuti: number;
} {
  const pulisci = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const fasce = {
    oraInizioMattino: pulisci(f?.oraInizioMattino),
    oraFineMattino: pulisci(f?.oraFineMattino),
    oraInizioPomeriggio: pulisci(f?.oraInizioPomeriggio),
    oraFinePomeriggio: pulisci(f?.oraFinePomeriggio),
  };

  let minuti = 0;
  const coppie: [string, string | null, string | null][] = [
    ['mattino', fasce.oraInizioMattino, fasce.oraFineMattino],
    ['pomeriggio', fasce.oraInizioPomeriggio, fasce.oraFinePomeriggio],
  ];

  for (const [nome, inizio, fine] of coppie) {
    if (!inizio && !fine) continue;
    if (!inizio || !fine) {
      throw new Error(`${dove}: indica inizio e fine del ${nome}`);
    }
    if (!isValidTimeFormat(inizio) || !isValidTimeFormat(fine)) {
      throw new Error(`${dove}: orario del ${nome} non valido`);
    }
    if (inizio === fine) {
      throw new Error(`${dove}: l'ora di fine del ${nome} deve essere diversa dall'inizio`);
    }
    minuti += calculateDurationMinutes(inizio, fine);
  }

  return { fasce, minuti };
}

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
      ...(filters.fatturato !== undefined ? { fatturato: filters.fatturato } : {}),
      ...(filters.modello !== undefined ? { modello: filters.modello } : {}),
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
    endDate?: Date,
    modello?: 1 | 2
  ): Promise<BollettinoFull[]> {
    return this.prisma.bollettino.findMany({
      where: this.buildWhere({ cantiereId, startDate, endDate, modello }),
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
    endDate?: Date,
    modello?: 1 | 2
  ): Promise<BollettinoFull[]> {
    return this.prisma.bollettino.findMany({
      where: this.buildWhere({ clienteId, startDate, endDate, modello }),
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
    // NULL: cliente scritto a mano e assente dall'anagrafica, lo crea la
    // transazione del bollettino
    clienteId: number | null;
    clienteNome: string;
    cantieri: { id: number; nome: string }[];
    // Cliente scritto a mano che corrisponde a uno disattivato
    riattivaCliente?: boolean;
  }> {
    const nomeScritto = pulisciNome(input.clienteNome);

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

      if (
        !input.clienteId &&
        nomeScritto &&
        nomeScritto.toLocaleLowerCase('it') !== primo.cliente.nome.toLocaleLowerCase('it')
      ) {
        throw new Error('Il cantiere non appartiene al cliente indicato');
      }

      // Nell'ordine scelto dall'operatore, non in quello del database
      const byId = new Map(trovati.map((c) => [c.id, c]));

      return {
        clienteId,
        clienteNome: primo.cliente.nome,
        cantieri: cantieriIds.map((id) => ({ id, nome: byId.get(id)!.nome })),
      };
    }

    let cliente: { id: number; nome: string } | null;

    if (input.clienteId) {
      cliente = await this.prisma.cliente.findUnique({
        where: { id: input.clienteId },
        select: { id: true, nome: true },
      });
    } else if (nomeScritto) {
      // Cliente scritto a mano: si collega quello in anagrafica con lo stesso
      // nome, maiuscole a parte, altrimenti si crea con il bollettino
      const esistente = await this.prisma.cliente.findFirst({
        where: { nome: insensibile(nomeScritto) },
        select: { id: true, nome: true, attivo: true },
        // Prima gli attivi: con un omonimo disattivato si collega quello in uso
        orderBy: [{ attivo: 'desc' }, { id: 'asc' }],
      });

      if (!esistente) {
        return { clienteId: null, clienteNome: nomeScritto, cantieri: [] };
      }

      // Un cliente disattivato non compare nei suggerimenti, quindi il form
      // non ha proposto i suoi cantieri: niente obbligo del cantiere
      if (!esistente.attivo) {
        return {
          clienteId: esistente.id,
          clienteNome: esistente.nome,
          cantieri: [],
          riattivaCliente: true,
        };
      }

      cliente = esistente;
    } else {
      throw new Error('Cliente obbligatorio');
    }

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
    const intestazione = risolviFasce(input.fasce, 'Orari');

    // Le ore della riga si calcolano qui e non si prendono dal client: il
    // totale stampato sul documento firmato deve tornare con gli orari.
    // Gli orari sono facoltativi: una riga senza fasce vale 0 ore
    const squadre = input.squadre
      ? input.squadre.map((s, i) => {
          const { fasce, minuti } = risolviFasce(s, `Operai, riga ${i + 1}`);
          const categoria = s.categoria?.trim().toUpperCase() || null;
          if (categoria && !CATEGORIE_OPERAI.includes(categoria)) {
            throw new Error(`Operai, riga ${i + 1}: la categoria deve essere A o B`);
          }
          return {
            ...fasce,
            numeroOperai: s.numeroOperai,
            categoria,
            ore: Math.round(((s.numeroOperai * minuti) / 60) * 100) / 100,
          };
        })
      : null;

    const oreTotali = squadre
      ? Math.round(squadre.reduce((s, q) => s + q.ore, 0) * 100) / 100
      : conOre
        ? (collaboratori ?? []).reduce((s, c) => s + (c.ore ?? 0), 0)
        : null;

    const numeroOperai = squadre
      ? squadre.reduce((s, q) => s + q.numeroOperai, 0)
      : collaboratori
        ? collaboratori.length
        : input.numeroOperai;

    const materialiTesto = input.materialiTesto?.trim() || null;

    // Il modello 2 ha mezzi e trasporti a testo libero: eventuali righe
    // arrivate insieme verrebbero stampate due volte, quindi si ignorano
    const modello2 = input.modello === 2;
    const righe = await this.buildRighe(
      modello2 ? { ...input, mezzi: [], trasporti: [] } : input
    );
    const noleggi = modello2 ? await this.buildNoleggi(input.noleggi ?? []) : [];

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

    // Numero e salvataggio nella stessa transazione: se la create fallisce il
    // numero non resta bruciato
    const bollettino = await this.prisma.$transaction(async (tx) => {
      await bloccaNumerazione(tx);
      // Un bollettino salvato dalla versione precedente durante il deploy non
      // ha numero: prende il suo prima del nuovo
      await assegnaNumeriMancanti(tx);

      // Cliente scritto a mano: entra in anagrafica solo se il bollettino si
      // salva. Si ricerca qui dentro perche' un altro salvataggio potrebbe
      // averlo appena creato
      let clienteId = destinazione.clienteId;
      if (clienteId === null) {
        const creato =
          (await tx.cliente.findFirst({
            where: { nome: insensibile(destinazione.clienteNome) },
            select: { id: true },
            orderBy: [{ attivo: 'desc' }, { id: 'asc' }],
          })) ??
          (await tx.cliente.create({
            data: { nome: destinazione.clienteNome },
            select: { id: true },
          }));
        clienteId = creato.id;
      } else if (destinazione.riattivaCliente) {
        await tx.cliente.update({ where: { id: clienteId }, data: { attivo: true } });
      }

      const anno = annoCorrente();
      const { _max } = await tx.bollettino.aggregate({
        where: { anno },
        _max: { numero: true },
      });

      return tx.bollettino.create({
        data: {
          anno,
          numero: (_max.numero ?? 0) + 1,
          utenteId: input.utenteId,
          clienteId,
          cantiereId: destinazione.cantieri[0]?.id ?? null,
          dataRiferimento: input.dataRiferimento,
          attivita: input.attivita.trim(),
          numeroOperai,
          // Con le ore per squadra o per collaboratore l'ora "per operaio" non
          // esiste piu': vale 0 e il totale sta in `oreTotali`
          ore: oreTotali !== null ? 0 : input.ore,
          oreTotali,
          ...intestazione.fasce,
          materialiTesto,
          modello: input.modello,
          riferimentoCantiere: modello2 ? input.riferimentoCantiere?.trim() || null : null,
          mezziTesto: modello2 ? input.mezziTesto?.trim() || null : null,
          trasportiTesto: modello2 ? input.trasportiTesto?.trim() || null : null,
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
          fatturato: Boolean(input.fatturato),
          fatturatoAt: input.fatturato ? new Date() : null,
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
          squadre: { create: squadre ?? [] },
          noleggi: { create: noleggi },
          allegati: { connect: allegati.map((a) => ({ id: a.id })) },
        },
        select: { id: true },
      });
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

  /** Noleggi con il nome del veicolo copiato dall'anagrafica, come i mezzi. */
  private async buildNoleggi(
    noleggi: NoleggioInput[]
  ): Promise<Prisma.BollettinoNoleggioUncheckedCreateWithoutBollettinoInput[]> {
    if (noleggi.length === 0) return [];

    const veicoli = await this.prisma.dreamVeicolo.findMany({
      where: { id: { in: noleggi.map((n) => n.veicoloId) } },
      select: { id: true, nome: true },
    });
    const veicoliById = new Map(veicoli.map((v) => [v.id, v]));

    return noleggi.map((n) => {
      const veicolo = veicoliById.get(n.veicoloId);

      if (!veicolo) {
        throw new Error('Veicolo del noleggio non trovato');
      }

      // Lo schema della rotta non ha l'enum: qui il 400 resta leggibile
      if (!Object.values(DurataNoleggio).includes(n.durata)) {
        throw new Error('Durata del noleggio non valida');
      }

      // L'id scalare e non un `connect`: con le relazioni annidate Prisma non
      // conserva l'ordine delle righe, che e' quello scelto dall'operatore
      return {
        veicoloId: veicolo.id,
        descrizione: veicolo.nome,
        durata: n.durata,
      };
    });
  }

  /** Restituisce false se il bollettino non esiste. */
  async setFatturato(id: number, fatturato: boolean): Promise<boolean> {
    const { count } = await this.prisma.bollettino.updateMany({
      where: { id },
      data: { fatturato, fatturatoAt: fatturato ? new Date() : null },
    });
    return count > 0;
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
