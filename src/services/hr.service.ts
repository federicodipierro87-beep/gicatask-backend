import { PrismaClient, Prisma, StatoCivile } from '@prisma/client';
import { parseDataSolo } from '../utils/dataSolo.js';

export const STATI_CIVILI: StatoCivile[] = ['CELIBE', 'NUBILE', 'CONIUGATO', 'SEPARATO', 'DIVORZIATO'];

// Campi testuali della scheda, copiati cosi' come arrivano (vuoto -> NULL)
const CAMPI_TESTO = [
  'numeroPersonale',
  'indirizzo',
  'luogo',
  'luogoNascita',
  'telefono',
  'numeroAvs',
  'tipoPermesso',
  'codiceFiscale',
  'numeroSimic',
  'cassaMalati',
  'nazionalita',
  'coniugeCognomeNome',
  'assegnoFigli',
  'padreCognomeNome',
  'madreCognomeNome',
  'tipoSalario',
  'salario',
  'gradoOccupazione',
  'iban',
  'email',
  'emergenzaNome',
  'emergenzaTelefono',
] as const;

const CAMPI_DATA = [
  'dataNascita',
  'scadenzaPermesso',
  'coniugatoDal',
  'coniugeDataNascita',
  'dataAssunzione',
  'dataCessazione',
] as const;

type CampoTesto = (typeof CAMPI_TESTO)[number];
type CampoData = (typeof CAMPI_DATA)[number];

export interface FiglioInput {
  cognomeNome: string;
  dataNascita?: string | null;
}

export interface FormazioneInput {
  // Assente per le formazioni nuove
  id?: number;
  nome: string;
  allegatiIds?: number[];
}

export type SchedaHrInput = {
  cognomeNome: string;
  impostaFonte?: boolean | null;
  statoCivile?: StatoCivile | null;
  // Foto del dipendente, gia' caricata con POST /api/hr/allegati
  fotoId?: number | null;
  figli?: FiglioInput[];
  formazioni?: FormazioneInput[];
} & Partial<Record<CampoTesto, string | null>> &
  Partial<Record<CampoData, string | null>>;

const SELECT_ALLEGATO = { id: true, nomeFile: true, mimeType: true, dimensione: true } as const;

export const SCHEDA_INCLUDE = {
  foto: { select: SELECT_ALLEGATO },
  figli: { orderBy: { id: 'asc' } },
  formazioni: {
    orderBy: { id: 'asc' },
    include: {
      foto: { orderBy: { id: 'asc' }, select: SELECT_ALLEGATO },
    },
  },
} satisfies Prisma.SchedaHrInclude;

export type SchedaHrCompleta = Prisma.SchedaHrGetPayload<{ include: typeof SCHEDA_INCLUDE }>;

function testo(valore: string | null | undefined): string | null {
  const pulito = valore?.trim();
  return pulito ? pulito : null;
}

function data(valore: string | null | undefined): Date | null {
  return valore ? parseDataSolo(valore) : null;
}

export class HrService {
  constructor(private prisma: PrismaClient) {}

  /** Tutte le schede, attive e uscenti: la divisione la fa il frontend. */
  async getAll(): Promise<SchedaHrCompleta[]> {
    return this.prisma.schedaHr.findMany({
      include: SCHEDA_INCLUDE,
      orderBy: { cognomeNome: 'asc' },
    });
  }

  async getById(id: number): Promise<SchedaHrCompleta | null> {
    return this.prisma.schedaHr.findUnique({ where: { id }, include: SCHEDA_INCLUDE });
  }

  /** Le schede richieste, nell'ordine alfabetico dell'elenco. */
  async getByIds(ids: number[]): Promise<SchedaHrCompleta[]> {
    return this.prisma.schedaHr.findMany({
      where: { id: { in: ids } },
      include: SCHEDA_INCLUDE,
      orderBy: { cognomeNome: 'asc' },
    });
  }

  private datiScheda(input: SchedaHrInput) {
    const cognomeNome = testo(input.cognomeNome);
    if (!cognomeNome) throw new Error('Cognome e nome obbligatori');

    if (input.statoCivile && !STATI_CIVILI.includes(input.statoCivile)) {
      throw new Error('Stato civile non valido');
    }

    const dati: Record<string, unknown> = {
      cognomeNome,
      impostaFonte: input.impostaFonte ?? null,
      statoCivile: input.statoCivile || null,
    };

    for (const campo of CAMPI_TESTO) dati[campo] = testo(input[campo]);
    for (const campo of CAMPI_DATA) dati[campo] = data(input[campo]);

    return dati as Omit<Prisma.SchedaHrUncheckedCreateInput, 'figli' | 'formazioni'>;
  }

  private datiFigli(figli: FiglioInput[] = []) {
    return figli
      .filter((f) => testo(f.cognomeNome))
      .map((f) => ({ cognomeNome: testo(f.cognomeNome)!, dataNascita: data(f.dataNascita) }));
  }

  async create(input: SchedaHrInput): Promise<SchedaHrCompleta> {
    const dati = this.datiScheda(input);
    const figli = this.datiFigli(input.figli);

    return this.prisma.$transaction(async (tx) => {
      const scheda = await tx.schedaHr.create({
        data: { ...dati, figli: { create: figli } },
      });

      await this.salvaFoto(tx, scheda.id, input.fotoId ?? null);
      await this.salvaFormazioni(tx, scheda.id, input.formazioni ?? []);

      return tx.schedaHr.findUniqueOrThrow({ where: { id: scheda.id }, include: SCHEDA_INCLUDE });
    });
  }

  async update(id: number, input: SchedaHrInput): Promise<SchedaHrCompleta> {
    const dati = this.datiScheda(input);
    const figli = this.datiFigli(input.figli);

    return this.prisma.$transaction(async (tx) => {
      const esistente = await tx.schedaHr.findUnique({ where: { id }, select: { id: true } });
      if (!esistente) throw new Error('Scheda non trovata');

      // I figli non hanno nulla appeso: si riscrivono per intero
      await tx.figlioHr.deleteMany({ where: { schedaId: id } });
      await tx.schedaHr.update({
        where: { id },
        data: { ...dati, figli: { create: figli } },
      });

      await this.salvaFoto(tx, id, input.fotoId ?? null);
      await this.salvaFormazioni(tx, id, input.formazioni ?? []);

      return tx.schedaHr.findUniqueOrThrow({ where: { id }, include: SCHEDA_INCLUDE });
    });
  }

  /**
   * La foto del dipendente. Si accetta solo un allegato orfano o la foto gia'
   * di questa scheda; un id diverso si ignora e la foto resta quella di prima.
   * La foto sostituita o tolta torna orfana e la cancella la pulizia notturna.
   */
  private async salvaFoto(
    tx: Prisma.TransactionClient,
    schedaId: number,
    fotoId: number | null
  ): Promise<void> {
    if (fotoId === null) {
      await tx.schedaHr.update({ where: { id: schedaId }, data: { fotoId: null } });
      return;
    }

    const valida = await tx.allegatoHr.findFirst({
      where: {
        id: fotoId,
        OR: [{ formazioneId: null, schedaFoto: { is: null } }, { schedaFoto: { is: { id: schedaId } } }],
      },
      select: { id: true },
    });

    if (valida) {
      await tx.schedaHr.update({ where: { id: schedaId }, data: { fotoId } });
    }
  }

  /**
   * Le formazioni invece hanno le foto, quindi si aggiornano per id: quelle
   * sparite dal form si cancellano, e le loro foto tornano orfane
   * (onDelete: SetNull) finche' la pulizia notturna non le toglie da R2.
   * Lo stesso vale per una foto tolta da una formazione che resta.
   */
  private async salvaFormazioni(
    tx: Prisma.TransactionClient,
    schedaId: number,
    formazioni: FormazioneInput[]
  ): Promise<void> {
    const esistenti = await tx.formazioneHr.findMany({
      where: { schedaId },
      select: { id: true },
    });
    const idEsistenti = new Set(esistenti.map((f) => f.id));

    const valide = formazioni.filter((f) => testo(f.nome));
    const idTenuti = new Set(
      valide.map((f) => f.id).filter((fid): fid is number => fid !== undefined && idEsistenti.has(fid))
    );

    await tx.formazioneHr.deleteMany({
      where: { schedaId, id: { notIn: [...idTenuti] } },
    });

    for (const formazione of valide) {
      const nome = testo(formazione.nome)!;
      let formazioneId: number;

      if (formazione.id !== undefined && idTenuti.has(formazione.id)) {
        formazioneId = formazione.id;
        await tx.formazioneHr.update({ where: { id: formazioneId }, data: { nome } });
      } else {
        formazioneId = (await tx.formazioneHr.create({ data: { schedaId, nome } })).id;
      }

      const allegatiIds = formazione.allegatiIds ?? [];

      await tx.allegatoHr.updateMany({
        where: { formazioneId, id: { notIn: allegatiIds } },
        data: { formazioneId: null },
      });

      // Si collegano solo gli orfani o le foto gia' di questa scheda: un id
      // preso da un'altra scheda non deve poterla svuotare
      if (allegatiIds.length > 0) {
        await tx.allegatoHr.updateMany({
          where: {
            id: { in: allegatiIds },
            OR: [{ formazioneId: null, schedaFoto: { is: null } }, { formazione: { schedaId } }],
          },
          data: { formazioneId },
        });
      }
    }
  }

  async delete(id: number): Promise<void> {
    await this.prisma.schedaHr.delete({ where: { id } });
  }
}
