import { FastifyInstance } from 'fastify';
import { AttivitaService } from '../services/attivita.service.js';
import { ExportService } from '../services/export.service.js';
import type { ReportFilters } from '../services/export.service.js';
import type { JwtPayload } from '../types/index.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ExportQuery {
  utenteId?: string;
  clienteId?: string;
  cantiereId?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Id preso dalla query string, `undefined` se non e' un intero.
 *
 * `parseInt('abc')` da' `NaN` e un `findUnique({ where: { id: NaN } })` fa
 * esplodere Prisma con un 500: un id malformato vale come filtro assente.
 */
function idNumerico(valore?: string): number | undefined {
  if (!valore) return undefined;
  const numero = Number(valore);
  return Number.isInteger(numero) ? numero : undefined;
}

/**
 * Build the period fragment of the export file name.
 *
 * The dates come from the query string and end up in the Content-Disposition
 * header, so anything that is not a plain YYYY-MM-DD is discarded: it would be
 * a header injection vector. Without a valid period the download date is used,
 * as before.
 */
export function periodoPerNomeFile(startDate?: string, endDate?: string): string {
  if (startDate && endDate && ISO_DATE.test(startDate) && ISO_DATE.test(endDate)) {
    return `${startDate}_${endDate}`;
  }

  return new Date().toISOString().split('T')[0] as string;
}

export async function attivitaRoutes(fastify: FastifyInstance) {
  const service = new AttivitaService(fastify.prisma);
  const exportService = new ExportService();

  // Get activities for current user (dipendente) or all (responsabile)
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { utenteId, clienteId, cantiereId, startDate, endDate } = request.query as {
      utenteId?: string;
      clienteId?: string;
      cantiereId?: string;
      startDate?: string;
      endDate?: string;
    };

    const filters = {
      // Dipendente can only see their own activities
      utenteId: user.ruolo === 'RESPONSABILE' && utenteId
        ? parseInt(utenteId)
        : user.ruolo === 'DIPENDENTE' ? user.id : undefined,
      clienteId: clienteId ? parseInt(clienteId) : undefined,
      cantiereId: cantiereId ? parseInt(cantiereId) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    };

    const attivita = await service.getAll(filters);
    return reply.send(attivita);
  });

  // Get my activities (for dipendente)
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { startDate, endDate } = request.query as {
      startDate?: string;
      endDate?: string;
    };

    const attivita = await service.getByUtente(
      user.id,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
    return reply.send(attivita);
  });

  // Get single activity
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const user = request.user as JwtPayload;

    const attivita = await service.getById(id);

    if (!attivita) {
      return reply.status(404).send({ error: 'Attività non trovata' });
    }

    // Dipendente can only see their own activities
    if (user.ruolo === 'DIPENDENTE' && attivita.utenteId !== user.id) {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }

    return reply.send(attivita);
  });

  // Create activity
  fastify.post<{
    Body: {
      utenteId?: number;
      dataRiferimento: string;
      oraInizioMattino?: string;
      oraFineMattino?: string;
      oraInizioPomeriggio?: string;
      oraFinePomeriggio?: string;
      clienteId?: number | null;
      cantiereId?: number | null;
      tipoAttivitaId?: number | null;
      assenzaId?: number | null;
      note?: string;
    };
  }>('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['dataRiferimento'],
        properties: {
          utenteId: { type: 'number' },
          dataRiferimento: { type: 'string' },
          oraInizioMattino: { type: 'string', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' },
          oraFineMattino: { type: 'string', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' },
          oraInizioPomeriggio: { type: 'string', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' },
          oraFinePomeriggio: { type: 'string', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' },
          clienteId: { type: ['number', 'null'] },
          cantiereId: { type: ['number', 'null'] },
          tipoAttivitaId: { type: ['number', 'null'] },
          assenzaId: { type: ['number', 'null'] },
          note: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const body = request.body;

    // Dipendente can only create for themselves, responsabile can assign to others
    const targetUtenteId = user.ruolo === 'RESPONSABILE' && body.utenteId
      ? body.utenteId
      : user.id;

    try {
      const attivita = await service.create({
        utenteId: targetUtenteId,
        dataRiferimento: new Date(body.dataRiferimento),
        oraInizioMattino: body.oraInizioMattino,
        oraFineMattino: body.oraFineMattino,
        oraInizioPomeriggio: body.oraInizioPomeriggio,
        oraFinePomeriggio: body.oraFinePomeriggio,
        clienteId: body.clienteId,
        cantiereId: body.cantiereId,
        tipoAttivitaId: body.tipoAttivitaId,
        assenzaId: body.assenzaId,
        note: body.note,
        createdById: user.id,
      });

      return reply.status(201).send(attivita);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  // Update activity
  fastify.put<{
    Params: { id: string };
    Body: {
      utenteId?: number;
      dataRiferimento?: string;
      oraInizioMattino?: string;
      oraFineMattino?: string;
      oraInizioPomeriggio?: string;
      oraFinePomeriggio?: string;
      clienteId?: number | null;
      cantiereId?: number | null;
      tipoAttivitaId?: number | null;
      assenzaId?: number | null;
      note?: string;
    };
  }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const user = request.user as JwtPayload;
    const body = request.body;

    try {
      const attivita = await service.update(
        id,
        {
          // Only a responsabile can move an activity to another employee
          utenteId: user.ruolo === 'RESPONSABILE' ? body.utenteId : undefined,
          dataRiferimento: body.dataRiferimento ? new Date(body.dataRiferimento) : undefined,
          oraInizioMattino: body.oraInizioMattino,
          oraFineMattino: body.oraFineMattino,
          oraInizioPomeriggio: body.oraInizioPomeriggio,
          oraFinePomeriggio: body.oraFinePomeriggio,
          clienteId: body.clienteId,
          cantiereId: body.cantiereId,
          tipoAttivitaId: body.tipoAttivitaId,
          assenzaId: body.assenzaId,
          note: body.note,
        },
        user.id,
        user.ruolo === 'RESPONSABILE'
      );

      return reply.send(attivita);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  // Delete activity
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const user = request.user as JwtPayload;

    try {
      await service.delete(id, user.id, user.ruolo === 'RESPONSABILE');
      return reply.send({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  // Le due route di export leggono gli stessi filtri e hanno bisogno degli
  // stessi nomi: l'unica differenza e' il formato del file prodotto
  const datiExport = async (query: ExportQuery) => {
    const utenteId = idNumerico(query.utenteId);
    const clienteId = idNumerico(query.clienteId);
    const cantiereId = idNumerico(query.cantiereId);

    const attivita = await service.getAll({
      utenteId,
      clienteId,
      cantiereId,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });

    const cliente = clienteId !== undefined
      ? await fastify.prisma.cliente.findUnique({ where: { id: clienteId } })
      : null;

    const utente = utenteId !== undefined
      ? await fastify.prisma.utente.findUnique({ where: { id: utenteId } })
      : null;

    const filters: ReportFilters = {
      startDate: query.startDate,
      endDate: query.endDate,
      clienteNome: cliente?.nome,
      utenteNome: utente ? `${utente.nome} ${utente.cognome}` : undefined,
      soloDipendente: utenteId !== undefined && clienteId === undefined && cantiereId === undefined,
    };

    return { attivita, filters };
  };

  // Export PDF (responsabile only)
  fastify.get('/export/pdf', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as JwtPayload;

    if (user.ruolo !== 'RESPONSABILE') {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }

    const query = request.query as ExportQuery;
    const { attivita, filters } = await datiExport(query);

    const pdfBuffer = await exportService.generatePDF(attivita, filters);

    const filename = `report-attivita-${periodoPerNomeFile(query.startDate, query.endDate)}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer);
  });

  // Export Excel (responsabile only)
  fastify.get('/export/excel', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as JwtPayload;

    if (user.ruolo !== 'RESPONSABILE') {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }

    const query = request.query as ExportQuery;
    const { attivita, filters } = await datiExport(query);

    const excelBuffer = await exportService.generateExcel(attivita, filters);

    const filename = `report-attivita-${periodoPerNomeFile(query.startDate, query.endDate)}.xlsx`;

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(excelBuffer);
  });

  // Statistics endpoint (responsabile only)
  fastify.get('/stats', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as JwtPayload;

    if (user.ruolo !== 'RESPONSABILE') {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }

    const { startDate, endDate } = request.query as {
      startDate?: string;
      endDate?: string;
    };

    const dateFilters = {
      ...(startDate && endDate
        ? {
            dataRiferimento: {
              gte: new Date(startDate),
              lte: new Date(endDate),
            },
          }
        : {}),
    };

    // Total activities and duration
    const totals = await fastify.prisma.attivita.aggregate({
      where: dateFilters,
      _count: true,
      _sum: { durataMinuti: true },
    });

    // By client
    const byCliente = await fastify.prisma.attivita.groupBy({
      by: ['clienteId'],
      where: dateFilters,
      _count: true,
      _sum: { durataMinuti: true },
    });

    const clientiIds = byCliente
      .map((c) => c.clienteId)
      .filter((id): id is number => id !== null);
    const clienti = await fastify.prisma.cliente.findMany({
      where: { id: { in: clientiIds } },
      select: { id: true, nome: true },
    });

    const clientiMap = new Map(clienti.map((c) => [c.id, c.nome]));

    // By employee
    const byUtente = await fastify.prisma.attivita.groupBy({
      by: ['utenteId'],
      where: dateFilters,
      _count: true,
      _sum: { durataMinuti: true },
    });

    const utentiIds = byUtente.map((u) => u.utenteId);
    const utenti = await fastify.prisma.utente.findMany({
      where: { id: { in: utentiIds } },
      select: { id: true, nome: true, cognome: true },
    });

    const utentiMap = new Map(
      utenti.map((u) => [u.id, `${u.nome} ${u.cognome}`])
    );

    return reply.send({
      totale: {
        attivita: totals._count,
        durataMinuti: totals._sum.durataMinuti || 0,
      },
      perCliente: byCliente
        .map((c) => ({
          clienteId: c.clienteId,
          clienteNome: c.clienteId === null ? 'Assenze' : (clientiMap.get(c.clienteId) || 'Unknown'),
          attivita: c._count,
          durataMinuti: c._sum.durataMinuti || 0,
        }))
        .sort((a, b) => b.durataMinuti - a.durataMinuti),
      perUtente: byUtente
        .map((u) => ({
          utenteId: u.utenteId,
          utenteNome: utentiMap.get(u.utenteId) || 'Unknown',
          attivita: u._count,
          durataMinuti: u._sum.durataMinuti || 0,
        }))
        .sort((a, b) => b.durataMinuti - a.durataMinuti),
    });
  });
}
