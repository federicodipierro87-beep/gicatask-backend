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

  // `emailFatturazione` assente = non toccata, vuota = tolta
  async create(nome: string, emailFatturazione?: string): Promise<Cliente> {
    return this.prisma.cliente.create({
      data: { nome, emailFatturazione: emailFatturazione?.trim() || null },
    });
  }

  async update(id: number, nome: string, emailFatturazione?: string): Promise<Cliente> {
    return this.prisma.cliente.update({
      where: { id },
      data: {
        nome,
        ...(emailFatturazione !== undefined
          ? { emailFatturazione: emailFatturazione.trim() || null }
          : {}),
      },
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
