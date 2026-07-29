import { FastifyInstance } from 'fastify';
import { BackupService } from '../services/backup.service.js';
import type { JwtPayload } from '../types/index.js';

export async function backupRoutes(fastify: FastifyInstance) {
  const service = new BackupService(fastify.prisma);

  // All backup routes require RESPONSABILE role
  const requireResponsabile = async (request: any, reply: any) => {
    await fastify.authenticate(request, reply);
    const user = request.user as JwtPayload;
    if (user.ruolo !== 'RESPONSABILE') {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }
  };

  // Get backup status
  fastify.get('/status', {
    preHandler: [requireResponsabile],
  }, async (request, reply) => {
    try {
      const status = await service.getStatus();
      return reply.send(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(500).send({ error: message });
    }
  });

  // Test R2 connection
  fastify.get('/test', {
    preHandler: [requireResponsabile],
  }, async (request, reply) => {
    try {
      const result = await service.testConnection();
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(500).send({ error: message });
    }
  });

  // List all backups
  fastify.get('/', {
    preHandler: [requireResponsabile],
  }, async (request, reply) => {
    try {
      const backups = await service.listBackups();
      return reply.send(backups);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(500).send({ error: message });
    }
  });

  // Create manual backup
  fastify.post('/', {
    preHandler: [requireResponsabile],
  }, async (request, reply) => {
    try {
      const result = await service.createBackup('MANUALE');
      return reply.status(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(500).send({ error: message });
    }
  });

  // Restore from backup
  fastify.post<{ Params: { id: string } }>('/:id/restore', {
    preHandler: [requireResponsabile],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);

    try {
      const result = await service.restoreBackup(id);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(500).send({ error: message });
    }
  });

  // Delete backup
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [requireResponsabile],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);

    try {
      await service.deleteBackup(id);
      return reply.send({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(500).send({ error: message });
    }
  });
}
