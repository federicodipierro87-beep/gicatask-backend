import { PrismaClient, Prisma } from '@prisma/client';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Le date del calendario sono giorni, non istanti: la colonna e' @db.Date e
 * Prisma la rilegge come mezzanotte UTC. Costruirle con `new Date('2026-07-10')`
 * andrebbe bene, ma passare per il suffisso esplicito rende evidente che il
 * fuso del server non deve entrare in gioco.
 */
function parseDataSolo(valore: string): Date {
  if (!ISO_DATE.test(valore)) {
    throw new Error(`Data non valida: ${valore}`);
  }

  const data = new Date(`${valore}T00:00:00.000Z`);

  if (Number.isNaN(data.getTime())) {
    throw new Error(`Data non valida: ${valore}`);
  }

  return data;
}

function parseOpzionale(valore: string | null | undefined): Date | null {
  if (valore === null || valore === undefined || valore === '') return null;
  return parseDataSolo(valore);
}

export interface CalendarioEventoInput {
  clienteId: number;
  nome?: string | null;
  dataInizio: string;
  dataFine: string;
  dataConsegna?: string | null;
  dataSmontaggio?: string | null;
  importo?: number | null;
}

const includeCliente = {
  cliente: { select: { id: true, nome: true } },
} satisfies Prisma.CalendarioEventoInclude;

function toData(input: CalendarioEventoInput) {
  const dataInizio = parseDataSolo(input.dataInizio);
  const dataFine = parseDataSolo(input.dataFine);

  if (dataFine < dataInizio) {
    throw new Error('La data di fine non puo\' precedere la data di inizio');
  }

  const nome = input.nome?.trim();

  return {
    clienteId: input.clienteId,
    nome: nome ? nome : null,
    dataInizio,
    dataFine,
    dataConsegna: parseOpzionale(input.dataConsegna),
    dataSmontaggio: parseOpzionale(input.dataSmontaggio),
    importo: input.importo ?? null,
  };
}

export class CalendarioEventiService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Un evento appartiene a un anno se il suo intervallo lo interseca, ma anche
   * se ci cade dentro solo la consegna o lo smontaggio: il montaggio di fine
   * dicembre per un evento di gennaio deve comparire su entrambi i fogli.
   */
  async getAll(anno?: number) {
    const where: Prisma.CalendarioEventoWhereInput | undefined =
      anno === undefined
        ? undefined
        : (() => {
            const inizioAnno = new Date(Date.UTC(anno, 0, 1));
            const fineAnno = new Date(Date.UTC(anno, 11, 31));
            const dentroAnno = { gte: inizioAnno, lte: fineAnno };

            return {
              OR: [
                { dataInizio: { lte: fineAnno }, dataFine: { gte: inizioAnno } },
                { dataConsegna: dentroAnno },
                { dataSmontaggio: dentroAnno },
              ],
            };
          })();

    return this.prisma.calendarioEvento.findMany({
      where,
      include: includeCliente,
      orderBy: [{ dataInizio: 'asc' }, { id: 'asc' }],
    });
  }

  async getById(id: number) {
    return this.prisma.calendarioEvento.findUnique({
      where: { id },
      include: includeCliente,
    });
  }

  async create(input: CalendarioEventoInput) {
    return this.prisma.calendarioEvento.create({
      data: toData(input),
      include: includeCliente,
    });
  }

  async update(id: number, input: CalendarioEventoInput) {
    return this.prisma.calendarioEvento.update({
      where: { id },
      data: toData(input),
      include: includeCliente,
    });
  }

  async delete(id: number) {
    await this.prisma.calendarioEvento.delete({ where: { id } });
  }

  /**
   * Anni proposti dal selettore: quelli coperti dagli eventi esistenti piu'
   * l'anno corrente e il successivo, cosi' si puo' pianificare in avanti anche
   * su un calendario vuoto.
   */
  async getAnniDisponibili(): Promise<number[]> {
    const range = await this.prisma.calendarioEvento.aggregate({
      _min: { dataInizio: true, dataConsegna: true },
      _max: { dataFine: true, dataSmontaggio: true },
    });

    const annoCorrente = new Date().getUTCFullYear();
    const anni = new Set<number>([annoCorrente, annoCorrente + 1]);

    const estremi = [
      range._min.dataInizio,
      range._min.dataConsegna,
      range._max.dataFine,
      range._max.dataSmontaggio,
    ].filter((d): d is Date => d !== null);

    if (estremi.length > 0) {
      const primo = Math.min(...estremi.map((d) => d.getUTCFullYear()));
      const ultimo = Math.max(...estremi.map((d) => d.getUTCFullYear()));
      for (let anno = primo; anno <= ultimo; anno++) anni.add(anno);
    }

    return [...anni].sort((a, b) => a - b);
  }
}
