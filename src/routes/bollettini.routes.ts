import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  BollettiniService,
  type CollaboratoreInput,
  type FasceOrarie,
  type SquadraInput,
  type RigaInput,
} from '../services/bollettini.service.js';
import { AllegatiBollettinoService } from '../services/allegatiBollettino.service.js';
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
      veicoloId: { type: ['number', 'null'] },
      descrizione: { type: 'string', maxLength: 200 },
      quantita: { type: 'number', minimum: 0, maximum: 100000 },
    },
  },
} as const;

// Niente `pattern` sugli orari: il formato lo verifica il service, dentro il
// try che risponde 400 con un messaggio leggibile
const fasceProperties = {
  oraInizioMattino: { type: ['string', 'null'], maxLength: 5 },
  oraFineMattino: { type: ['string', 'null'], maxLength: 5 },
  oraInizioPomeriggio: { type: ['string', 'null'], maxLength: 5 },
  oraFinePomeriggio: { type: ['string', 'null'], maxLength: 5 },
} as const;

const createBodySchema = {
  type: 'object',
  // Ne' `clienteId` ne' `cantiereId` sono `required`: la regola e' "almeno uno
  // dei due", e un 400 dello schema scatterebbe *prima* dell'handler, cioe'
  // bollettino non salvato e due firme perse. La coppia la verifica il service,
  // dentro il try che gia' risponde 400.
  required: [
    'dataRiferimento',
    'attivita',
    'firmaOperatoreNome',
    'firmaOperatoreImg',
    'firmaCommittenteNome',
    'firmaCommittenteImg',
  ],
  properties: {
    clienteId: { type: 'number' },
    cantiereId: { type: 'number' },
    cantieriIds: { type: 'array', maxItems: 50, items: { type: 'number' } },
    collaboratoriIds: { type: 'array', maxItems: 200, items: { type: 'number' } },
    fasce: { type: 'object', properties: fasceProperties },
    squadre: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['numeroOperai'],
        properties: {
          numeroOperai: { type: 'integer', minimum: 1, maximum: 999 },
          ...fasceProperties,
        },
      },
    },
    materialiTesto: { type: 'string', maxLength: 5000 },
    collaboratori: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['utenteId', 'ore'],
        properties: {
          utenteId: { type: 'number' },
          ore: { type: 'number', minimum: 0, maximum: 24 },
        },
      },
    },
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
    // Non in `required` e senza vincoli semantici, stessa regola: gli id non
    // ammissibili li scarta il service, che a quel punto ha gia' salvato.
    allegatiIds: { type: 'array', maxItems: 10, items: { type: 'number' } },
  },
} as const;

interface CreateBody {
  clienteId?: number;
  cantiereId?: number;
  cantieriIds?: number[];
  collaboratoriIds?: number[];
  collaboratori?: CollaboratoreInput[];
  fasce?: FasceOrarie;
  squadre?: SquadraInput[];
  materialiTesto?: string;
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
  allegatiIds?: number[];
}

export async function bollettiniRoutes(fastify: FastifyInstance) {
  const service = new BollettiniService(fastify.prisma);
  const pdfService = new BollettinoPdfService();
  const emailService = new BollettinoEmailService(fastify.prisma);
  const allegatiService = new AllegatiBollettinoService(fastify.prisma);

  // Intercetta solo multipart/form-data: la POST JSON del bollettino, col suo
  // bodyLimit dedicato, non viene toccata
  await fastify.register(multipart, {
    limits: { fileSize: allegatiService.maxBytes, files: 1 },
  });

  // Le rotte /allegati* stanno prima di /:id. Il radix tree di Fastify da'
  // comunque la precedenza alle rotte statiche, ma l'ordine toglie il dubbio.

  // Upload di un allegato. Avviene *prima* della firma: un upload che
  // fallisce deve fallire mentre l'operatore compila, non dopo che ha firmato.
  fastify.post('/allegati', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    if (!allegatiService.isConfigured()) {
      return reply.status(503).send({ error: 'Gli allegati non sono disponibili' });
    }

    const user = request.user as JwtPayload;

    let file;
    try {
      file = await request.file();
    } catch {
      return reply.status(400).send({ error: 'File non leggibile' });
    }

    if (!file) {
      return reply.status(400).send({ error: 'Nessun file caricato' });
    }

    if (!allegatiService.mimeAmmesso(file.mimetype)) {
      return reply.status(400).send({ error: 'Sono ammesse solo immagini e PDF' });
    }

    // Oltre `limits.fileSize` la toBuffer lancia: un 500 qui direbbe
    // all'operatore che e' rotto qualcosa, quando invece deve solo scegliere
    // un file piu' piccolo
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.status(400).send({ error: 'Il file supera i 10 MB' });
    }

    if (file.file.truncated || buffer.length > allegatiService.maxBytes) {
      return reply.status(400).send({ error: 'Il file supera i 10 MB' });
    }

    try {
      const allegato = await allegatiService.carica(
        user.id,
        file.filename || 'allegato',
        file.mimetype,
        buffer
      );
      return reply.status(201).send(allegato);
    } catch (error) {
      request.log.error({ err: error }, 'upload allegato bollettino');
      return reply.status(500).send({ error: 'Caricamento non riuscito' });
    }
  });

  // Solo su un allegato ancora orfano e proprio: dopo il salvataggio il
  // bollettino e' firmato e non si tocca piu'
  fastify.delete<{ Params: { id: string } }>('/allegati/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const user = request.user as JwtPayload;
    const rimosso = await allegatiService.rimuoviOrfano(parseInt(request.params.id, 10), user.id);

    if (!rimosso) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }

    return reply.send({ success: true });
  });

  fastify.get<{ Params: { id: string } }>('/allegati/:id/file', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    if (!allegatiService.isConfigured()) {
      return reply.status(503).send({ error: 'Gli allegati non sono disponibili' });
    }

    const user = request.user as JwtPayload;
    const allegato = await allegatiService.getById(parseInt(request.params.id, 10));

    if (!allegato) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }

    // Il dipendente accede ai propri: gli orfani che ha caricato lui, o quelli
    // appesi a un suo bollettino
    if (user.ruolo === 'DIPENDENTE') {
      const bollettino = allegato.bollettinoId
        ? await service.getById(allegato.bollettinoId)
        : null;
      const proprio = bollettino
        ? bollettino.utenteId === user.id
        : allegato.caricatoDaId === user.id;

      if (!proprio) {
        return reply.status(403).send({ error: 'Non autorizzato' });
      }
    }

    let file;
    try {
      file = await allegatiService.leggi(allegato.id);
    } catch (error) {
      request.log.error({ err: error }, 'lettura allegato bollettino');
      return reply.status(502).send({ error: 'File non recuperabile' });
    }

    if (!file) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }

    return reply
      .header('Content-Type', file.mimeType)
      .header(
        'Content-Disposition',
        `inline; filename="${sanitizeFilenamePart(file.nomeFile)}"`
      )
      .send(file.buffer);
  });

  // Mezzi selezionabili: anagrafica veicoli di Gica Noleggi. La rotta
  // /api/dream-veicoli e' riservata ai responsabili, questa espone i soli
  // veicoli attivi a chi e' abilitato ai bollettini.
  fastify.get('/veicoli', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const veicoli = await fastify.prisma.dreamVeicolo.findMany({
      where: { attivo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });

    return reply.send(veicoli);
  });

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
        clienteId: body.clienteId ?? null,
        cantiereId: body.cantiereId ?? null,
        cantieriIds: body.cantieriIds ?? [],
        collaboratoriIds: body.collaboratoriIds,
        collaboratori: body.collaboratori,
        fasce: body.fasce,
        squadre: body.squadre,
        materialiTesto: body.materialiTesto ?? null,
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
        allegatiIds: body.allegatiIds ?? [],
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

  // PDF cumulativo di cliente, cantieri compresi: e' l'unico disponibile per i
  // clienti che di cantieri non ne hanno
  fastify.get<{ Params: { clienteId: string } }>('/cliente/:clienteId/pdf', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    if (!(await assertAccessoBollettini(fastify, request, reply))) return reply;

    const clienteId = parseInt(request.params.clienteId, 10);
    const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };

    const cliente = await fastify.prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { nome: true },
    });

    if (!cliente) {
      return reply.status(404).send({ error: 'Cliente non trovato' });
    }

    const bollettini = await service.getByCliente(
      clienteId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    if (bollettini.length === 0) {
      return reply.status(404).send({ error: 'Nessun bollettino per questo cliente' });
    }

    const pdfBuffer = await pdfService.generateCumulativo(null, cliente.nome, bollettini);

    const filename = `bollettini-cliente-${sanitizeFilenamePart(cliente.nome)}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer);
  });
}
