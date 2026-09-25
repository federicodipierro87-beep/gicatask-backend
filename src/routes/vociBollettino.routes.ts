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
    // Dal form del bollettino: una voce omonima si riusa invece di dare errore
    riusa: { type: 'boolean' },
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

  // Crea voce: chi puo' compilare un bollettino puo' aggiungere una voce dal form.
  // Rinominare e disattivare restano al responsabile.
  fastify.post<{ Params: { tipo: TipoSlug }; Body: { nome: string; riusa?: boolean } }>('/:tipo', {
    preHandler: [fastify.authenticate],
    schema: { params: tipoParamsSchema, body: nomeBodySchema },
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    // minLength: 1 e' verificato prima del trim: senza questo controllo
    // un nome fatto di soli spazi creerebbe una voce vuota in anagrafica.
    const nome = request.body.nome.trim();
    if (!nome) {
      return reply.status(400).send({ error: 'Il nome non può essere vuoto' });
    }

    try {
      const tipo = SLUG_TO_TIPO[request.params.tipo];
      const voce = request.body.riusa
        ? await service.trovaOCrea(tipo, nome)
        : await service.create(tipo, nome);
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
