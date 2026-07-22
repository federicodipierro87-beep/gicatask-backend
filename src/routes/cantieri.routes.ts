import { FastifyInstance } from 'fastify';
import { CantieriService } from '../services/cantieri.service.js';

export async function cantieriRoutes(fastify: FastifyInstance) {
  const service = new CantieriService(fastify.prisma);

  // Get cantieri by cliente
  fastify.get<{ Params: { clienteId: string } }>('/cliente/:clienteId', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const clienteId = parseInt(request.params.clienteId, 10);
    const { includeInactive } = request.query as { includeInactive?: string };
    const cantieri = await service.getByCliente(clienteId, includeInactive === 'true');
    return reply.send(cantieri);
  });

  // Get cantiere by ID
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cantiere = await service.getById(id);

    if (!cantiere) {
      return reply.status(404).send({ error: 'Cantiere non trovato' });
    }

    return reply.send(cantiere);
  });

  // Create cantiere (responsabile only)
  fastify.post<{ Body: { clienteId: number; nome: string } }>('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        required: ['clienteId', 'nome'],
        properties: {
          clienteId: { type: 'number' },
          nome: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const cantiere = await service.create(request.body.clienteId, request.body.nome);
      return reply.status(201).send(cantiere);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  // Update cantiere (responsabile only)
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
    try {
      const id = parseInt(request.params.id, 10);
      const cantiere = await service.update(id, request.body.nome);
      return reply.send(cantiere);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  // Deactivate cantiere (responsabile only)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      await service.deactivate(id);
      return reply.send({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  // Reactivate cantiere (responsabile only)
  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cantiere = await service.activate(id);
    return reply.send(cantiere);
  });
}
