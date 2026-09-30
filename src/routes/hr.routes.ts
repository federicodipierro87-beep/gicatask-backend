import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { HrService, SchedaHrInput } from '../services/hr.service.js';
import { AllegatiHrService } from '../services/allegatiHr.service.js';
import { HrPdfService } from '../services/hrPdf.service.js';
import { CAMPI_HR } from '../utils/hrCampi.js';
import { sanitizeFilenamePart } from '../services/bollettinoPdf.service.js';
import type { JwtPayload } from '../types/index.js';

const testoNullable = { type: ['string', 'null'] };

const schedaSchema = {
  type: 'object',
  required: ['cognomeNome'],
  properties: {
    cognomeNome: { type: 'string', minLength: 1 },
    impostaFonte: { type: ['boolean', 'null'] },
    statiCivili: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        required: ['stato'],
        properties: { stato: { type: 'string' }, dal: testoNullable },
      },
    },
    gradiOccupazione: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        required: ['grado'],
        properties: { grado: { type: 'string' }, dal: testoNullable },
      },
    },
    fotoId: { type: ['number', 'null'] },
    figli: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        required: ['cognomeNome'],
        properties: { cognomeNome: { type: 'string' }, dataNascita: testoNullable },
      },
    },
    formazioni: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['nome'],
        properties: {
          id: { type: 'number' },
          nome: { type: 'string' },
          allegatiIds: { type: 'array', maxItems: 10, items: { type: 'number' } },
        },
      },
    },
  },
};

/** "1,2,3" -> [1, 2, 3], scartando cio' che non e' un id. */
function parseIds(valore?: string): number[] {
  return (valore ?? '')
    .split(',')
    .map((v) => parseInt(v, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Anagrafica HR dei dipendenti: dati personali, salario, IBAN. Tutto, letture
 * comprese, e' riservato al responsabile.
 */
export async function hrRoutes(fastify: FastifyInstance) {
  const service = new HrService(fastify.prisma);
  const allegatiService = new AllegatiHrService(fastify.prisma);
  const pdfService = new HrPdfService();

  fastify.addHook('preHandler', fastify.requireRole('RESPONSABILE'));

  await fastify.register(multipart, {
    limits: { fileSize: allegatiService.maxBytes, files: 1 },
  });

  fastify.get('/campi', async () =>
    CAMPI_HR.map(({ chiave, etichetta, sezione }) => ({ chiave, etichetta, sezione }))
  );

  fastify.get('/', async () => service.getAll());

  // --- Foto dei tesserini ---------------------------------------------------

  fastify.post('/allegati', async (request, reply) => {
    if (!allegatiService.isConfigured()) {
      return reply.status(503).send({ error: 'Gli allegati non sono disponibili' });
    }

    let file;
    try {
      file = await request.file();
    } catch {
      return reply.status(400).send({ error: 'File non leggibile' });
    }

    if (!file) return reply.status(400).send({ error: 'Nessun file caricato' });

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
      const user = request.user as JwtPayload;
      const allegato = await allegatiService.carica(user.id, file.filename || 'foto', file.mimetype, buffer);
      return reply.status(201).send(allegato);
    } catch (error) {
      request.log.error({ err: error }, 'upload foto formazione HR');
      return reply.status(500).send({ error: 'Caricamento non riuscito' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/allegati/:id/file', async (request, reply) => {
    if (!allegatiService.isConfigured()) {
      return reply.status(503).send({ error: 'Gli allegati non sono disponibili' });
    }

    let file;
    try {
      file = await allegatiService.leggi(parseInt(request.params.id, 10));
    } catch (error) {
      request.log.error({ err: error }, 'lettura foto formazione HR');
      return reply.status(502).send({ error: 'File non recuperabile' });
    }

    if (!file) return reply.status(404).send({ error: 'Allegato non trovato' });

    return reply
      .header('Content-Type', file.mimeType)
      .header('Content-Disposition', `inline; filename="${sanitizeFilenamePart(file.nomeFile)}"`)
      .send(file.buffer);
  });

  // --- Stampe -----------------------------------------------------------------

  // Una scheda per foglio, per i dipendenti spuntati nell'elenco
  fastify.get<{ Querystring: { ids?: string } }>('/stampa/schede', async (request, reply) => {
    const ids = parseIds(request.query.ids);
    if (ids.length === 0) return reply.status(400).send({ error: 'Nessun dipendente selezionato' });

    const schede = await service.getByIds(ids);
    const fotoIds = schede.flatMap((s) => [
      ...(s.fotoId ? [s.fotoId] : []),
      ...s.formazioni.flatMap((f) => f.foto.map((foto) => foto.id)),
    ]);
    const immagini = await allegatiService.immaginiPerPdf(fotoIds);

    const pdf = await pdfService.generaSchede(schede, immagini);

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'attachment; filename="schede-dipendenti.pdf"')
      .send(pdf);
  });

  fastify.get<{ Querystring: { ids?: string; campi?: string; titolo?: string } }>(
    '/stampa/riepilogo',
    async (request, reply) => {
      const ids = parseIds(request.query.ids);
      const campi = (request.query.campi ?? '').split(',').filter(Boolean);

      if (ids.length === 0) return reply.status(400).send({ error: 'Nessun dipendente selezionato' });
      if (campi.length === 0) return reply.status(400).send({ error: 'Nessun campo selezionato' });

      const schede = await service.getByIds(ids);
      const titolo = request.query.titolo?.trim().slice(0, 100) || 'Riepilogo dipendenti';
      const pdf = await pdfService.generaRiepilogo(schede, campi, titolo);

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="riepilogo-dipendenti.pdf"')
        .send(pdf);
    }
  );

  // --- Schede -----------------------------------------------------------------

  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const scheda = await service.getById(parseInt(request.params.id, 10));
    if (!scheda) return reply.status(404).send({ error: 'Scheda non trovata' });
    return reply.send(scheda);
  });

  fastify.post<{ Body: SchedaHrInput }>('/', { schema: { body: schedaSchema } }, async (request, reply) => {
    try {
      return reply.status(201).send(await service.create(request.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore';
      return reply.status(400).send({ error: message });
    }
  });

  fastify.put<{ Params: { id: string }; Body: SchedaHrInput }>(
    '/:id',
    { schema: { body: schedaSchema } },
    async (request, reply) => {
      try {
        return reply.send(await service.update(parseInt(request.params.id, 10), request.body));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Errore';
        return reply.status(400).send({ error: message });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      await service.delete(parseInt(request.params.id, 10));
      return reply.send({ success: true });
    } catch {
      return reply.status(404).send({ error: 'Scheda non trovata' });
    }
  });
}
