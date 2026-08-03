import { PrismaClient, Cantiere } from '@prisma/client';

export class CantieriService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false) {
    return this.prisma.cantiere.findMany({
      where: includeInactive ? {} : { attivo: true },
      include: {
        cliente: {
          select: { id: true, nome: true },
        },
      },
      orderBy: [{ cliente: { nome: 'asc' } }, { nome: 'asc' }],
    });
  }

  async getByCliente(clienteId: number, includeInactive = false): Promise<Cantiere[]> {
    return this.prisma.cantiere.findMany({
      where: {
        clienteId,
        ...(includeInactive ? {} : { attivo: true }),
      },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<Cantiere | null> {
    return this.prisma.cantiere.findUnique({
      where: { id },
      include: {
        cliente: true,
      },
    });
  }

  async create(clienteId: number, nome: string): Promise<Cantiere> {
    return this.prisma.cantiere.create({
      data: {
        clienteId,
        nome,
      },
    });
  }

  async update(id: number, nome: string): Promise<Cantiere> {
    const cantiere = await this.prisma.cantiere.findUnique({ where: { id } });

    if (!cantiere) {
      throw new Error('Cantiere non trovato');
    }

    return this.prisma.cantiere.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<Cantiere> {
    return this.prisma.cantiere.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<Cantiere> {
    return this.prisma.cantiere.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
