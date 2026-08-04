import { PrismaClient, Attivita } from '@prisma/client';
import { calculateDurationMinutes, isWithinSameWeek } from '../utils/duration.js';

interface CreateAttivitaInput {
  utenteId: number;
  dataRiferimento: Date;
  oraInizioMattino?: string;
  oraFineMattino?: string;
  oraInizioPomeriggio?: string;
  oraFinePomeriggio?: string;
  clienteId?: number | null;
  cantiereId?: number | null;
  tipoAttivitaId?: number | null;
  assenzaId?: number | null;
  note?: string;
  createdById: number;
}

// Un'assenza vale una giornata lavorativa piena, a prescindere dagli orari inseriti
const DURATA_ASSENZA_MINUTI = 8 * 60 + 12;

function calculateTotalDuration(
  oraInizioMattino?: string,
  oraFineMattino?: string,
  oraInizioPomeriggio?: string,
  oraFinePomeriggio?: string
): number {
  let total = 0;

  if (oraInizioMattino && oraFineMattino) {
    total += calculateDurationMinutes(oraInizioMattino, oraFineMattino);
  }

  if (oraInizioPomeriggio && oraFinePomeriggio) {
    total += calculateDurationMinutes(oraInizioPomeriggio, oraFinePomeriggio);
  }

  return total;
}

interface AttivitaWithRelations extends Attivita {
  cliente: { id: number; nome: string } | null;
  cantiere: { id: number; nome: string } | null;
  tipoAttivita: { id: number; nome: string } | null;
  assenza: { id: number; nome: string } | null;
  utente: { id: number; nome: string; cognome: string };
}

export class AttivitaService {
  constructor(private prisma: PrismaClient) {}

  async getByUtente(
    utenteId: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<AttivitaWithRelations[]> {
    return this.prisma.attivita.findMany({
      where: {
        utenteId,
        ...(startDate && endDate
          ? {
              dataRiferimento: {
                gte: startDate,
                lte: endDate,
              },
            }
          : {}),
      },
      include: {
        cliente: { select: { id: true, nome: true } },
        cantiere: { select: { id: true, nome: true } },
        tipoAttivita: { select: { id: true, nome: true } },
        assenza: { select: { id: true, nome: true } },
        utente: { select: { id: true, nome: true, cognome: true } },
      },
      orderBy: [{ dataRiferimento: 'desc' }, { oraInizioMattino: 'desc' }],
    });
  }

  async getAll(
    filters: {
      utenteId?: number;
      clienteId?: number;
      cantiereId?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<AttivitaWithRelations[]> {
    return this.prisma.attivita.findMany({
      where: {
        ...(filters.utenteId ? { utenteId: filters.utenteId } : {}),
        ...(filters.clienteId ? { clienteId: filters.clienteId } : {}),
        ...(filters.cantiereId ? { cantiereId: filters.cantiereId } : {}),
        ...(filters.startDate && filters.endDate
          ? {
              dataRiferimento: {
                gte: filters.startDate,
                lte: filters.endDate,
              },
            }
          : {}),
      },
      include: {
        cliente: { select: { id: true, nome: true } },
        cantiere: { select: { id: true, nome: true } },
        tipoAttivita: { select: { id: true, nome: true } },
        assenza: { select: { id: true, nome: true } },
        utente: { select: { id: true, nome: true, cognome: true } },
      },
      orderBy: [{ dataRiferimento: 'desc' }, { oraInizioMattino: 'desc' }],
    });
  }

  async getById(id: number): Promise<AttivitaWithRelations | null> {
    return this.prisma.attivita.findUnique({
      where: { id },
      include: {
        cliente: { select: { id: true, nome: true } },
        cantiere: { select: { id: true, nome: true } },
        tipoAttivita: { select: { id: true, nome: true } },
        assenza: { select: { id: true, nome: true } },
        utente: { select: { id: true, nome: true, cognome: true } },
      },
    });
  }

  // The cantiere is mandatory only for clienti that have at least one active cantiere
  private async assertCantiereWhenRequired(clienteId: number, cantiereId?: number | null) {
    if (cantiereId) return;

    const count = await this.prisma.cantiere.count({
      where: { clienteId, attivo: true },
    });

    if (count > 0) {
      throw new Error('Il cantiere è obbligatorio per questo cliente');
    }
  }

  async create(input: CreateAttivitaInput): Promise<Attivita> {
    // With an absence selected, cliente/cantiere and time slots are optional
    const isAssenza = input.assenzaId != null;

    if (!isAssenza) {
      if (!input.clienteId) {
        throw new Error('Il cliente è obbligatorio');
      }

      await this.assertCantiereWhenRequired(input.clienteId, input.cantiereId);

      const hasMattino = input.oraInizioMattino && input.oraFineMattino;
      const hasPomeriggio = input.oraInizioPomeriggio && input.oraFinePomeriggio;

      if (!hasMattino && !hasPomeriggio) {
        throw new Error('Devi inserire almeno una fascia oraria (mattino o pomeriggio)');
      }
    }

    const durataMinuti = isAssenza
      ? DURATA_ASSENZA_MINUTI
      : calculateTotalDuration(
          input.oraInizioMattino,
          input.oraFineMattino,
          input.oraInizioPomeriggio,
          input.oraFinePomeriggio
        );

    return this.prisma.attivita.create({
      data: {
        utenteId: input.utenteId,
        dataRiferimento: input.dataRiferimento,
        oraInizioMattino: input.oraInizioMattino || null,
        oraFineMattino: input.oraFineMattino || null,
        oraInizioPomeriggio: input.oraInizioPomeriggio || null,
        oraFinePomeriggio: input.oraFinePomeriggio || null,
        durataMinuti,
        clienteId: input.clienteId ?? null,
        cantiereId: input.cantiereId ?? null,
        tipoAttivitaId: input.tipoAttivitaId ?? null,
        assenzaId: input.assenzaId ?? null,
        note: input.note,
        createdById: input.createdById,
      },
    });
  }

  async update(
    id: number,
    input: Partial<Omit<CreateAttivitaInput, 'utenteId' | 'createdById'>>,
    requesterId: number,
    isResponsabile: boolean
  ): Promise<Attivita> {
    const attivita = await this.prisma.attivita.findUnique({ where: { id } });

    if (!attivita) {
      throw new Error('Attività non trovata');
    }

    // Check if user can edit (responsabile can always edit, dipendente only in same week)
    if (!isResponsabile) {
      if (attivita.utenteId !== requesterId) {
        throw new Error('Non puoi modificare attività di altri utenti');
      }

      if (!isWithinSameWeek(attivita.dataRiferimento)) {
        throw new Error('Puoi modificare solo attività della settimana corrente');
      }
    }

    // Calculate new duration based on provided or existing values
    const oraInizioMattino = input.oraInizioMattino !== undefined ? input.oraInizioMattino : attivita.oraInizioMattino;
    const oraFineMattino = input.oraFineMattino !== undefined ? input.oraFineMattino : attivita.oraFineMattino;
    const oraInizioPomeriggio = input.oraInizioPomeriggio !== undefined ? input.oraInizioPomeriggio : attivita.oraInizioPomeriggio;
    const oraFinePomeriggio = input.oraFinePomeriggio !== undefined ? input.oraFinePomeriggio : attivita.oraFinePomeriggio;

    // Merge the other fields too, to validate against the resulting record
    const clienteId = input.clienteId !== undefined ? input.clienteId : attivita.clienteId;
    const cantiereId = input.cantiereId !== undefined ? input.cantiereId : attivita.cantiereId;
    const assenzaId = input.assenzaId !== undefined ? input.assenzaId : attivita.assenzaId;

    // With an absence selected, cliente/cantiere and time slots are optional
    const isAssenza = assenzaId != null;

    if (!isAssenza) {
      if (!clienteId) {
        throw new Error('Il cliente è obbligatorio');
      }

      await this.assertCantiereWhenRequired(clienteId, cantiereId);

      const hasMattino = oraInizioMattino && oraFineMattino;
      const hasPomeriggio = oraInizioPomeriggio && oraFinePomeriggio;

      if (!hasMattino && !hasPomeriggio) {
        throw new Error('Devi inserire almeno una fascia oraria (mattino o pomeriggio)');
      }
    }

    const durataMinuti = isAssenza
      ? DURATA_ASSENZA_MINUTI
      : calculateTotalDuration(
          oraInizioMattino || undefined,
          oraFineMattino || undefined,
          oraInizioPomeriggio || undefined,
          oraFinePomeriggio || undefined
        );

    return this.prisma.attivita.update({
      where: { id },
      data: {
        ...(input.dataRiferimento ? { dataRiferimento: input.dataRiferimento } : {}),
        ...(input.oraInizioMattino !== undefined ? { oraInizioMattino: input.oraInizioMattino || null } : {}),
        ...(input.oraFineMattino !== undefined ? { oraFineMattino: input.oraFineMattino || null } : {}),
        ...(input.oraInizioPomeriggio !== undefined ? { oraInizioPomeriggio: input.oraInizioPomeriggio || null } : {}),
        ...(input.oraFinePomeriggio !== undefined ? { oraFinePomeriggio: input.oraFinePomeriggio || null } : {}),
        durataMinuti,
        ...(input.clienteId !== undefined ? { clienteId: input.clienteId ?? null } : {}),
        ...(input.cantiereId !== undefined ? { cantiereId: input.cantiereId ?? null } : {}),
        ...(input.tipoAttivitaId !== undefined ? { tipoAttivitaId: input.tipoAttivitaId || null } : {}),
        ...(input.assenzaId !== undefined ? { assenzaId: input.assenzaId ?? null } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
  }

  async delete(id: number, requesterId: number, isResponsabile: boolean): Promise<void> {
    const attivita = await this.prisma.attivita.findUnique({ where: { id } });

    if (!attivita) {
      throw new Error('Attività non trovata');
    }

    if (!isResponsabile) {
      if (attivita.utenteId !== requesterId) {
        throw new Error('Non puoi eliminare attività di altri utenti');
      }

      if (!isWithinSameWeek(attivita.dataRiferimento)) {
        throw new Error('Puoi eliminare solo attività della settimana corrente');
      }
    }

    await this.prisma.attivita.delete({ where: { id } });
  }
}
