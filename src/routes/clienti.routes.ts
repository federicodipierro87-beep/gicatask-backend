import { FastifyInstance } from 'fastify';
import { ClientiService } from '../services/clienti.service.js';

export async function clientiRoutes(fastify: FastifyInstance) {
  const service = new ClientiService(fastify.prisma);

  // Get all clients
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { includeInactive } = request.query as { includeInactive?: string };
    const clienti = await service.getAll(includeInactive === 'true');
    return reply.send(clienti);
  });

  // Get client by ID
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cliente = await service.getById(id);

    if (!cliente) {
      return reply.status(404).send({ error: 'Cliente non trovato' });
    }

    return reply.send(cliente);
  });

  // Create client (responsabile only)
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
    const cliente = await service.create(request.body.nome);
    return reply.status(201).send(cliente);
  });

  // Update client (responsabile only)
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
    const cliente = await service.update(id, request.body.nome);
    return reply.send(cliente);
  });

  // Deactivate client (responsabile only)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await service.deactivate(id);
    return reply.send({ success: true });
  });

  // Reactivate client (responsabile only)
  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cliente = await service.activate(id);
    return reply.send(cliente);
  });
}
