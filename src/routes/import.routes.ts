import { FastifyPluginAsync } from 'fastify';
import { ImportService } from '../services/import.service.js';
import { ImportStoricoService, Mappatura } from '../services/importStorico.service.js';
import multipart from '@fastify/multipart';

export const importRoutes: FastifyPluginAsync = async (fastify) => {
  // Register multipart support
  await fastify.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max
    },
  });

  const importService = new ImportService(fastify.prisma);
  const importStoricoService = new ImportStoricoService(fastify.prisma);

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

  // Vecchi lavori (prima di GicaTask), passo 1: lettura del file e abbinamenti proposti
  fastify.post('/vecchi-lavori/analisi', {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      if (request.user.ruolo !== 'RESPONSABILE') {
        return reply.status(403).send({ error: 'Accesso non autorizzato' });
      }

      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: 'Nessun file caricato' });
      }
      if (!file.filename.toLowerCase().endsWith('.xlsx')) {
        return reply.status(400).send({ error: 'Formato file non valido. Usa un file Excel (.xlsx)' });
      }

      try {
        return await importStoricoService.analizza(await file.toBuffer());
      } catch (error: any) {
        return reply.status(400).send({ error: `File non leggibile: ${error.message}` });
      }
    },
  });

  // Passo 2: il file torna insieme alla mappatura confermata (campo "mappatura", JSON)
  fastify.post('/vecchi-lavori/importa', {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      if (request.user.ruolo !== 'RESPONSABILE') {
        return reply.status(403).send({ error: 'Accesso non autorizzato' });
      }

      let buffer: Buffer | null = null;
      let mappatura: Mappatura | null = null;

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          buffer = await part.toBuffer();
        } else if (part.fieldname === 'mappatura') {
          try {
            mappatura = JSON.parse(String(part.value));
          } catch {
            return reply.status(400).send({ error: 'Mappatura non valida' });
          }
        }
      }

      if (!buffer) {
        return reply.status(400).send({ error: 'Nessun file caricato' });
      }
      if (!mappatura) {
        return reply.status(400).send({ error: 'Mappatura mancante' });
      }

      try {
        return await importStoricoService.importa(buffer, mappatura, request.user.id);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  });
};
