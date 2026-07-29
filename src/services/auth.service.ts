import { PrismaClient, Utente } from '@prisma/client';
import { verifyPassword } from '../utils/password.js';

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async getActiveUsers(): Promise<Pick<Utente, 'id' | 'nome' | 'cognome'>[]> {
    return this.prisma.utente.findMany({
      where: { attivo: true },
      select: {
        id: true,
        nome: true,
        cognome: true,
      },
      orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
    });
  }

  async getUserById(id: number): Promise<Utente | null> {
    return this.prisma.utente.findUnique({
      where: { id },
    });
  }

  async checkUserHasPassword(
    userId: number
  ): Promise<{ exists: boolean; hasPassword: boolean }> {
    const user = await this.prisma.utente.findUnique({
      where: { id: userId, attivo: true },
      select: { passwordHash: true },
    });

    if (!user) {
      return { exists: false, hasPassword: false };
    }

    return {
      exists: true,
      hasPassword: user.passwordHash !== null,
    };
  }

  async validateLogin(
    userId: number,
    password?: string
  ): Promise<{ success: boolean; user?: Utente; error?: string }> {
    const user = await this.prisma.utente.findUnique({
      where: { id: userId, attivo: true },
    });

    if (!user) {
      return { success: false, error: 'User not found or inactive' };
    }

    // User has password - must verify
    if (user.passwordHash) {
      if (!password) {
        return { success: false, error: 'Password required' };
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return { success: false, error: 'Invalid password' };
      }
    }

    // User without password - no password needed
    // (but if password was provided, ignore it)

    return { success: true, user };
  }
}
