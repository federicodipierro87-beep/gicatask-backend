import { FastifyInstance } from 'fastify';
import { LogOperazioniService } from '../services/logOperazioni.service.js';

interface LogQuery {
  dal?: string;
  al?: string;
  utenti?: string;
  aree?: string;
  azioni?: string;
  esito?: string;
  q?: string;
  pagina?: string;
  perPagina?: string;
}

const istante = (v?: string) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const elenco = (v?: string) =>
  v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined;

export async function logRoutes(fastify: FastifyInstance) {
  const service = new LogOperazioniService(fastify.prisma);

  // `dal` e `al` sono istanti ISO calcolati dal browser sulla mezzanotte
  // locale: il server gira in UTC e non deve indovinare il fuso di chi guarda
  fastify.get<{ Querystring: LogQuery }>('/', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const q = request.query;
    const pagina = Math.max(1, parseInt(q.pagina ?? '1', 10) || 1);
    const perPagina = Math.min(200, Math.max(10, parseInt(q.perPagina ?? '50', 10) || 50));

    const risultato = await service.elenco({
      dal: istante(q.dal),
      al: istante(q.al),
      utentiIds: elenco(q.utenti)?.map(Number).filter(Number.isInteger),
      aree: elenco(q.aree),
      azioni: elenco(q.azioni),
      esito: q.esito === 'ok' ? true : q.esito === 'errore' ? false : undefined,
      testo: q.q?.trim() || undefined,
      pagina,
      perPagina,
    });

    return reply.send({ ...risultato, pagina, perPagina });
  });

  fastify.get('/filtri', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (_request, reply) => {
    return reply.send(await service.filtri());
  });
}
