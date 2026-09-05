import { PrismaClient, Prisma, QuotaNoleggio } from '@prisma/client';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La data del noleggio e' un giorno, non un istante: la colonna e' @db.Date e
 * Prisma la rilegge come mezzanotte UTC. Il suffisso esplicito rende evidente
 * che il fuso del server non deve entrare in gioco.
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

/**
 * Con la quota 70/30 l'azienda incassa il 70% del noleggio, con la quota 100
 * l'intero importo. Il calcolo sta qui e non sul client: il form ne mostra solo
 * un'anteprima, il valore salvato e' quello prodotto dal server.
 */
export function calcolaImporto(importo: number, quota: QuotaNoleggio): number {
  const lordo = quota === 'SETTANTA_TRENTA' ? importo * 0.7 : importo;
  return Math.round(lordo * 100) / 100;
}

export interface DreamNoleggioInput {
  veicoloId: number;
  clienteId?: number | null;
  data: string;
  osservazioni?: string | null;
  importo: number;
  quota: QuotaNoleggio;
}

export interface DreamNoleggiFilters {
  startDate?: string;
  endDate?: string;
  veicoloId?: number;
}

const includeRelazioni = {
  veicolo: { select: { id: true, nome: true } },
  cliente: { select: { id: true, nome: true } },
} satisfies Prisma.DreamNoleggioInclude;

function toData(input: DreamNoleggioInput) {
  const osservazioni = input.osservazioni?.trim();

  return {
    veicoloId: input.veicoloId,
    clienteId: input.clienteId ?? null,
    data: parseDataSolo(input.data),
    osservazioni: osservazioni ? osservazioni : null,
    importo: input.importo,
    quota: input.quota,
    importoCalcolato: calcolaImporto(input.importo, input.quota),
  };
}

export class DreamNoleggiService {
  constructor(private prisma: PrismaClient) {}

  async getAll(filters: DreamNoleggiFilters = {}) {
    const { startDate, endDate, veicoloId } = filters;

    const data =
      startDate || endDate
        ? {
            ...(startDate ? { gte: parseDataSolo(startDate) } : {}),
            ...(endDate ? { lte: parseDataSolo(endDate) } : {}),
          }
        : undefined;

    return this.prisma.dreamNoleggio.findMany({
      where: {
        ...(data ? { data } : {}),
        ...(veicoloId ? { veicoloId } : {}),
      },
      include: includeRelazioni,
      orderBy: [{ data: 'asc' }, { id: 'asc' }],
    });
  }

  async getById(id: number) {
    return this.prisma.dreamNoleggio.findUnique({
      where: { id },
      include: includeRelazioni,
    });
  }

  async create(input: DreamNoleggioInput) {
    return this.prisma.dreamNoleggio.create({
      data: toData(input),
      include: includeRelazioni,
    });
  }

  async update(id: number, input: DreamNoleggioInput) {
    return this.prisma.dreamNoleggio.update({
      where: { id },
      data: toData(input),
      include: includeRelazioni,
    });
  }

  async delete(id: number) {
    await this.prisma.dreamNoleggio.delete({ where: { id } });
  }
}
