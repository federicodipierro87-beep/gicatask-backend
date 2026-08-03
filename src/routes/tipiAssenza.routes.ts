import { FastifyInstance } from 'fastify';
import { TipiAssenzaService } from '../services/tipiAssenza.service.js';

export async function tipiAssenzaRoutes(fastify: FastifyInstance) {
  const service = new TipiAssenzaService(fastify.prisma);

  // Get all tipi assenza
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { includeInactive } = request.query as { includeInactive?: string };
    const tipi = await service.getAll(includeInactive === 'true');
    return reply.send(tipi);
  });

  // Get tipo assenza by ID
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tipo = await service.getById(id);

    if (!tipo) {
      return reply.status(404).send({ error: 'Tipo assenza non trovato' });
    }

    return reply.send(tipo);
  });

  // Create tipo assenza (responsabile only)
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
    const tipo = await service.create(request.body.nome);
    return reply.status(201).send(tipo);
  });

  // Update tipo assenza (responsabile only)
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

  // Deactivate tipo assenza (responsabile only)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await service.deactivate(id);
    return reply.send({ success: true });
  });

  // Reactivate tipo assenza (responsabile only)
  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tipo = await service.activate(id);
    return reply.send(tipo);
  });
}
