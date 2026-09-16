import { FastifyInstance } from 'fastify';
import { BollettiniService, type RigaInput } from '../services/bollettini.service.js';
import {
  BollettinoPdfService,
  nomeFilePdf,
  sanitizeFilenamePart,
} from '../services/bollettinoPdf.service.js';
import { BollettinoEmailService } from '../services/bollettinoEmail.service.js';
import { assertAccessoBollettini } from '../utils/bollettiniAccess.js';
import { normalizzaEmail } from '../utils/email.js';
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
    // Niente `format: 'email'`: genererebbe un 400 *prima* dell'handler, cioe'
    // bollettino non salvato e due firme perse per un typo su un campo
    // facoltativo. Regola: nessun vincolo semantico qui sui campi facoltativi,
    // lo schema tutela il server (tipi e lunghezze), la semantica si valuta
    // dopo il salvataggio.
    email: { type: 'string', maxLength: 254 },
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
  email?: string;
}

export async function bollettiniRoutes(fastify: FastifyInstance) {
  const service = new BollettiniService(fastify.prisma);
  const pdfService = new BollettinoPdfService();
  const emailService = new BollettinoEmailService(fastify.prisma);

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

    const destinatario = (body.email ?? '').trim();
    const emailValida = normalizzaEmail(destinatario) !== null;

    // Il try si chiude sulla sola create: e' l'unica parte che puo' ancora
    // rispondere 400 senza che il bollettino esista.
    let bollettinoId: number;
    try {
      const creato = await service.create({
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
        emailDestinatario: destinatario ? destinatario.slice(0, 254) : null,
        // IN_CORSO scritto subito: se il processo muore durante l'invio il
        // responsabile vede un invio in sospeso, non un bollettino che sembra
        // non aver mai richiesto la mail.
        emailStato: destinatario ? (emailValida ? 'IN_CORSO' : 'NON_VALIDA') : null,
        createdById: user.id,
      });
      bollettinoId = creato.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }

    // Da qui il bollettino ESISTE: nessun percorso puo' piu' rispondere con un
    // errore, il client lo leggerebbe come "non salvato" e farebbe rifirmare.
    if (!destinatario) {
      return reply.status(201).send({ id: bollettinoId });
    }

    const esito = await emailService.invia(bollettinoId, destinatario); // non lancia mai
    request.log.info({ bollettinoId, stato: esito.stato }, 'invio mail bollettino');

    return reply.status(201).send({ id: bollettinoId, email: esito });
  });

  // Reinvio dall'archivio: il caso piu' frequente e' l'indirizzo digitato male
  fastify.post<{ Params: { id: string }; Body: { email?: string } }>('/:id/invia-mail', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        properties: { email: { type: 'string', maxLength: 254 } },
      },
    },
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const id = parseInt(request.params.id, 10);
    const bollettino = await service.getById(id);

    if (!bollettino) {
      return reply.status(404).send({ error: 'Bollettino non trovato' });
    }

    const destinatario = (request.body?.email ?? bollettino.emailDestinatario ?? '').trim();

    if (!destinatario) {
      return reply.status(400).send({ error: 'Nessun indirizzo e-mail indicato' });
    }

    // Sempre 200, anche quando l'invio fallisce: un 5xx passerebbe dall'error
    // handler globale, che in produzione maschera i 500 con "Internal Server
    // Error" cancellando proprio la diagnosi che serve qui.
    const esito = await emailService.invia(id, destinatario);
    request.log.info({ bollettinoId: id, stato: esito.stato }, 'reinvio mail bollettino');

    return reply.send(esito);
  });

  // Eliminazione (solo responsabile, e solo se abilitato)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

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

    const filename = nomeFilePdf(bollettino);

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer);
  });

  // PDF cumulativo di cantiere (solo responsabile, e solo se abilitato)
  fastify.get<{ Params: { cantiereId: string } }>('/cantiere/:cantiereId/pdf', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

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
