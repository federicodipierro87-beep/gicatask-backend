import { FastifyInstance } from 'fastify';
import { AttivitaService } from '../services/attivita.service.js';
import type { JwtPayload } from '../types/index.js';

export async function attivitaRoutes(fastify: FastifyInstance) {
  const service = new AttivitaService(fastify.prisma);

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
}
