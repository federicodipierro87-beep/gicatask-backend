import { PrismaClient, TipoVoce, VoceBollettino } from '@prisma/client';

/**
 * Anagrafica delle voci selezionabili in un bollettino.
 *
 * Mezzi, materiali e trasporti hanno la stessa forma, quindi condividono una
 * sola tabella discriminata da `tipo`. Il vincolo di unicita' e' sulla coppia
 * (tipo, nome): lo stesso nome puo' esistere come materiale e come trasporto.
 */
export class VociBollettinoService {
  constructor(private prisma: PrismaClient) {}

  async getAll(tipo: TipoVoce, includeInactive = false): Promise<VoceBollettino[]> {
    return this.prisma.voceBollettino.findMany({
      where: { tipo, ...(includeInactive ? {} : { attivo: true }) },
      orderBy: { nome: 'asc' },
    });
  }

  async getById(id: number): Promise<VoceBollettino | null> {
    return this.prisma.voceBollettino.findUnique({
      where: { id },
    });
  }

  async create(tipo: TipoVoce, nome: string): Promise<VoceBollettino> {
    return this.prisma.voceBollettino.create({
      data: { tipo, nome },
    });
  }

  /**
   * Creazione dal form del bollettino: se una voce con lo stesso nome esiste
   * gia' (maiuscole e spazi doppi a parte) si riusa quella, riattivandola se
   * era disattivata. Dal form non c'e' piu' il testo libero, quindi un
   * "gia' presente" lascerebbe l'operatore senza modo di inserire la voce.
   */
  async trovaOCrea(tipo: TipoVoce, nome: string): Promise<VoceBollettino> {
    const pulito = nome.trim().replace(/\s+/g, ' ');

    const esistente = await this.prisma.voceBollettino.findFirst({
      where: { tipo, nome: { equals: pulito, mode: 'insensitive' } },
      orderBy: [{ attivo: 'desc' }, { id: 'asc' }],
    });

    if (esistente) {
      return esistente.attivo ? esistente : this.activate(esistente.id);
    }

    return this.create(tipo, pulito);
  }

  async update(id: number, nome: string): Promise<VoceBollettino> {
    return this.prisma.voceBollettino.update({
      where: { id },
      data: { nome },
    });
  }

  async deactivate(id: number): Promise<VoceBollettino> {
    return this.prisma.voceBollettino.update({
      where: { id },
      data: { attivo: false },
    });
  }

  async activate(id: number): Promise<VoceBollettino> {
    return this.prisma.voceBollettino.update({
      where: { id },
      data: { attivo: true },
    });
  }
}
