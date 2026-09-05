import { PrismaClient, DreamVeicolo } from '@prisma/client';

export class DreamVeicoliService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false): Promise<DreamVeicolo[]> {
    return this.prisma.dreamVeicolo.findMany({
      where: includeInactive ? {} : { attivo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<DreamVeicolo | null> {
    return this.prisma.dreamVeicolo.findUnique({ where: { id } });
  }

  async create(nome: string): Promise<DreamVeicolo> {
    return this.prisma.dreamVeicolo.create({ data: { nome } });
  }

  async update(id: number, nome: string): Promise<DreamVeicolo> {
    const veicolo = await this.prisma.dreamVeicolo.findUnique({ where: { id } });

    if (!veicolo) {
      throw new Error('Veicolo non trovato');
    }

    return this.prisma.dreamVeicolo.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<DreamVeicolo> {
    return this.prisma.dreamVeicolo.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<DreamVeicolo> {
    return this.prisma.dreamVeicolo.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
