import { FastifyInstance } from 'fastify';
import { DreamVeicoliService } from '../services/dreamVeicoli.service.js';

export async function dreamVeicoliRoutes(fastify: FastifyInstance) {
  const service = new DreamVeicoliService(fastify.prisma);

  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { includeInactive } = request.query as { includeInactive?: string };
    const veicoli = await service.getAll(includeInactive === 'true');
    return reply.send(veicoli);
  });

  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const veicolo = await service.getById(parseInt(request.params.id, 10));

    if (!veicolo) {
      return reply.status(404).send({ error: 'Veicolo non trovato' });
    }

    return reply.send(veicolo);
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
      const veicolo = await service.create(request.body.nome);
      return reply.status(201).send(veicolo);
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
      const veicolo = await service.update(id, request.body.nome);
      return reply.send(veicolo);
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
    const veicolo = await service.activate(parseInt(request.params.id, 10));
    return reply.send(veicolo);
  });
}
