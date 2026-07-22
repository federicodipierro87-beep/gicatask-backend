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
    // Create cliente with automatic generic cantiere
    const cliente = await this.prisma.cliente.create({
      data: { nome },
    });

    // Create generic cantiere
    const cantiere = await this.prisma.cantiere.create({
      data: {
        clienteId: cliente.id,
        nome: 'Generico',
        isGenerico: true,
      },
    });

    // Create default activity types for generic cantiere
    await this.prisma.tipoAttivita.createMany({
      data: [
        { cantiereId: cantiere.id, nome: 'Consulenza' },
        { cantiereId: cantiere.id, nome: 'Supporto' },
        { cantiereId: cantiere.id, nome: 'Altro' },
      ],
    });

    return cliente;
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
