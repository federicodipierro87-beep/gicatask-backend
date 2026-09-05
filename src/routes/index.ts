import { FastifyPluginAsync } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { clientiRoutes } from './clienti.routes.js';
import { cantieriRoutes } from './cantieri.routes.js';
import { tipiAttivitaRoutes } from './tipiAttivita.routes.js';
import { tipiAssenzaRoutes } from './tipiAssenza.routes.js';
import { utentiRoutes } from './utenti.routes.js';
import { attivitaRoutes } from './attivita.routes.js';
import { backupRoutes } from './backup.routes.js';
import { importRoutes } from './import.routes.js';
import { vociBollettinoRoutes } from './vociBollettino.routes.js';
import { bollettiniRoutes } from './bollettini.routes.js';
import { calendarioEventiRoutes } from './calendarioEventi.routes.js';
import { dreamVeicoliRoutes } from './dreamVeicoli.routes.js';
import { dreamNoleggiRoutes } from './dreamNoleggi.routes.js';

export const registerRoutes: FastifyPluginAsync = async (fastify) => {
  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Auth routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });

  // CRUD routes
  await fastify.register(clientiRoutes, { prefix: '/api/clienti' });
  await fastify.register(cantieriRoutes, { prefix: '/api/cantieri' });
  await fastify.register(tipiAttivitaRoutes, { prefix: '/api/tipi-attivita' });
  await fastify.register(tipiAssenzaRoutes, { prefix: '/api/tipi-assenza' });
  await fastify.register(utentiRoutes, { prefix: '/api/utenti' });
  await fastify.register(attivitaRoutes, { prefix: '/api/attivita' });
  await fastify.register(backupRoutes, { prefix: '/api/backup' });
  await fastify.register(importRoutes, { prefix: '/api/import' });
  await fastify.register(vociBollettinoRoutes, { prefix: '/api/voci-bollettino' });
  await fastify.register(bollettiniRoutes, { prefix: '/api/bollettini' });
  await fastify.register(calendarioEventiRoutes, { prefix: '/api/calendario-eventi' });
  await fastify.register(dreamVeicoliRoutes, { prefix: '/api/dream-veicoli' });
  await fastify.register(dreamNoleggiRoutes, { prefix: '/api/dream-noleggi' });
};
