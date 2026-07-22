import { FastifyPluginAsync } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { clientiRoutes } from './clienti.routes.js';
import { cantieriRoutes } from './cantieri.routes.js';
import { tipiAttivitaRoutes } from './tipiAttivita.routes.js';
import { utentiRoutes } from './utenti.routes.js';
import { attivitaRoutes } from './attivita.routes.js';
import { backupRoutes } from './backup.routes.js';
import { runSeed } from '../services/seed.service.js';

export const registerRoutes: FastifyPluginAsync = async (fastify) => {
  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Temporary seed endpoint - REMOVE AFTER USE
  fastify.post('/api/seed', async (_request, reply) => {
    try {
      const result = await runSeed(fastify.prisma);
      return reply.send({ success: true, message: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // Auth routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });

  // CRUD routes
  await fastify.register(clientiRoutes, { prefix: '/api/clienti' });
  await fastify.register(cantieriRoutes, { prefix: '/api/cantieri' });
  await fastify.register(tipiAttivitaRoutes, { prefix: '/api/tipi-attivita' });
  await fastify.register(utentiRoutes, { prefix: '/api/utenti' });
  await fastify.register(attivitaRoutes, { prefix: '/api/attivita' });
  await fastify.register(backupRoutes, { prefix: '/api/backup' });
};
