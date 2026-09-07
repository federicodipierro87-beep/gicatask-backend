import { PrismaClient, Prisma } from '@prisma/client';
import { parseDataSolo } from '../utils/dataSolo.js';

export interface GicaNoleggioInput {
  veicoloId: number;
  clienteId?: number | null;
  data: string;
  osservazioni?: string | null;
  importo: number;
}

export interface GicaNoleggiFilters {
  startDate?: string;
  endDate?: string;
  veicoloId?: number;
}

const includeRelazioni = {
  veicolo: { select: { id: true, nome: true } },
  cliente: { select: { id: true, nome: true } },
} satisfies Prisma.GicaNoleggioInclude;

function toData(input: GicaNoleggioInput) {
  const osservazioni = input.osservazioni?.trim();

  return {
    veicoloId: input.veicoloId,
    clienteId: input.clienteId ?? null,
    data: parseDataSolo(input.data),
    osservazioni: osservazioni ? osservazioni : null,
    importo: input.importo,
  };
}

export class GicaNoleggiService {
  constructor(private prisma: PrismaClient) {}

  async getAll(filters: GicaNoleggiFilters = {}) {
    const { startDate, endDate, veicoloId } = filters;

    const data =
      startDate || endDate
        ? {
            ...(startDate ? { gte: parseDataSolo(startDate) } : {}),
            ...(endDate ? { lte: parseDataSolo(endDate) } : {}),
          }
        : undefined;

    return this.prisma.gicaNoleggio.findMany({
      where: {
        ...(data ? { data } : {}),
        ...(veicoloId ? { veicoloId } : {}),
      },
      include: includeRelazioni,
      orderBy: [{ data: 'asc' }, { id: 'asc' }],
    });
  }

  async getById(id: number) {
    return this.prisma.gicaNoleggio.findUnique({
      where: { id },
      include: includeRelazioni,
    });
  }

  async create(input: GicaNoleggioInput) {
    return this.prisma.gicaNoleggio.create({
      data: toData(input),
      include: includeRelazioni,
    });
  }

  async update(id: number, input: GicaNoleggioInput) {
    return this.prisma.gicaNoleggio.update({
      where: { id },
      data: toData(input),
      include: includeRelazioni,
    });
  }

  async delete(id: number) {
    await this.prisma.gicaNoleggio.delete({ where: { id } });
  }
}
