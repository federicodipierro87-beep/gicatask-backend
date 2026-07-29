import { PrismaClient, TipoAttivita } from '@prisma/client';

export class TipiAttivitaService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false): Promise<TipoAttivita[]> {
    return this.prisma.tipoAttivita.findMany({
      where: includeInactive ? {} : { attivo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<TipoAttivita | null> {
    return this.prisma.tipoAttivita.findUnique({
      where: { id },
    });
  }

  async create(nome: string): Promise<TipoAttivita> {
    return this.prisma.tipoAttivita.create({
      data: { nome },
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
