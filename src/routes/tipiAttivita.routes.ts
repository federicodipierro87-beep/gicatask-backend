import { FastifyInstance } from 'fastify';
import { TipiAttivitaService } from '../services/tipiAttivita.service.js';

export async function tipiAttivitaRoutes(fastify: FastifyInstance) {
  const service = new TipiAttivitaService(fastify.prisma);

  // Get tipi attività by cantiere
  fastify.get<{ Params: { cantiereId: string } }>('/cantiere/:cantiereId', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const cantiereId = parseInt(request.params.cantiereId, 10);
    const { includeInactive } = request.query as { includeInactive?: string };
    const tipi = await service.getByCantiere(cantiereId, includeInactive === 'true');
    return reply.send(tipi);
  });

  // Get tipo attività by ID
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tipo = await service.getById(id);

    if (!tipo) {
      return reply.status(404).send({ error: 'Tipo attività non trovato' });
    }

    return reply.send(tipo);
  });

  // Create tipo attività (responsabile only)
  fastify.post<{ Body: { cantiereId: number; nome: string } }>('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        required: ['cantiereId', 'nome'],
        properties: {
          cantiereId: { type: 'number' },
          nome: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const tipo = await service.create(request.body.cantiereId, request.body.nome);
    return reply.status(201).send(tipo);
  });

  // Update tipo attività (responsabile only)
  fastify.put<{ Params: { id: string }; Body: { nome: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        required: ['nome'],
        properties: {
          nome: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tipo = await service.update(id, request.body.nome);
    return reply.send(tipo);
  });

  // Deactivate tipo attività (responsabile only)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await service.deactivate(id);
    return reply.send({ success: true });
  });

  // Reactivate tipo attività (responsabile only)
  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tipo = await service.activate(id);
    return reply.send(tipo);
  });
}
