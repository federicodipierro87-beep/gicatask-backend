import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { NoleggiService } from '../services/noleggi.service.js';
import { AllegatiNoleggioService, type FileNoleggio } from '../services/allegatiNoleggio.service.js';
import { NoleggioPdfService, nomeFileNoleggio } from '../services/noleggioPdf.service.js';
import { NoleggioEmailService } from '../services/noleggioEmail.service.js';
import { sanitizeFilenamePart } from '../services/bollettinoPdf.service.js';
import { assertAccessoNoleggi } from '../utils/noleggiAccess.js';
import { normalizzaEmail } from '../utils/email.js';
import type { JwtPayload } from '../types/index.js';

// La firma in base64 piu' il resto del corpo puo' sfiorare il limite di 1 MB
const BODY_LIMIT = 2 * 1024 * 1024;

/** Le foto nel PDF scaricato: stesso tetto della mail. */
const MAX_FOTO_PDF_BYTES = 15 * 1024 * 1024;

const createBodySchema = {
  type: 'object',
  // Solo tipi e lunghezze: un 400 dello schema arriverebbe prima dell'handler
  // e farebbe perdere la firma. I controlli di merito li fa il service, con un
  // messaggio leggibile
  required: ['data', 'clienteNome', 'veicoloNome', 'giorni', 'firmaNome', 'firmaImg'],
  properties: {
    data: { type: 'string', maxLength: 30 },
    dataIngresso: { type: 'string', maxLength: 30 },
    cantiereNome: { type: 'string', maxLength: 200 },
    salvaCantiere: { type: 'boolean' },
    clienteNome: { type: 'string', maxLength: 200 },
    salvaCliente: { type: 'boolean' },
    veicoloNome: { type: 'string', maxLength: 200 },
    salvaVeicolo: { type: 'boolean' },
    giorni: { type: 'number' },
    pieno: { type: 'boolean' },
    carburante: { type: 'string', maxLength: 20 },
    danniPrecedenti: { type: 'boolean' },
    danniPrecedentiNote: { type: 'string', maxLength: 5000 },
    danni: { type: 'boolean' },
    danniNote: { type: 'string', maxLength: 5000 },
    emailFatturazione: { type: 'string', maxLength: 254 },
    aggiornaEmailCliente: { type: 'boolean' },
    firmaNome: { type: 'string', maxLength: 200 },
    // Senza `format`: un indirizzo scritto male non deve far perdere la firma
    firmaEmail: { type: 'string', maxLength: 254 },
    firmaImg: { type: 'string', minLength: 1, maxLength: 400000 },
    fatturato: { type: 'boolean' },
    scontrinoIds: { type: 'array', maxItems: 10, items: { type: 'number' } },
    danniPrecedentiIds: { type: 'array', maxItems: 10, items: { type: 'number' } },
    danniIds: { type: 'array', maxItems: 10, items: { type: 'number' } },
    // "Salva e invia": manda subito il verbale all'indirizzo di fatturazione
    invia: { type: 'boolean' },
  },
} as const;

interface CreateBody {
  /** Data di uscita del veicolo. */
  data: string;
  dataIngresso?: string;
  cantiereNome?: string;
  salvaCantiere?: boolean;
  clienteNome: string;
  salvaCliente?: boolean;
  veicoloNome: string;
  salvaVeicolo?: boolean;
  giorni: number;
  pieno?: boolean;
  carburante?: string;
  danniPrecedenti?: boolean;
  danniPrecedentiNote?: string;
  danni?: boolean;
  danniNote?: string;
  emailFatturazione?: string;
  aggiornaEmailCliente?: boolean;
  firmaNome: string;
  firmaEmail?: string;
  firmaImg: string;
  fatturato?: boolean;
  scontrinoIds?: number[];
  danniPrecedentiIds?: number[];
  danniIds?: number[];
  invia?: boolean;
}

export async function noleggiRoutes(fastify: FastifyInstance) {
  const service = new NoleggiService(fastify.prisma);
  const allegatiService = new AllegatiNoleggioService(fastify.prisma);
  const pdfService = new NoleggioPdfService();
  const emailService = new NoleggioEmailService(fastify.prisma);

  await fastify.register(multipart, {
    limits: { fileSize: allegatiService.maxBytes, files: 1 },
  });

  /**
   * Il verbale lo vede chi l'ha compilato; quelli altrui solo il responsabile.
   * Il flag e' gia' stato verificato dal chiamante.
   */
  const puoVedere = (request: FastifyRequest, utenteId: number): boolean => {
    const user = request.user as JwtPayload;
    return utenteId === user.id || user.ruolo === 'RESPONSABILE';
  };

  const nonAutorizzato = (reply: FastifyReply) => reply.status(403).send({ error: 'Non autorizzato' });

  // Suggerimenti per cantiere, cliente e veicolo
  fastify.get('/anagrafiche', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;
    return reply.send(await service.anagrafiche());
  });

  // Upload di una foto, prima della firma
  fastify.post('/allegati', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

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
      const allegato = await allegatiService.carica(user.id, file.filename || 'foto', file.mimetype, buffer);
      return reply.status(201).send(allegato);
    } catch (error) {
      request.log.error({ err: error }, 'upload foto noleggio');
      return reply.status(500).send({ error: 'Caricamento non riuscito' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/allegati/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

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
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

    if (!allegatiService.isConfigured()) {
      return reply.status(503).send({ error: 'Gli allegati non sono disponibili' });
    }

    const allegato = await allegatiService.getById(parseInt(request.params.id, 10));
    if (!allegato) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }

    // Un orfano e' di chi l'ha caricato, un collegato di chi ha il verbale
    const noleggio = allegato.noleggioId ? await service.getById(allegato.noleggioId) : null;
    if (!puoVedere(request, noleggio ? noleggio.utenteId : allegato.caricatoDaId)) {
      return nonAutorizzato(reply);
    }

    let file;
    try {
      file = await allegatiService.leggi(allegato.id);
    } catch (error) {
      request.log.error({ err: error }, 'lettura foto noleggio');
      return reply.status(502).send({ error: 'File non recuperabile' });
    }

    if (!file) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }

    return reply
      .header('Content-Type', file.mimeType)
      .header('Content-Disposition', `inline; filename="${sanitizeFilenamePart(file.nomeFile)}"`)
      .send(file.buffer);
  });

  // Elenco: il dipendente vede solo i propri, il responsabile tutti
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

    const user = request.user as JwtPayload;
    const { utenteId, startDate, endDate } = request.query as {
      utenteId?: string;
      startDate?: string;
      endDate?: string;
    };

    const noleggi = await service.getAll({
      utenteId: user.ruolo === 'RESPONSABILE'
        ? (utenteId ? parseInt(utenteId, 10) : undefined)
        : user.id,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return reply.send(noleggi);
  });

  fastify.post<{ Body: CreateBody }>('/', {
    preHandler: [fastify.authenticate],
    bodyLimit: BODY_LIMIT,
    schema: { body: createBodySchema },
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

    const user = request.user as JwtPayload;
    const body = request.body;
    const destinatario = (body.emailFatturazione ?? '').trim();
    const invia = Boolean(body.invia) && destinatario.length > 0;

    const data = new Date(body.data);
    if (Number.isNaN(data.getTime())) {
      return reply.status(400).send({ error: 'Data di uscita non valida' });
    }
    // Non nello schema: un 400 dello schema farebbe perdere la firma, qui il
    // messaggio arriva leggibile sopra il form
    const dataIngresso = new Date(body.dataIngresso ?? '');
    if (Number.isNaN(dataIngresso.getTime())) {
      return reply.status(400).send({ error: 'Indica la data di ingresso' });
    }

    let noleggioId: number;
    try {
      const creato = await service.create({
        utenteId: user.id,
        data,
        dataIngresso,
        cantiereNome: body.cantiereNome,
        salvaCantiere: body.salvaCantiere,
        clienteNome: body.clienteNome,
        salvaCliente: body.salvaCliente,
        veicoloNome: body.veicoloNome,
        salvaVeicolo: body.salvaVeicolo,
        giorni: body.giorni,
        pieno: body.pieno ?? false,
        carburante: body.carburante ?? null,
        danniPrecedenti: body.danniPrecedenti ?? null,
        danniPrecedentiNote: body.danniPrecedentiNote ?? null,
        danni: body.danni ?? false,
        danniNote: body.danniNote ?? null,
        emailFatturazione: destinatario || null,
        aggiornaEmailCliente: body.aggiornaEmailCliente,
        firmaNome: body.firmaNome,
        firmaEmail: body.firmaEmail ?? null,
        firmaImg: body.firmaImg,
        fatturato: body.fatturato ?? false,
        scontrinoIds: body.scontrinoIds,
        danniPrecedentiIds: body.danniPrecedentiIds,
        danniIds: body.danniIds,
        // IN_CORSO scritto subito: se il processo muore durante l'invio resta
        // traccia dell'invio richiesto
        emailStato: invia ? (normalizzaEmail(destinatario) ? 'IN_CORSO' : 'NON_VALIDA') : null,
      });
      noleggioId = creato.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }

    // Da qui il verbale ESISTE: nessun percorso deve piu' rispondere errore,
    // il client lo leggerebbe come "non salvato" e farebbe rifirmare
    if (!invia) {
      return reply.status(201).send({ id: noleggioId });
    }

    const esito = await emailService.invia(noleggioId, destinatario); // non lancia mai
    request.log.info({ noleggioId, stato: esito.stato }, 'invio mail noleggio');

    return reply.status(201).send({ id: noleggioId, email: esito });
  });

  // Invio o reinvio: da chi l'ha compilato ("Salva" e poi invio) o dal
  // responsabile. Sempre 200: l'esito e' nel corpo
  fastify.post<{ Params: { id: string }; Body: { email?: string } }>('/:id/invia-mail', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: { email: { type: 'string', maxLength: 254 } },
      },
    },
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

    const id = parseInt(request.params.id, 10);
    const noleggio = await service.getById(id);

    if (!noleggio) {
      return reply.status(404).send({ error: 'Noleggio non trovato' });
    }

    if (!puoVedere(request, noleggio.utenteId)) {
      return nonAutorizzato(reply);
    }

    const destinatario = (request.body?.email ?? noleggio.emailFatturazione ?? '').trim();
    if (!destinatario) {
      return reply.status(400).send({ error: 'Nessun indirizzo di fatturazione indicato' });
    }

    const esito = await emailService.invia(id, destinatario);
    request.log.info({ noleggioId: id, stato: esito.stato }, 'reinvio mail noleggio');

    return reply.send(esito);
  });

  fastify.get<{ Params: { id: string } }>('/:id/pdf', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

    const noleggio = await service.getFull(parseInt(request.params.id, 10));

    if (!noleggio) {
      return reply.status(404).send({ error: 'Noleggio non trovato' });
    }

    if (!puoVedere(request, noleggio.utenteId)) {
      return nonAutorizzato(reply);
    }

    // Senza foto il PDF si scarica comunque: R2 irraggiungibile non deve
    // impedire di avere il verbale firmato
    let foto: FileNoleggio[] = [];
    try {
      foto = await allegatiService.fileDiNoleggio(noleggio.id, MAX_FOTO_PDF_BYTES);
    } catch (error) {
      request.log.error({ err: error }, 'lettura foto per PDF noleggio');
    }

    const pdfBuffer = await pdfService.generate(noleggio, foto);

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${nomeFileNoleggio(noleggio)}"`)
      .send(pdfBuffer);
  });

  // Flag "Fatturato" dall'archivio (solo responsabile). Il verbale resta
  // firmato e immutato
  fastify.patch<{ Params: { id: string }; Body: { fatturato: boolean } }>('/:id/fatturato', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
    schema: {
      body: {
        type: 'object',
        required: ['fatturato'],
        properties: { fatturato: { type: 'boolean' } },
      },
    },
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

    const trovato = await service.setFatturato(parseInt(request.params.id, 10), request.body.fatturato);
    if (!trovato) {
      return reply.status(404).send({ error: 'Noleggio non trovato' });
    }

    return reply.send({ success: true });
  });

  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    if (!(await assertAccessoNoleggi(fastify, request, reply))) return reply;

    const id = parseInt(request.params.id, 10);
    if (!(await service.getById(id))) {
      return reply.status(404).send({ error: 'Noleggio non trovato' });
    }

    await service.delete(id);
    return reply.send({ success: true });
  });
}
