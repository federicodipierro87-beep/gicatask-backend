import { FastifyInstance } from 'fastify';
import { AttivitaService } from '../services/attivita.service.js';
import { ExportService } from '../services/export.service.js';
import type { JwtPayload } from '../types/index.js';

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
      oraInizio: string;
      oraFine: string;
      clienteId: number;
      cantiereId: number;
      tipoAttivitaId: number;
      note?: string;
    };
  }>('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['dataRiferimento', 'oraInizio', 'oraFine', 'clienteId', 'cantiereId', 'tipoAttivitaId'],
        properties: {
          utenteId: { type: 'number' },
          dataRiferimento: { type: 'string' },
          oraInizio: { type: 'string', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' },
          oraFine: { type: 'string', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' },
          clienteId: { type: 'number' },
          cantiereId: { type: 'number' },
          tipoAttivitaId: { type: 'number' },
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
        oraInizio: body.oraInizio,
        oraFine: body.oraFine,
        clienteId: body.clienteId,
        cantiereId: body.cantiereId,
        tipoAttivitaId: body.tipoAttivitaId,
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
      dataRiferimento?: string;
      oraInizio?: string;
      oraFine?: string;
      clienteId?: number;
      cantiereId?: number;
      tipoAttivitaId?: number;
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
          dataRiferimento: body.dataRiferimento ? new Date(body.dataRiferimento) : undefined,
          oraInizio: body.oraInizio,
          oraFine: body.oraFine,
          clienteId: body.clienteId,
          cantiereId: body.cantiereId,
          tipoAttivitaId: body.tipoAttivitaId,
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

  // Export PDF (responsabile only)
  fastify.get('/export/pdf', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as JwtPayload;

    if (user.ruolo !== 'RESPONSABILE') {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }

    const { utenteId, clienteId, cantiereId, startDate, endDate } = request.query as {
      utenteId?: string;
      clienteId?: string;
      cantiereId?: string;
      startDate?: string;
      endDate?: string;
    };

    const filters = {
      utenteId: utenteId ? parseInt(utenteId) : undefined,
      clienteId: clienteId ? parseInt(clienteId) : undefined,
      cantiereId: cantiereId ? parseInt(cantiereId) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    };

    const attivita = await service.getAll(filters);

    // Get names for filters
    let clienteNome: string | undefined;
    let utenteNome: string | undefined;

    if (clienteId) {
      const cliente = await fastify.prisma.cliente.findUnique({
        where: { id: parseInt(clienteId) },
      });
      clienteNome = cliente?.nome;
    }

    if (utenteId) {
      const utente = await fastify.prisma.utente.findUnique({
        where: { id: parseInt(utenteId) },
      });
      utenteNome = utente ? `${utente.nome} ${utente.cognome}` : undefined;
    }

    const pdfBuffer = await exportService.generatePDF(attivita, {
      startDate,
      endDate,
      clienteNome,
      utenteNome,
    });

    const filename = `report-attivita-${new Date().toISOString().split('T')[0]}.pdf`;

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

    const { utenteId, clienteId, cantiereId, startDate, endDate } = request.query as {
      utenteId?: string;
      clienteId?: string;
      cantiereId?: string;
      startDate?: string;
      endDate?: string;
    };

    const filters = {
      utenteId: utenteId ? parseInt(utenteId) : undefined,
      clienteId: clienteId ? parseInt(clienteId) : undefined,
      cantiereId: cantiereId ? parseInt(cantiereId) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    };

    const attivita = await service.getAll(filters);

    // Get names for filters
    let clienteNome: string | undefined;
    let utenteNome: string | undefined;

    if (clienteId) {
      const cliente = await fastify.prisma.cliente.findUnique({
        where: { id: parseInt(clienteId) },
      });
      clienteNome = cliente?.nome;
    }

    if (utenteId) {
      const utente = await fastify.prisma.utente.findUnique({
        where: { id: parseInt(utenteId) },
      });
      utenteNome = utente ? `${utente.nome} ${utente.cognome}` : undefined;
    }

    const excelBuffer = await exportService.generateExcel(attivita, {
      startDate,
      endDate,
      clienteNome,
      utenteNome,
    });

    const filename = `report-attivita-${new Date().toISOString().split('T')[0]}.xlsx`;

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

    const clientiIds = byCliente.map((c) => c.clienteId);
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
          clienteNome: clientiMap.get(c.clienteId) || 'Unknown',
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
