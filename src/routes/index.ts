import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes.js';

export async function registerRoutes(fastify: FastifyInstance) {
  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Auth routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });

  // Future routes will be registered here:
  // await fastify.register(clientiRoutes, { prefix: '/api/clienti' });
  // await fastify.register(cantieriRoutes, { prefix: '/api/cantieri' });
  // await fastify.register(attivitaRoutes, { prefix: '/api/attivita' });
  // await fastify.register(utentiRoutes, { prefix: '/api/utenti' });
  // await fastify.register(backupRoutes, { prefix: '/api/backup' });
}
