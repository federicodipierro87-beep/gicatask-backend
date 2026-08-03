import { PrismaClient, Cliente } from '@prisma/client';

export class ClientiService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false): Promise<Cliente[]> {
    return this.prisma.cliente.findMany({
      where: includeInactive ? {} : { attivo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<Cliente | null> {
    return this.prisma.cliente.findUnique({
      where: { id },
      include: {
        cantieri: {
          where: { attivo: true },
          orderBy: { nome: 'asc' },
        },
      },
    });
  }

  async create(nome: string): Promise<Cliente> {
    return this.prisma.cliente.create({ data: { nome } });
  }

  async update(id: number, nome: string): Promise<Cliente> {
    return this.prisma.cliente.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<Cliente> {
    return this.prisma.cliente.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<Cliente> {
    return this.prisma.cliente.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
