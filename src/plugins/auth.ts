import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { config } from '../config/index.js';
import type { JwtPayload } from '../types/index.js';
import { Ruolo } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    requireRole: (
      ...roles: Ruolo[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, {
    secret: config.jwt.secret,
  });

  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      // `return reply`: in un hook async, una risposta inviata senza
      // restituirla NON ferma la richiesta, e l'handler girerebbe lo stesso
      const nonAutorizzato = () =>
        reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });

      let decoded: JwtPayload;
      try {
        // Try Authorization header first, then cookie as fallback
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          decoded = fastify.jwt.verify<JwtPayload>(authHeader.substring(7));
        } else if (request.cookies?.token) {
          // Fallback to cookie for backwards compatibility
          decoded = fastify.jwt.verify<JwtPayload>(request.cookies.token);
        } else {
          throw new Error('No token provided');
        }
      } catch (err) {
        return nonAutorizzato();
      }

      if (!Number.isInteger(decoded.id)) return nonAutorizzato();

      // Il token dura 7 giorni e porta con se' il ruolo del momento del login:
      // stato e ruolo si rileggono a ogni richiesta, cosi' un utente
      // disattivato perde subito l'accesso e uno declassato i permessi
      const utente = await fastify.prisma.utente.findUnique({
        where: { id: decoded.id },
        select: { ruolo: true, attivo: true },
      });
      if (!utente || !utente.attivo) return nonAutorizzato();

      request.user = { id: decoded.id, ruolo: utente.ruolo };
    }
  );

  fastify.decorate('requireRole', function (...roles: Ruolo[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      await fastify.authenticate(request, reply);
      // Gia' risposto 401: l'utente non c'e'
      if (reply.sent) return reply;

      const user = request.user as JwtPayload;
      if (!roles.includes(user.ruolo)) {
        // Senza `return reply` l'handler verrebbe eseguito comunque: il
        // dipendente riceverebbe 403 ma l'operazione avverrebbe lo stesso
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Insufficient permissions',
        });
      }
    };
  });
}

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['prisma'],
});
