import { PrismaClient, Cantiere } from '@prisma/client';

export class CantieriService {
  constructor(private prisma: PrismaClient) {}

  async getByCliente(clienteId: number, includeInactive = false): Promise<Cantiere[]> {
    return this.prisma.cantiere.findMany({
      where: {
        clienteId,
        ...(includeInactive ? {} : { attivo: true }),
      },
      include: {
        tipiAttivita: {
          where: includeInactive ? {} : { attivo: true },
          orderBy: { nome: 'asc' },
        },
      },
      orderBy: [{ isGenerico: 'desc' }, { nome: 'asc' }],
    });
  }

  async getById(id: number): Promise<Cantiere | null> {
    return this.prisma.cantiere.findUnique({
      where: { id },
      include: {
        cliente: true,
        tipiAttivita: {
          where: { attivo: true },
          orderBy: { nome: 'asc' },
        },
      },
    });
  }

  async create(clienteId: number, nome: string): Promise<Cantiere> {
    // Cannot create cantiere named "Generico" - reserved
    if (nome.toLowerCase() === 'generico') {
      throw new Error('Il nome "Generico" è riservato');
    }

    const cantiere = await this.prisma.cantiere.create({
      data: {
        clienteId,
        nome,
        isGenerico: false,
      },
    });

    // Create default activity type
    await this.prisma.tipoAttivita.create({
      data: {
        cantiereId: cantiere.id,
        nome: 'Attività generale',
      },
    });

    return cantiere;
  }

  async update(id: number, nome: string): Promise<Cantiere> {
    const cantiere = await this.prisma.cantiere.findUnique({ where: { id } });

    if (!cantiere) {
      throw new Error('Cantiere non trovato');
    }

    if (cantiere.isGenerico) {
      throw new Error('Non è possibile modificare il cantiere generico');
    }

    if (nome.toLowerCase() === 'generico') {
      throw new Error('Il nome "Generico" è riservato');
    }

    return this.prisma.cantiere.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<Cantiere> {
    const cantiere = await this.prisma.cantiere.findUnique({ where: { id } });

    if (cantiere?.isGenerico) {
      throw new Error('Non è possibile disattivare il cantiere generico');
    }

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
