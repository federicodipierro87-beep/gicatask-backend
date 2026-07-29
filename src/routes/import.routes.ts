import { FastifyPluginAsync } from 'fastify';
import { ImportService } from '../services/import.service.js';
import multipart from '@fastify/multipart';

export const importRoutes: FastifyPluginAsync = async (fastify) => {
  // Register multipart support
  await fastify.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max
    },
  });

  const importService = new ImportService(fastify.prisma);

  // Download template
  fastify.get('/template', {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      // Only responsabile can import
      if (request.user.ruolo !== 'RESPONSABILE') {
        return reply.status(403).send({ error: 'Accesso non autorizzato' });
      }

      const buffer = await importService.generateTemplate();

      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="template-import.xlsx"')
        .send(buffer);
    },
  });

  // Import from Excel
  fastify.post('/excel', {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      // Only responsabile can import
      if (request.user.ruolo !== 'RESPONSABILE') {
        return reply.status(403).send({ error: 'Accesso non autorizzato' });
      }

      const file = await request.file();

      if (!file) {
        return reply.status(400).send({ error: 'Nessun file caricato' });
      }

      // Check file type
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ];

      if (!validTypes.includes(file.mimetype) && !file.filename.endsWith('.xlsx') && !file.filename.endsWith('.xls')) {
        return reply.status(400).send({ error: 'Formato file non valido. Usa un file Excel (.xlsx o .xls)' });
      }

      const buffer = await file.toBuffer();
      const result = await importService.importFromExcel(buffer);

      return result;
    },
  });
};
