import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { config } from './config/index.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';
import { initScheduler } from './services/scheduler.service.js';
import { seedTipiAssenza } from './services/seed.service.js';

async function buildApp() {
  const fastify = Fastify({
    logger: true,
  });

  // Register CORS
  await fastify.register(cors, {
    origin: config.cors.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'Expires'],
  });

  // Register cookie support
  await fastify.register(cookie);

  // Register Prisma
  await fastify.register(prismaPlugin);

  // Register auth plugin
  await fastify.register(authPlugin);

  // Register routes
  await fastify.register(registerRoutes);

  // Add cache-control headers to prevent browser caching of API responses
  fastify.addHook('onSend', async (request, reply) => {
    // Only add no-cache headers to API routes, not static files
    if (request.url.startsWith('/api')) {
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
    }
  });

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    const statusCode = error.statusCode ?? 500;
    const message =
      statusCode === 500 && config.isProd
        ? 'Internal Server Error'
        : error.message;

    reply.status(statusCode).send({
      statusCode,
      error: error.name,
      message,
    });
  });

  return fastify;
}

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`🚀 Server running at http://${config.host}:${config.port}`);

    // Seed default absence types if the table is empty
    await seedTipiAssenza(app.prisma);

    // Initialize scheduler for automatic backups
    initScheduler(app.prisma);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
