import { PrismaClient, DreamCliente } from '@prisma/client';

export class DreamClientiService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false): Promise<DreamCliente[]> {
    return this.prisma.dreamCliente.findMany({
      where: includeInactive ? {} : { attivo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<DreamCliente | null> {
    return this.prisma.dreamCliente.findUnique({ where: { id } });
  }

  async create(nome: string): Promise<DreamCliente> {
    return this.prisma.dreamCliente.create({ data: { nome } });
  }

  async update(id: number, nome: string): Promise<DreamCliente> {
    const cliente = await this.prisma.dreamCliente.findUnique({ where: { id } });

    if (!cliente) {
      throw new Error('Cliente non trovato');
    }

    return this.prisma.dreamCliente.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<DreamCliente> {
    return this.prisma.dreamCliente.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<DreamCliente> {
    return this.prisma.dreamCliente.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
