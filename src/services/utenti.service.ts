import { PrismaClient, Utente, Ruolo } from '@prisma/client';
import { hashPassword } from '../utils/password.js';
import { decorrenzaDaMese } from '../utils/percentualeLavoro.js';

export class UtentiService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false) {
    const utenti = await this.prisma.utente.findMany({
      where: includeInactive ? {} : { attivo: true },
      // Stesso ordinamento di AuthService.getActiveUsers: i responsabili dopo
      // i dipendenti, perche' l'enum Ruolo li dichiara in quest'ordine
      orderBy: [{ ruolo: 'asc' }, { cognome: 'asc' }, { nome: 'asc' }],
      // Poche righe per utente: servono alla pagina Utenti per mostrare la
      // percentuale in vigore e lo storico
      include: {
        percentualiLavoro: {
          select: { id: true, decorrenza: true, percentuale: true },
          orderBy: { decorrenza: 'asc' },
        },
      },
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
    percentualeLavoro?: number;
  }): Promise<Omit<Utente, 'passwordHash'>> {
    const passwordHash = data.password ? await hashPassword(data.password) : null;

    const utente = await this.prisma.utente.create({
      data: {
        nome: data.nome,
        cognome: data.cognome,
        ruolo: data.ruolo,
        percentualeLavoro: data.percentualeLavoro,
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
      abilitatoBollettini?: boolean;
      percentualeLavoro?: number;
    }
  ): Promise<Omit<Utente, 'passwordHash'>> {
    const utente = await this.prisma.utente.update({
      where: { id },
      data,
    });

    const { passwordHash, ...rest } = utente;
    return rest;
  }

  /**
   * Imposta la percentuale di lavoro di un utente dal mese `YYYY-MM`. Una
   * variazione con la stessa decorrenza viene sovrascritta.
   */
  async setVariazionePercentuale(utenteId: number, meseKey: string, percentuale: number) {
    const decorrenza = decorrenzaDaMese(meseKey);
    if (!decorrenza) {
      throw new Error('Mese di decorrenza non valido');
    }

    const utente = await this.prisma.utente.findUnique({ where: { id: utenteId } });
    if (!utente) {
      throw new Error('Utente non trovato');
    }

    return this.prisma.percentualeLavoro.upsert({
      where: { utenteId_decorrenza: { utenteId, decorrenza } },
      create: { utenteId, decorrenza, percentuale },
      update: { percentuale },
      select: { id: true, decorrenza: true, percentuale: true },
    });
  }

  /** Il vincolo sull'utente impedisce di cancellare la variazione di un altro. */
  async deleteVariazionePercentuale(utenteId: number, variazioneId: number): Promise<void> {
    const { count } = await this.prisma.percentualeLavoro.deleteMany({
      where: { id: variazioneId, utenteId },
    });
    if (count === 0) {
      throw new Error('Variazione non trovata');
    }
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
