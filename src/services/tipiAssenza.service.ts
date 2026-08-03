import { PrismaClient, TipoAssenza } from '@prisma/client';

export class TipiAssenzaService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false): Promise<TipoAssenza[]> {
    return this.prisma.tipoAssenza.findMany({
      where: includeInactive ? {} : { attivo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<TipoAssenza | null> {
    return this.prisma.tipoAssenza.findUnique({
      where: { id },
    });
  }

  async create(nome: string): Promise<TipoAssenza> {
    return this.prisma.tipoAssenza.create({
      data: { nome },
    });
  }

  async update(id: number, nome: string): Promise<TipoAssenza> {
    return this.prisma.tipoAssenza.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<TipoAssenza> {
    return this.prisma.tipoAssenza.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<TipoAssenza> {
    return this.prisma.tipoAssenza.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
