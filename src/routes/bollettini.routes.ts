import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BollettiniService, type RigaInput } from '../services/bollettini.service.js';
import { BollettinoPdfService, sanitizeFilenamePart } from '../services/bollettinoPdf.service.js';
import type { JwtPayload } from '../types/index.js';

// Due firme dense più il resto del corpo sfiorano il limite Fastify di 1 MB,
// che verrebbe segnalato con un FST_ERR_CTP_BODY_TOO_LARGE incomprensibile
const BODY_LIMIT = 2 * 1024 * 1024;

const righeSchema = {
  type: 'array',
  maxItems: 50,
  items: {
    type: 'object',
    required: ['quantita'],
    properties: {
      voceId: { type: ['number', 'null'] },
      descrizione: { type: 'string', maxLength: 200 },
      quantita: { type: 'number', minimum: 0, maximum: 100000 },
    },
  },
} as const;

const createBodySchema = {
  type: 'object',
  required: [
    'cantiereId',
    'dataRiferimento',
    'attivita',
    'firmaOperatoreNome',
    'firmaOperatoreImg',
    'firmaCommittenteNome',
    'firmaCommittenteImg',
  ],
  properties: {
    cantiereId: { type: 'number' },
    dataRiferimento: { type: 'string' },
    attivita: { type: 'string', minLength: 1, maxLength: 5000 },
    numeroOperai: { type: 'number', minimum: 0, maximum: 999 },
    ore: { type: 'number', minimum: 0, maximum: 24 },
    mezzi: righeSchema,
    materiali: righeSchema,
    trasporti: righeSchema,
    firmaOperatoreNome: { type: 'string', minLength: 1, maxLength: 200 },
    firmaOperatoreImg: { type: 'string', minLength: 1, maxLength: 400000 },
    firmaCommittenteNome: { type: 'string', minLength: 1, maxLength: 200 },
    firmaCommittenteImg: { type: 'string', minLength: 1, maxLength: 400000 },
  },
} as const;

interface CreateBody {
  cantiereId: number;
  dataRiferimento: string;
  attivita: string;
  numeroOperai?: number;
  ore?: number;
  mezzi?: RigaInput[];
  materiali?: RigaInput[];
  trasporti?: RigaInput[];
  firmaOperatoreNome: string;
  firmaOperatoreImg: string;
  firmaCommittenteNome: string;
  firmaCommittenteImg: string;
}

/**
 * Accesso alla sezione bollettini.
 *
 * Il flag è letto dal database a ogni richiesta e non dal token: il JWT dura
 * sette giorni, quindi metterlo dentro significherebbe non poter revocare
 * l'accesso prima della scadenza.
 */
async function assertAccessoBollettini(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const user = request.user as JwtPayload;

  if (user.ruolo === 'RESPONSABILE') return true;

  const dbUser = await fastify.prisma.utente.findUnique({
    where: { id: user.id },
    select: { abilitatoBollettini: true },
  });

  if (!dbUser?.abilitatoBollettini) {
    reply.status(403).send({ error: 'Non autorizzato ai bollettini' });
    return false;
  }

  return true;
}

export async function bollettiniRoutes(fastify: FastifyInstance) {
  const service = new BollettiniService(fastify.prisma);
  const pdfService = new BollettinoPdfService();

  // Elenco bollettini (senza firme)
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const user = request.user as JwtPayload;
    const { utenteId, clienteId, cantiereId, startDate, endDate } = request.query as {
      utenteId?: string;
      clienteId?: string;
      cantiereId?: string;
      startDate?: string;
      endDate?: string;
    };

    const bollettini = await service.getAll({
      // Il dipendente vede solo i propri, qualunque cosa chieda la query
      utenteId: user.ruolo === 'RESPONSABILE'
        ? (utenteId ? parseInt(utenteId, 10) : undefined)
        : user.id,
      clienteId: clienteId ? parseInt(clienteId, 10) : undefined,
      cantiereId: cantiereId ? parseInt(cantiereId, 10) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return reply.send(bollettini);
  });

  // Dettaglio con righe
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const user = request.user as JwtPayload;
    const bollettino = await service.getById(parseInt(request.params.id, 10));

    if (!bollettino) {
      return reply.status(404).send({ error: 'Bollettino non trovato' });
    }

    if (user.ruolo === 'DIPENDENTE' && bollettino.utenteId !== user.id) {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }

    return reply.send(bollettino);
  });

  // Creazione. Il bollettino è firmato, quindi non esiste una PUT
  fastify.post<{ Body: CreateBody }>('/', {
    preHandler: [fastify.authenticate],
    bodyLimit: BODY_LIMIT,
    schema: { body: createBodySchema },
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const user = request.user as JwtPayload;
    const body = request.body;

    try {
      const bollettino = await service.create({
        utenteId: user.id,
        cantiereId: body.cantiereId,
        dataRiferimento: new Date(body.dataRiferimento),
        attivita: body.attivita,
        numeroOperai: body.numeroOperai ?? 0,
        ore: body.ore ?? 0,
        mezzi: body.mezzi ?? [],
        materiali: body.materiali ?? [],
        trasporti: body.trasporti ?? [],
        firmaOperatoreNome: body.firmaOperatoreNome,
        firmaOperatoreImg: body.firmaOperatoreImg,
        firmaCommittenteNome: body.firmaCommittenteNome,
        firmaCommittenteImg: body.firmaCommittenteImg,
        createdById: user.id,
      });

      return reply.status(201).send({ id: bollettino.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  // Eliminazione (solo responsabile)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);

    const bollettino = await service.getById(id);
    if (!bollettino) {
      return reply.status(404).send({ error: 'Bollettino non trovato' });
    }

    await service.delete(id);
    return reply.send({ success: true });
  });

  // PDF del singolo bollettino
  fastify.get<{ Params: { id: string } }>('/:id/pdf', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const user = request.user as JwtPayload;
    const bollettino = await service.getFull(parseInt(request.params.id, 10));

    if (!bollettino) {
      return reply.status(404).send({ error: 'Bollettino non trovato' });
    }

    if (user.ruolo === 'DIPENDENTE' && bollettino.utenteId !== user.id) {
      return reply.status(403).send({ error: 'Non autorizzato' });
    }

    const pdfBuffer = await pdfService.generateSingolo(bollettino);

    const data = new Date(bollettino.dataRiferimento).toISOString().split('T')[0];
    const filename = `bollettino-${bollettino.id}-${sanitizeFilenamePart(bollettino.cantiereNome)}-${data}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer);
  });

  // PDF cumulativo di cantiere (solo responsabile)
  fastify.get<{ Params: { cantiereId: string } }>('/cantiere/:cantiereId/pdf', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const cantiereId = parseInt(request.params.cantiereId, 10);
    const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };

    const cantiere = await fastify.prisma.cantiere.findUnique({
      where: { id: cantiereId },
      select: { nome: true, cliente: { select: { nome: true } } },
    });

    if (!cantiere) {
      return reply.status(404).send({ error: 'Cantiere non trovato' });
    }

    const bollettini = await service.getByCantiere(
      cantiereId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    if (bollettini.length === 0) {
      return reply.status(404).send({ error: 'Nessun bollettino per questo cantiere' });
    }

    const pdfBuffer = await pdfService.generateCumulativo(
      cantiere.nome,
      cantiere.cliente.nome,
      bollettini
    );

    const filename = `bollettini-${sanitizeFilenamePart(cantiere.nome)}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer);
  });
}
