import { FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import type { JwtPayload, LoginRequest } from '../types/index.js';
import { config } from '../config/index.js';

const checkPasswordParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

const loginBodySchema = {
  type: 'object',
  required: ['utenteId'],
  properties: {
    utenteId: { type: 'number' },
    password: { type: 'string' },
  },
} as const;

export async function authRoutes(fastify: FastifyInstance) {
  const authService = new AuthService(fastify.prisma);

  // Get all active users for login select
  fastify.get('/users', async (_request, reply) => {
    const users = await authService.getActiveUsers();
    return reply.send(users);
  });

  // Check if user has password
  fastify.get<{ Params: { id: string } }>(
    '/check-password/:id',
    {
      schema: {
        params: checkPasswordParamsSchema,
      },
    },
    async (request, reply) => {
      const userId = parseInt(request.params.id, 10);
      const result = await authService.checkUserHasPassword(userId);

      if (!result.exists) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'User not found',
        });
      }

      return reply.send({ hasPassword: result.hasPassword });
    }
  );

  // Login
  fastify.post<{ Body: LoginRequest }>(
    '/login',
    {
      schema: {
        body: loginBodySchema,
      },
    },
    async (request, reply) => {
      const { utenteId, password } = request.body;

      const result = await authService.validateLogin(utenteId, password);

      if (!result.success || !result.user) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: result.error ?? 'Login failed',
        });
      }

      const payload: JwtPayload = {
        id: result.user.id,
        ruolo: result.user.ruolo,
      };

      const token = fastify.jwt.sign(payload, {
        expiresIn: config.jwt.expiresIn,
      });

      // Also set cookie for backwards compatibility
      reply.setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: config.isProd,
        sameSite: config.isProd ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });

      // Return token in response body for localStorage storage
      return reply.send({
        token,
        user: {
          id: result.user.id,
          nome: result.user.nome,
          cognome: result.user.cognome,
          ruolo: result.user.ruolo,
        },
      });
    }
  );

  // Logout
  fastify.post('/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ success: true });
  });

  // Get current user (requires auth)
  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id } = request.user as JwtPayload;
      const user = await authService.getUserById(id);

      if (!user) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'User not found',
        });
      }

      return reply.send({
        user: {
          id: user.id,
          nome: user.nome,
          cognome: user.cognome,
          ruolo: user.ruolo,
        },
      });
    }
  );
}
