import { FastifyInstance } from 'fastify';
import {
  DreamNoleggiService,
  type DreamNoleggioInput,
} from '../services/dreamNoleggi.service.js';
import { DreamNoleggiPdfService } from '../services/dreamNoleggiPdf.service.js';
import { periodoPerNomeFile } from './attivita.routes.js';

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const noleggioBodySchema = {
  type: 'object',
  required: ['veicoloId', 'data', 'importo', 'quota'],
  properties: {
    veicoloId: { type: 'integer' },
    clienteId: { type: ['integer', 'null'] },
    data: { type: 'string', pattern: ISO_DATE_PATTERN },
    osservazioni: { type: ['string', 'null'] },
    importo: { type: 'number' },
    quota: { type: 'string', enum: ['SETTANTA_TRENTA', 'CENTO'] },
  },
} as const;

export async function dreamNoleggiRoutes(fastify: FastifyInstance) {
  const service = new DreamNoleggiService(fastify.prisma);
  const pdfService = new DreamNoleggiPdfService();

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

    const buffer = await pdfService.generaPdf(noleggi, { startDate, endDate });
    const filename = `dream-${periodoPerNomeFile(startDate, endDate)}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  fastify.post<{ Body: DreamNoleggioInput }>('/', {
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

  fastify.put<{ Params: { id: string }; Body: DreamNoleggioInput }>('/:id', {
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
