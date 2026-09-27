import { FastifyInstance } from 'fastify';
import { OreDovuteService, annoValido } from '../services/oreDovute.service.js';
import type { MeseOreDovute } from '../services/oreDovute.service.js';

export async function oreDovuteRoutes(fastify: FastifyInstance) {
  const service = new OreDovuteService(fastify.prisma);

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
