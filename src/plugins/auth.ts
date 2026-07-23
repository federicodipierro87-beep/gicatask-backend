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
      try {
        // Try Authorization header first, then cookie as fallback
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          const decoded = fastify.jwt.verify<JwtPayload>(token);
          request.user = decoded;
        } else if (request.cookies?.token) {
          // Fallback to cookie for backwards compatibility
          const decoded = fastify.jwt.verify<JwtPayload>(request.cookies.token);
          request.user = decoded;
        } else {
          throw new Error('No token provided');
        }
      } catch (err) {
        reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
      }
    }
  );

  fastify.decorate('requireRole', function (...roles: Ruolo[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      await fastify.authenticate(request, reply);

      const user = request.user as JwtPayload;
      if (!roles.includes(user.ruolo)) {
        reply.status(403).send({
          error: 'Forbidden',
          message: 'Insufficient permissions',
        });
      }
    };
  });
}

export default fp(authPlugin, {
  name: 'auth',
  dependencies: [],
});
