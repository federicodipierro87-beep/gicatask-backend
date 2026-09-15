import { PrismaClient, TipoAssenza } from '@prisma/client';
import { isAssenzaNegativa } from '../utils/assenze.js';

export class TipiAssenzaService {
  constructor(private prisma: PrismaClient) {}

  async getAll(includeInactive = false): Promise<TipoAssenza[]> {
    return this.prisma.tipoAssenza.findMany({
      where: includeInactive ? {} : { attivo: true },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<TipoAssenza | null> {
    return this.prisma.tipoAssenza.findUnique({
      where: { id },
    });
  }

  async create(nome: string): Promise<TipoAssenza> {
    return this.prisma.tipoAssenza.create({
      data: { nome },
    });
  }

  async update(id: number, nome: string): Promise<TipoAssenza> {
    // Il segno delle ore dipende dal nome: un rename che lo attraversa
    // cambierebbe di significato tutte le assenze gia' registrate
    const attuale = await this.prisma.tipoAssenza.findUnique({
      where: { id },
      select: { nome: true },
    });

    if (!attuale) {
      throw new Error('Tipo assenza non trovato');
    }

    if (isAssenzaNegativa(attuale.nome) !== isAssenzaNegativa(nome)) {
      throw new Error(
        'Questo nome cambierebbe il segno delle ore registrate. ' +
          'Crea un nuovo tipo assenza invece di rinominare questo.'
      );
    }

    return this.prisma.tipoAssenza.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<TipoAssenza> {
    return this.prisma.tipoAssenza.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<TipoAssenza> {
    return this.prisma.tipoAssenza.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
