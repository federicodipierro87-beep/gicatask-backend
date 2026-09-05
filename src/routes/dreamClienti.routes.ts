import { FastifyInstance } from 'fastify';
import { DreamClientiService } from '../services/dreamClienti.service.js';

export async function dreamClientiRoutes(fastify: FastifyInstance) {
  const service = new DreamClientiService(fastify.prisma);

  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { includeInactive } = request.query as { includeInactive?: string };
    const clienti = await service.getAll(includeInactive === 'true');
    return reply.send(clienti);
  });

  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const cliente = await service.getById(parseInt(request.params.id, 10));

    if (!cliente) {
      return reply.status(404).send({ error: 'Cliente non trovato' });
    }

    return reply.send(cliente);
  });

  fastify.post<{ Body: { nome: string } }>('/', {
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
      const cliente = await service.create(request.body.nome);
      return reply.status(201).send(cliente);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

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
      const cliente = await service.update(id, request.body.nome);
      return reply.send(cliente);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    try {
      await service.deactivate(parseInt(request.params.id, 10));
      return reply.send({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const cliente = await service.activate(parseInt(request.params.id, 10));
    return reply.send(cliente);
  });
}
