import { FastifyInstance } from 'fastify';
import {
  CalendarioEventiService,
  type CalendarioEventoInput,
} from '../services/calendarioEventi.service.js';
import { CalendarioEventiExportService } from '../services/calendarioEventiExport.service.js';

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const eventoBodySchema = {
  type: 'object',
  required: ['clienteId', 'dataInizio', 'dataFine'],
  properties: {
    clienteId: { type: 'integer' },
    nome: { type: ['string', 'null'], maxLength: 200 },
    dataInizio: { type: 'string', pattern: ISO_DATE_PATTERN },
    dataFine: { type: 'string', pattern: ISO_DATE_PATTERN },
    dataConsegna: { type: ['string', 'null'], pattern: ISO_DATE_PATTERN },
    dataSmontaggio: { type: ['string', 'null'], pattern: ISO_DATE_PATTERN },
    importo: { type: ['number', 'null'] },
  },
} as const;

/** Un anno fuori scala genererebbe un foglio con centinaia di migliaia di celle. */
function parseAnno(valore?: string): number | null {
  if (!valore) return null;
  const anno = Number(valore);
  if (!Number.isInteger(anno) || anno < 1900 || anno > 2999) return null;
  return anno;
}

export async function calendarioEventiRoutes(fastify: FastifyInstance) {
  const service = new CalendarioEventiService(fastify.prisma);
  const exportService = new CalendarioEventiExportService();

  fastify.get('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const { anno } = request.query as { anno?: string };
    const eventi = await service.getAll(parseAnno(anno) ?? undefined);
    return reply.send(eventi);
  });

  fastify.get('/anni', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (_request, reply) => {
    return reply.send(await service.getAnniDisponibili());
  });

  fastify.get('/export/excel', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const { anno: annoQuery } = request.query as { anno?: string };
    const anno = parseAnno(annoQuery);

    if (anno === null) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    const eventi = await service.getAll(anno);
    const buffer = await exportService.generaExcel(anno, eventi);

    // L'anno e' gia' validato come intero: non puo' iniettare header
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="calendario-eventi-${anno}.xlsx"`)
      .send(buffer);
  });

  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const evento = await service.getById(parseInt(request.params.id, 10));

    if (!evento) {
      return reply.status(404).send({ error: 'Evento non trovato' });
    }

    return reply.send(evento);
  });

  fastify.post<{ Body: CalendarioEventoInput }>('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: { body: eventoBodySchema },
  }, async (request, reply) => {
    try {
      const evento = await service.create(request.body);
      return reply.status(201).send(evento);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.put<{ Params: { id: string }; Body: CalendarioEventoInput }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: { body: eventoBodySchema },
  }, async (request, reply) => {
    try {
      const evento = await service.update(parseInt(request.params.id, 10), request.body);
      return reply.send(evento);
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
