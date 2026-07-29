import { FastifyInstance } from 'fastify';
import { UtentiService } from '../services/utenti.service.js';
import { Ruolo } from '@prisma/client';

export async function utentiRoutes(fastify: FastifyInstance) {
  const service = new UtentiService(fastify.prisma);

  // Get all users
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { includeInactive } = request.query as { includeInactive?: string };
    const utenti = await service.getAll(includeInactive === 'true');
    return reply.send(utenti);
  });

  // Get user by ID
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const utente = await service.getById(id);

    if (!utente) {
      return reply.status(404).send({ error: 'Utente non trovato' });
    }

    return reply.send(utente);
  });

  // Create user (responsabile only)
  fastify.post<{ Body: { nome: string; cognome: string; ruolo: Ruolo; password?: string } }>('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'cognome', 'ruolo'],
        properties: {
          nome: { type: 'string', minLength: 1 },
          cognome: { type: 'string', minLength: 1 },
          ruolo: { type: 'string', enum: ['DIPENDENTE', 'RESPONSABILE'] },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const utente = await service.create(request.body);
    return reply.status(201).send(utente);
  });

  // Update user (responsabile only)
  fastify.put<{ Params: { id: string }; Body: { nome?: string; cognome?: string; ruolo?: Ruolo } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        properties: {
          nome: { type: 'string', minLength: 1 },
          cognome: { type: 'string', minLength: 1 },
          ruolo: { type: 'string', enum: ['DIPENDENTE', 'RESPONSABILE'] },
        },
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const utente = await service.update(id, request.body);
    return reply.send(utente);
  });

  // Set/remove password (responsabile only)
  fastify.post<{ Params: { id: string }; Body: { password: string | null } }>('/:id/password', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: ['string', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await service.setPassword(id, request.body.password);
    return reply.send({ success: true });
  });

  // Deactivate user (responsabile only)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await service.deactivate(id);
    return reply.send({ success: true });
  });

  // Reactivate user (responsabile only)
  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const utente = await service.activate(id);
    return reply.send(utente);
  });
}
