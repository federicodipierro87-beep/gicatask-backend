import { FastifyInstance } from 'fastify';
import { TipoVoce } from '@prisma/client';
import { VociBollettinoService } from '../services/vociBollettino.service.js';
import { assertAccessoBollettini } from '../utils/bollettiniAccess.js';

const TIPO_SLUGS = ['mezzi', 'materiali', 'trasporti'] as const;
type TipoSlug = (typeof TIPO_SLUGS)[number];

const SLUG_TO_TIPO: Record<TipoSlug, TipoVoce> = {
  mezzi: 'MEZZO',
  materiali: 'MATERIALE',
  trasporti: 'TRASPORTO',
};

const tipoParamsSchema = {
  type: 'object',
  required: ['tipo'],
  properties: {
    tipo: { type: 'string', enum: [...TIPO_SLUGS] },
  },
} as const;

const nomeBodySchema = {
  type: 'object',
  required: ['nome'],
  properties: {
    nome: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

// Un nome gia' presente per lo stesso tipo viola @@unique([tipo, nome]).
// Senza questa traduzione Prisma propaga un 500 al posto di un errore d'uso.
function isDuplicato(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function vociBollettinoRoutes(fastify: FastifyInstance) {
  const service = new VociBollettinoService(fastify.prisma);

  // Elenco voci di un tipo
  fastify.get<{ Params: { tipo: TipoSlug } }>('/:tipo', {
    preHandler: [fastify.authenticate],
    schema: { params: tipoParamsSchema },
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const { includeInactive } = request.query as { includeInactive?: string };
    const voci = await service.getAll(
      SLUG_TO_TIPO[request.params.tipo],
      includeInactive === 'true'
    );
    return reply.send(voci);
  });

  // Crea voce (responsabile)
  fastify.post<{ Params: { tipo: TipoSlug }; Body: { nome: string } }>('/:tipo', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: { params: tipoParamsSchema, body: nomeBodySchema },
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    try {
      const voce = await service.create(
        SLUG_TO_TIPO[request.params.tipo],
        request.body.nome.trim()
      );
      return reply.status(201).send(voce);
    } catch (error) {
      if (isDuplicato(error)) {
        return reply.status(400).send({ error: 'Voce già presente' });
      }
      throw error;
    }
  });

  // Rinomina voce (responsabile)
  fastify.put<{ Params: { id: string }; Body: { nome: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: { body: nomeBodySchema },
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const id = parseInt(request.params.id, 10);

    try {
      const voce = await service.update(id, request.body.nome.trim());
      return reply.send(voce);
    } catch (error) {
      if (isDuplicato(error)) {
        return reply.status(400).send({ error: 'Voce già presente' });
      }
      throw error;
    }
  });

  // Disattiva voce (responsabile)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const id = parseInt(request.params.id, 10);
    await service.deactivate(id);
    return reply.send({ success: true });
  });

  // Riattiva voce (responsabile)
  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const id = parseInt(request.params.id, 10);
    const voce = await service.activate(id);
    return reply.send(voce);
  });
}
