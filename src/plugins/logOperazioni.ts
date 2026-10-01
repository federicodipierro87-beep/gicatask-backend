import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { JwtPayload } from '../types/index.js';
import {
  LogOperazioniService,
  corpoPulito,
  voceCatalogo,
  type RecordLetto,
  type VoceCatalogo,
} from '../services/logOperazioni.service.js';

interface StatoLog {
  voce: VoceCatalogo;
  /** Il record prima dell'operazione, per le modifiche e le eliminazioni. */
  prima: RecordLetto | null;
  /** L'id restituito da una creazione. */
  idCreato: number | null;
  errore: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    statoLog?: StatoLog;
  }
}

// I messaggi di auth sono in inglese perche' il frontend li sostituisce coi
// propri; nel registro li legge il responsabile, quindi si traducono qui
const TRADUZIONI_ERRORI: Record<string, string> = {
  'Invalid password': 'Password errata',
  'Password required': 'Password mancante',
  'User not found or inactive': 'Utente inesistente o disattivato',
  'Insufficient permissions': 'Permessi insufficienti',
};

const idNumerico = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Registra nel pannello Log le operazioni degli utenti. Gli hook sono globali,
 * quindi coprono ogni rotta senza toccarla: il catalogo in
 * `logOperazioni.service.ts` decide cosa registrare e come descriverlo.
 *
 * Un errore del registro non deve mai far fallire l'operazione registrata:
 * ogni accesso al database qui e' protetto da try/catch e finisce nel log di
 * Fastify.
 */
async function logOperazioniPlugin(fastify: FastifyInstance) {
  const service = new LogOperazioniService(fastify.prisma);

  // Le rotte che non autenticano (logout) non valorizzano request.user
  const utenteDaToken = (request: FastifyRequest): number | null => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.substring(7) : request.cookies?.token;
    if (!token) return null;
    try {
      return fastify.jwt.verify<JwtPayload>(token).id;
    } catch {
      return null;
    }
  };

  // Gira prima dei preHandler delle rotte, quindi prima che l'operazione tocchi il record
  fastify.addHook('preHandler', async (request) => {
    const rotta = request.routeOptions.url;
    if (!rotta) return;
    const voce = voceCatalogo(request.method, rotta);
    if (!voce) return;

    const stato: StatoLog = { voce, prima: null, idCreato: null, errore: null };
    request.statoLog = stato;

    const id = idNumerico((request.params as Record<string, unknown> | undefined)?.['id']);
    const autenticato = Boolean(request.headers.authorization || request.cookies?.token);
    if (!voce.modello || !id || !autenticato) return;

    try {
      stato.prima = await service.leggi(voce.modello, id);
    } catch (err) {
      request.log.error({ err }, 'log operazioni: lettura record');
    }
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    const stato = request.statoLog;
    if (!stato || typeof payload !== 'string' || payload.length > 1_000_000) return payload;

    const serveErrore = reply.statusCode >= 400;
    const serveId = stato.voce.azione === 'CREAZIONE' && stato.voce.modello;
    if (!serveErrore && !serveId) return payload;

    try {
      const corpo = JSON.parse(payload) as Record<string, unknown>;
      if (serveErrore) {
        const msg = corpo['message'] ?? corpo['error'];
        stato.errore = typeof msg === 'string' ? (TRADUZIONI_ERRORI[msg] ?? msg) : null;
      } else {
        stato.idCreato = idNumerico(corpo['id']);
      }
    } catch {
      // Risposta non JSON: niente da estrarre
    }
    return payload;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const stato = request.statoLog;
    if (!stato) return;

    try {
      const { voce } = stato;
      const rotta = request.routeOptions.url ?? request.url;
      const status = reply.statusCode;
      const esito = status < 400;
      const params = (request.params ?? {}) as Record<string, unknown>;
      const body = request.body as Record<string, unknown> | undefined;

      let utenteId = (request.user as JwtPayload | undefined)?.id ?? utenteDaToken(request);
      if (rotta === '/api/auth/login') utenteId = idNumerico(body?.['utenteId']);
      // Senza utente (token assente o scaduto) non c'e' un'operazione da attribuire
      if (!utenteId) return;

      let etichetta = stato.prima?.etichetta ?? null;
      let dettaglio: unknown;

      if (voce.modello && esito) {
        if (voce.azione === 'CREAZIONE' && stato.idCreato) {
          const creato = await service.leggi(voce.modello, stato.idCreato);
          if (creato) {
            etichetta = creato.etichetta;
            dettaglio = { valori: await service.risolviRiferimenti(voce.modello, creato.valori) };
          }
        } else if (voce.azione === 'MODIFICA' && stato.prima) {
          const id = idNumerico(params['id']);
          const dopo = id ? await service.leggi(voce.modello, id) : null;
          if (dopo) {
            etichetta = dopo.etichetta;
            const modifiche = await service.differenze(voce.modello, stato.prima.valori, dopo.valori);
            if (modifiche.length) dettaglio = { modifiche };
          }
        } else if (voce.azione === 'ELIMINAZIONE' && stato.prima) {
          dettaglio = { valori: await service.risolviRiferimenti(voce.modello, stato.prima.valori) };
        }
      }

      // Riferimenti nel percorso (PDF cumulativo di un cantiere, ore dovute di un anno)
      if (!etichetta) {
        const altri = Object.fromEntries(
          Object.entries(params)
            .filter(([k]) => k !== 'id')
            .map(([k, v]) => [k, idNumerico(v) ?? v])
        );
        const risolti = await service.risolviRiferimenti('cliente', altri);
        const parti = Object.values(risolti).filter((v) => v !== undefined && v !== '');
        if (parti.length) etichetta = parti.join(', ');
      }

      // Operazioni senza record: si registrano i dati inviati o i filtri dell'export
      const json = String(request.headers['content-type'] ?? '').includes('application/json');
      if (dettaglio === undefined && voce.area !== 'Accesso') {
        if (request.method === 'GET') {
          const query = corpoPulito(request.query) as Record<string, unknown> | undefined;
          if (query && Object.keys(query).length) dettaglio = { parametri: query };
        } else if (json && body && (!voce.modello || voce.corpo)) {
          dettaglio = { dati: corpoPulito(body) };
        }
      }

      const forwarded = request.headers['x-forwarded-for'];
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || request.ip;

      await service.scrivi({
        utenteId,
        area: voce.area,
        azione: voce.azione,
        descrizione: etichetta ? `${voce.testo}: ${etichetta}` : voce.testo,
        metodo: request.method,
        percorso: request.url.split('?')[0] ?? request.url,
        stato: status,
        esito,
        errore: esito ? null : stato.errore,
        dettaglio,
        ip,
      });
    } catch (err) {
      request.log.error({ err }, 'log operazioni: scrittura');
    }
  });
}

export default fp(logOperazioniPlugin, {
  name: 'log-operazioni',
  dependencies: ['auth'],
});
