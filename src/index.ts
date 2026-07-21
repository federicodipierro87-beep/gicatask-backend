import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { config } from './config/index.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import routes from './routes/index.js';

async function buildApp() {
  const loggerConfig = config.isDev
    ? {
        level: 'debug' as const,
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }
    : { level: 'info' as const };

  const fastify = Fastify({ logger: loggerConfig });

  // Register CORS
  await fastify.register(cors, {
    origin: config.cors.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Register cookie support
  await fastify.register(cookie);

  // Register Prisma
  await fastify.register(prismaPlugin);

  // Register auth plugin
  await fastify.register(authPlugin);

  // Register routes
  await fastify.register(routes);

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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
