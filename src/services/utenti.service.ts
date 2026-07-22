import { PrismaClient, Utente, Ruolo } from '@prisma/client';
import { hashPassword } from '../utils/password.js';

export class UtentiService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false): Promise<Omit<Utente, 'passwordHash'>[]> {
    const utenti = await this.prisma.utente.findMany({
      where: includeInactive ? {} : { attivo: true },
      orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
    });

    return utenti.map(({ passwordHash, ...rest }) => rest);
  }

  async getById(id: number): Promise<Omit<Utente, 'passwordHash'> | null> {
    const utente = await this.prisma.utente.findUnique({
      where: { id },
    });

    if (!utente) return null;

    const { passwordHash, ...rest } = utente;
    return rest;
  }

  async create(data: {
    nome: string;
    cognome: string;
    ruolo: Ruolo;
    password?: string;
  }): Promise<Omit<Utente, 'passwordHash'>> {
    const passwordHash = data.password ? await hashPassword(data.password) : null;

    const utente = await this.prisma.utente.create({
      data: {
        nome: data.nome,
        cognome: data.cognome,
        ruolo: data.ruolo,
        passwordHash,
      },
    });

    const { passwordHash: _, ...rest } = utente;
    return rest;
  }

  async update(
    id: number,
    data: {
      nome?: string;
      cognome?: string;
      ruolo?: Ruolo;
    }
  ): Promise<Omit<Utente, 'passwordHash'>> {
    const utente = await this.prisma.utente.update({
      where: { id },
      data,
    });

    const { passwordHash, ...rest } = utente;
    return rest;
  }

  async setPassword(id: number, password: string | null): Promise<void> {
    const passwordHash = password ? await hashPassword(password) : null;

    await this.prisma.utente.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async deactivate(id: number): Promise<Omit<Utente, 'passwordHash'>> {
    const utente = await this.prisma.utente.update({
      where: { id },
      data: { attivo: false },
    });

    const { passwordHash, ...rest } = utente;
    return rest;
  }

  async activate(id: number): Promise<Omit<Utente, 'passwordHash'>> {
    const utente = await this.prisma.utente.update({
      where: { id },
      data: { attivo: true },
    });

    const { passwordHash, ...rest } = utente;
    return rest;
  }
}
