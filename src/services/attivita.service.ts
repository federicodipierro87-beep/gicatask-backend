import { PrismaClient, Prisma, Attivita, LuogoAttivita } from '@prisma/client';
import { calculateDurationMinutes } from '../utils/duration.js';
import { durataAssenzaMinuti } from '../utils/assenze.js';

interface CreateAttivitaInput {
  utenteId: number;
  dataRiferimento: Date;
  oraInizioMattino?: string;
  oraFineMattino?: string;
  oraInizioPomeriggio?: string;
  oraFinePomeriggio?: string;
  clienteId?: number | null;
  // Cliente scritto a mano, al posto di `clienteId` (Nuova Attività 2 in cantiere)
  clienteNome?: string | null;
  cantiereId?: number | null;
  tipoAttivitaId?: number | null;
  assenzaId?: number | null;
  luogo?: LuogoAttivita | null;
  note?: string;
  createdById: number;
}

/**
 * Cliente scritto a mano. `id` NULL: non è in anagrafica e lo crea il
 * salvataggio dell'attività; `riattiva`: corrisponde a uno disattivato.
 */
interface ClienteScritto {
  id: number | null;
  nome: string;
  riattiva: boolean;
}

function pulisciNome(valore: string | null | undefined, max = 200): string {
  return (valore ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const insensibile = (nome: string) => ({ equals: nome, mode: 'insensitive' as const });

/**
 * Un dipendente senza il flag del modulo non può usarlo: le rotte rispondono
 * 403 invece del solito 400.
 */
export class ModuloNonAbilitatoError extends Error {}

type ModuloAttivita = 'attivita' | 'attivita2';

/**
 * Il modulo da cui nasce un'attività: col luogo "Nuova Attività 2", col
 * cliente "Nuova Attività". Le assenze non dipendono da nessuno dei due.
 */
function moduloRichiesto(assenzaId: number | null, luogo: LuogoAttivita | null): ModuloAttivita | null {
  if (assenzaId !== null) return null;
  return luogo ? 'attivita2' : 'attivita';
}

/**
 * Il cliente (e il cantiere, se il cliente ne ha) è obbligatorio per le
 * attività normali e per quelle in cantiere di "Nuova Attività 2". In
 * magazzino il form propone da solo il cliente Gica, senza cantiere.
 */
function richiedeCliente(luogo: LuogoAttivita | null): boolean {
  return luogo !== 'MAGAZZINO';
}

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

  // Il flag è letto dal database e non dal token, come per bollettini e
  // noleggi: toglierlo ha effetto subito
  private async assertModuloAbilitato(utenteId: number, modulo: ModuloAttivita | null) {
    if (modulo === null) return;

    const utente = await this.prisma.utente.findUnique({
      where: { id: utenteId },
      select: { abilitatoAttivita: true, abilitatoAttivita2: true },
    });
    const abilitato = modulo === 'attivita' ? utente?.abilitatoAttivita : utente?.abilitatoAttivita2;

    if (!abilitato) {
      throw new ModuloNonAbilitatoError(
        modulo === 'attivita'
          ? 'Non sei abilitato a Nuova Attività'
          : 'Non sei abilitato a Nuova Attività 2'
      );
    }
  }

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
      utentiIds?: number[];
      clientiIds?: number[];
      cantiereId?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<AttivitaWithRelations[]> {
    return this.prisma.attivita.findMany({
      where: {
        ...(filters.utentiIds?.length ? { utenteId: { in: filters.utentiIds } } : {}),
        ...(filters.clientiIds?.length ? { clienteId: { in: filters.clientiIds } } : {}),
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

  /**
   * Come nei Bollettini Nuovi: si collega il cliente in anagrafica con lo
   * stesso nome, maiuscole a parte, prima gli attivi. `null` se il nome è vuoto.
   */
  private async risolviClienteScritto(nome?: string | null): Promise<ClienteScritto | null> {
    const nomeScritto = pulisciNome(nome);
    if (!nomeScritto) return null;

    const esistente = await this.prisma.cliente.findFirst({
      where: { nome: insensibile(nomeScritto) },
      select: { id: true, nome: true, attivo: true },
      orderBy: [{ attivo: 'desc' }, { id: 'asc' }],
    });

    return esistente
      ? { id: esistente.id, nome: esistente.nome, riattiva: !esistente.attivo }
      : { id: null, nome: nomeScritto, riattiva: false };
  }

  // Il cliente nuovo entra in anagrafica solo se l'attività si salva. Si
  // ricerca qui dentro perché un altro salvataggio potrebbe averlo appena creato
  private async salvaClienteScritto(tx: Prisma.TransactionClient, cliente: ClienteScritto): Promise<number> {
    if (cliente.id !== null) {
      if (cliente.riattiva) {
        await tx.cliente.update({ where: { id: cliente.id }, data: { attivo: true } });
      }
      return cliente.id;
    }

    const creato =
      (await tx.cliente.findFirst({
        where: { nome: insensibile(cliente.nome) },
        select: { id: true },
        orderBy: [{ attivo: 'desc' }, { id: 'asc' }],
      })) ??
      (await tx.cliente.create({ data: { nome: cliente.nome }, select: { id: true } }));
    return creato.id;
  }

  // Il cantiere conta solo per un cliente già attivo: di uno nuovo o
  // disattivato il form non ha proposto i cantieri
  private async assertCantiereClienteScritto(cliente: ClienteScritto, cantiereId?: number | null) {
    if (cliente.id !== null && !cliente.riattiva) {
      await this.assertCantiereWhenRequired(cliente.id, cantiereId);
    }
  }

  // Un'assenza vale una giornata lavorativa piena, col segno che dipende dal
  // tipo: il Recupero ore sottrae le ore invece di aggiungerle
  private async durataAssenza(assenzaId: number): Promise<number> {
    const tipo = await this.prisma.tipoAssenza.findUnique({
      where: { id: assenzaId },
      select: { nome: true },
    });

    if (!tipo) {
      throw new Error('Tipo assenza non valido');
    }

    return durataAssenzaMinuti(tipo.nome);
  }

  /**
   * `verificaModulo` è false per il responsabile, che assegna e corregge le
   * attività di tutti indipendentemente dai propri flag.
   */
  async create(input: CreateAttivitaInput, verificaModulo = false): Promise<Attivita> {
    // With an absence selected, cliente/cantiere and time slots are optional
    const assenzaId = input.assenzaId ?? null;
    // "Nuova Attivita 2": il luogo prende il posto del tipo
    const luogo = assenzaId === null ? input.luogo ?? null : null;

    if (verificaModulo) {
      await this.assertModuloAbilitato(input.utenteId, moduloRichiesto(assenzaId, luogo));
    }

    const clienteScritto = input.clienteId ? null : await this.risolviClienteScritto(input.clienteNome);

    if (assenzaId === null) {
      if (richiedeCliente(luogo)) {
        if (clienteScritto) {
          await this.assertCantiereClienteScritto(clienteScritto, input.cantiereId);
        } else if (!input.clienteId) {
          throw new Error('Il cliente è obbligatorio');
        } else {
          await this.assertCantiereWhenRequired(input.clienteId, input.cantiereId);
        }
      }

      const hasMattino = input.oraInizioMattino && input.oraFineMattino;
      const hasPomeriggio = input.oraInizioPomeriggio && input.oraFinePomeriggio;

      if (!hasMattino && !hasPomeriggio) {
        throw new Error('Devi inserire almeno una fascia oraria (mattino o pomeriggio)');
      }
    }

    const durataMinuti = assenzaId !== null
      ? await this.durataAssenza(assenzaId)
      : calculateTotalDuration(
          input.oraInizioMattino,
          input.oraFineMattino,
          input.oraInizioPomeriggio,
          input.oraFinePomeriggio
        );

    return this.prisma.$transaction(async (tx) => tx.attivita.create({
      data: {
        utenteId: input.utenteId,
        dataRiferimento: input.dataRiferimento,
        oraInizioMattino: input.oraInizioMattino || null,
        oraFineMattino: input.oraFineMattino || null,
        oraInizioPomeriggio: input.oraInizioPomeriggio || null,
        oraFinePomeriggio: input.oraFinePomeriggio || null,
        durataMinuti,
        clienteId: clienteScritto
          ? await this.salvaClienteScritto(tx, clienteScritto)
          : input.clienteId ?? null,
        cantiereId: luogo === 'MAGAZZINO' || clienteScritto?.id === null ? null : input.cantiereId ?? null,
        tipoAttivitaId: luogo ? null : input.tipoAttivitaId ?? null,
        assenzaId: input.assenzaId ?? null,
        luogo,
        note: input.note,
        createdById: input.createdById,
      },
    }));
  }

  async update(
    id: number,
    input: Partial<Omit<CreateAttivitaInput, 'createdById'>>,
    requesterId: number,
    isResponsabile: boolean
  ): Promise<Attivita> {
    const attivita = await this.prisma.attivita.findUnique({ where: { id } });

    if (!attivita) {
      throw new Error('Attività non trovata');
    }

    // A dipendente can only edit their own activities
    if (!isResponsabile && attivita.utenteId !== requesterId) {
      throw new Error('Non puoi modificare attività di altri utenti');
    }

    // Calculate new duration based on provided or existing values
    const oraInizioMattino = input.oraInizioMattino !== undefined ? input.oraInizioMattino : attivita.oraInizioMattino;
    const oraFineMattino = input.oraFineMattino !== undefined ? input.oraFineMattino : attivita.oraFineMattino;
    const oraInizioPomeriggio = input.oraInizioPomeriggio !== undefined ? input.oraInizioPomeriggio : attivita.oraInizioPomeriggio;
    const oraFinePomeriggio = input.oraFinePomeriggio !== undefined ? input.oraFinePomeriggio : attivita.oraFinePomeriggio;

    // Merge the other fields too, to validate against the resulting record
    const clienteScritto = input.clienteId ? null : await this.risolviClienteScritto(input.clienteNome);
    const clienteId = input.clienteId !== undefined ? input.clienteId : attivita.clienteId;
    const cantiereId = input.cantiereId !== undefined ? input.cantiereId : attivita.cantiereId;
    const assenzaId = input.assenzaId !== undefined ? input.assenzaId : attivita.assenzaId;

    // With an absence selected, cliente/cantiere and time slots are optional
    const isAssenza = assenzaId != null;
    const luogo = isAssenza
      ? null
      : input.luogo !== undefined ? input.luogo : attivita.luogo;

    // Chi ha perso il modulo corregge ancora le attività già inserite: il
    // flag serve solo se la modifica la fa diventare di un altro tipo
    if (!isResponsabile) {
      const prima = moduloRichiesto(attivita.assenzaId, attivita.luogo);
      const dopo = moduloRichiesto(assenzaId ?? null, luogo ?? null);
      if (dopo !== prima) {
        await this.assertModuloAbilitato(requesterId, dopo);
      }
    }

    if (!isAssenza) {
      if (richiedeCliente(luogo ?? null)) {
        if (clienteScritto) {
          await this.assertCantiereClienteScritto(clienteScritto, cantiereId);
        } else if (!clienteId) {
          throw new Error('Il cliente è obbligatorio');
        } else {
          await this.assertCantiereWhenRequired(clienteId, cantiereId);
        }
      }

      const hasMattino = oraInizioMattino && oraFineMattino;
      const hasPomeriggio = oraInizioPomeriggio && oraFinePomeriggio;

      if (!hasMattino && !hasPomeriggio) {
        throw new Error('Devi inserire almeno una fascia oraria (mattino o pomeriggio)');
      }
    }

    const durataMinuti = assenzaId !== null
      ? await this.durataAssenza(assenzaId)
      : calculateTotalDuration(
          oraInizioMattino || undefined,
          oraFineMattino || undefined,
          oraInizioPomeriggio || undefined,
          oraFinePomeriggio || undefined
        );

    return this.prisma.$transaction(async (tx) => tx.attivita.update({
      where: { id },
      data: {
        ...(input.utenteId !== undefined ? { utenteId: input.utenteId } : {}),
        ...(input.dataRiferimento ? { dataRiferimento: input.dataRiferimento } : {}),
        ...(input.oraInizioMattino !== undefined ? { oraInizioMattino: input.oraInizioMattino || null } : {}),
        ...(input.oraFineMattino !== undefined ? { oraFineMattino: input.oraFineMattino || null } : {}),
        ...(input.oraInizioPomeriggio !== undefined ? { oraInizioPomeriggio: input.oraInizioPomeriggio || null } : {}),
        ...(input.oraFinePomeriggio !== undefined ? { oraFinePomeriggio: input.oraFinePomeriggio || null } : {}),
        durataMinuti,
        ...(clienteScritto
          ? { clienteId: await this.salvaClienteScritto(tx, clienteScritto) }
          : input.clienteId !== undefined ? { clienteId: input.clienteId ?? null } : {}),
        ...(input.cantiereId !== undefined ? { cantiereId: input.cantiereId ?? null } : {}),
        ...(clienteScritto?.id === null ? { cantiereId: null } : {}),
        ...(input.tipoAttivitaId !== undefined ? { tipoAttivitaId: input.tipoAttivitaId || null } : {}),
        ...(input.assenzaId !== undefined ? { assenzaId: input.assenzaId ?? null } : {}),
        // Il luogo esclude il tipo, il magazzino anche il cantiere
        luogo,
        ...(luogo ? { tipoAttivitaId: null } : {}),
        ...(luogo === 'MAGAZZINO' ? { cantiereId: null } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
      },
    }));
  }

  async delete(id: number, requesterId: number, isResponsabile: boolean): Promise<void> {
    const attivita = await this.prisma.attivita.findUnique({ where: { id } });

    if (!attivita) {
      throw new Error('Attività non trovata');
    }

    if (!isResponsabile && attivita.utenteId !== requesterId) {
      throw new Error('Non puoi eliminare attività di altri utenti');
    }

    await this.prisma.attivita.delete({ where: { id } });
  }
}
