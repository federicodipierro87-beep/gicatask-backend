import { PrismaClient, TipoAttivita } from '@prisma/client';

export class TipiAttivitaService {
  constructor(private prisma: PrismaClient) {}

  async getByCantiere(cantiereId: number, includeInactive = false): Promise<TipoAttivita[]> {
    return this.prisma.tipoAttivita.findMany({
      where: {
        cantiereId,
        ...(includeInactive ? {} : { attivo: true }),
      },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<TipoAttivita | null> {
    return this.prisma.tipoAttivita.findUnique({
      where: { id },
      include: { cantiere: true },
    });
  }

  async create(cantiereId: number, nome: string): Promise<TipoAttivita> {
    return this.prisma.tipoAttivita.create({
      data: { cantiereId, nome },
    });
  }

  async update(id: number, nome: string): Promise<TipoAttivita> {
    return this.prisma.tipoAttivita.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<TipoAttivita> {
    return this.prisma.tipoAttivita.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<TipoAttivita> {
    return this.prisma.tipoAttivita.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
