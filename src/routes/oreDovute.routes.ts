import { FastifyInstance } from 'fastify';
import { OreDovuteService, annoValido } from '../services/oreDovute.service.js';
import type { MeseOreDovute } from '../services/oreDovute.service.js';
import { OreDovuteExportService } from '../services/oreDovuteExport.service.js';

const FORMATI = {
  pdf: { contentType: 'application/pdf', estensione: 'pdf' },
  excel: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    estensione: 'xlsx',
  },
} as const;

export async function oreDovuteRoutes(fastify: FastifyInstance) {
  const service = new OreDovuteService(fastify.prisma);
  const exportService = new OreDovuteExportService();

  // Ore dovute dei dodici mesi di un anno (responsabile only)
  fastify.get<{ Params: { anno: string } }>('/:anno', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const anno = Number(request.params.anno);
    if (!annoValido(anno)) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    return reply.send(await service.getAnno(anno));
  });

  // Ore dovute di ciascun dipendente mese per mese, dai dati salvati
  // (responsabile only). Stesso calcolo del prospetto negli export
  fastify.get<{ Params: { anno: string } }>('/:anno/prospetto', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const anno = Number(request.params.anno);
    if (!annoValido(anno)) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    return reply.send(await service.getProspetto(anno));
  });

  // Export PDF/Excel dei dati salvati di un anno (responsabile only). L'anno e'
  // validato prima di finire nel nome del file, nell'header Content-Disposition
  fastify.get<{ Params: { anno: string; formato: string } }>('/:anno/export/:formato', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const anno = Number(request.params.anno);
    if (!annoValido(anno)) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    const formato = request.params.formato;
    if (formato !== 'pdf' && formato !== 'excel') {
      return reply.status(404).send({ error: 'Formato non supportato' });
    }

    const dati = await service.getAnno(anno);
    const prospetto = await service.getProspetto(anno, dati);
    const buffer = formato === 'pdf'
      ? await exportService.generaPdf(dati, prospetto, anno)
      : await exportService.generaExcel(dati, prospetto, anno);
    const cfg = FORMATI[formato];

    return reply
      .header('Content-Type', cfg.contentType)
      .header('Content-Disposition', `attachment; filename="ore-dovute-${anno}.${cfg.estensione}"`)
      .send(buffer);
  });

  // Salva le ore dovute di un anno (responsabile only)
  fastify.put<{
    Params: { anno: string };
    Body: { mesi: MeseOreDovute[]; minutiAnnui?: number | null };
  }>('/:anno', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        required: ['mesi'],
        properties: {
          mesi: {
            type: 'array',
            maxItems: 12,
            items: {
              type: 'object',
              required: ['mese', 'minuti'],
              properties: {
                mese: { type: 'integer' },
                minuti: { type: ['integer', 'null'] },
              },
            },
          },
          minutiAnnui: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const anno = Number(request.params.anno);
    if (!annoValido(anno)) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    try {
      return reply.send(await service.salvaAnno(anno, request.body.mesi, request.body.minutiAnnui));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });
}
