import { FastifyInstance } from 'fastify';
import {
  GicaNoleggiService,
  type GicaNoleggioInput,
} from '../services/gicaNoleggi.service.js';
import { GicaNoleggiExportService } from '../services/gicaNoleggiExport.service.js';
import { periodoPerNomeFile } from './attivita.routes.js';

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const noleggioBodySchema = {
  type: 'object',
  required: ['veicoloId', 'data', 'importo'],
  properties: {
    veicoloId: { type: 'integer' },
    clienteId: { type: ['integer', 'null'] },
    data: { type: 'string', pattern: ISO_DATE_PATTERN },
    osservazioni: { type: ['string', 'null'] },
    importo: { type: 'number' },
  },
} as const;

export async function gicaNoleggiRoutes(fastify: FastifyInstance) {
  const service = new GicaNoleggiService(fastify.prisma);
  const exportService = new GicaNoleggiExportService();

  fastify.get('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const { startDate, endDate, veicoloId } = request.query as {
      startDate?: string;
      endDate?: string;
      veicoloId?: string;
    };

    try {
      const noleggi = await service.getAll({
        startDate,
        endDate,
        veicoloId: veicoloId ? parseInt(veicoloId, 10) : undefined,
      });
      return reply.send(noleggi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.get('/export/pdf', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const { startDate, endDate } = request.query as {
      startDate?: string;
      endDate?: string;
    };

    let noleggi;
    try {
      noleggi = await service.getAll({ startDate, endDate });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }

    const buffer = await exportService.generaPdf(noleggi, { startDate, endDate });
    const filename = `gica-${periodoPerNomeFile(startDate, endDate)}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  fastify.get('/export/excel', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const { startDate, endDate } = request.query as {
      startDate?: string;
      endDate?: string;
    };

    let noleggi;
    try {
      noleggi = await service.getAll({ startDate, endDate });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }

    const buffer = await exportService.generaExcel(noleggi, { startDate, endDate });
    const filename = `gica-${periodoPerNomeFile(startDate, endDate)}.xlsx`;

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  fastify.post<{ Body: GicaNoleggioInput }>('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: { body: noleggioBodySchema },
  }, async (request, reply) => {
    try {
      const noleggio = await service.create(request.body);
      return reply.status(201).send(noleggio);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.put<{ Params: { id: string }; Body: GicaNoleggioInput }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: { body: noleggioBodySchema },
  }, async (request, reply) => {
    try {
      const noleggio = await service.update(parseInt(request.params.id, 10), request.body);
      return reply.send(noleggio);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    await service.delete(parseInt(request.params.id, 10));
    return reply.send({ success: true });
  });
}
