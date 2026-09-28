import { FastifyInstance } from 'fastify';
import { OreDovuteService, annoValido } from '../services/oreDovute.service.js';
import type { MeseOreDovute } from '../services/oreDovute.service.js';
import { OreDovuteExportService } from '../services/oreDovuteExport.service.js';
import type { RiepiloghiPeriodo } from '../services/oreDovuteExport.service.js';
import { SaldiOreService } from '../services/saldiOre.service.js';

const NOMI_MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** Anno e mese di oggi in Svizzera: il server gira in UTC. */
function meseCorrente(): { anno: number; mese: number } {
  const [anno, mese] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  return { anno: anno as number, mese: mese as number };
}

const FORMATI = {
  pdf: { contentType: 'application/pdf', estensione: 'pdf' },
  excel: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    estensione: 'xlsx',
  },
} as const;

export async function oreDovuteRoutes(fastify: FastifyInstance) {
  const service = new OreDovuteService(fastify.prisma);
  const exportService = new OreDovuteExportService();
  const saldiOreService = new SaldiOreService(fastify.prisma);

  /**
   * Le ore del periodo trascorso dell'anno per dipendente: da gennaio al mese
   * corrente, o tutto l'anno se e' passato. Vengono dal Report Saldi Ore,
   * quindi il saldo e' il suo saldo cumulativo. `undefined` per un anno futuro.
   */
  const riepiloghiPeriodo = async (anno: number): Promise<RiepiloghiPeriodo | undefined> => {
    const oggi = meseCorrente();
    if (anno > oggi.anno) return undefined;
    const fino = anno < oggi.anno ? 12 : oggi.mese;

    const saldi = await saldiOreService.getMese(`${anno}-${String(fino).padStart(2, '0')}`);
    const perUtente = new Map(
      saldi.righe.map((r) => [
        r.utenteId,
        {
          totaleMinuti: r.mensili.reduce((t, m) => t + m.totaleMinuti, 0),
          dovutiMinuti: r.mensili.reduce((t, m) => t + m.dovutiMinuti, 0),
          lavoroMinuti: r.mensili.reduce((t, m) => t + m.effettuatiMinuti, 0),
        },
      ])
    );

    const etichetta = fino === 1 ? `gennaio ${anno}` : `gennaio-${NOMI_MESI[fino - 1]} ${anno}`;
    return { etichetta, perUtente };
  };

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

  // Ore dovute di ciascun dipendente mese per mese, dai dati salvati
  // (responsabile only). Stesso calcolo del prospetto negli export
  fastify.get<{ Params: { anno: string } }>('/:anno/prospetto', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const anno = Number(request.params.anno);
    if (!annoValido(anno)) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    return reply.send(await service.getProspetto(anno));
  });

  // Riepilogo del periodo trascorso per dipendente (responsabile only): lo
  // stesso delle pagine per dipendente degli export. `null` per un anno futuro
  fastify.get<{ Params: { anno: string } }>('/:anno/riepilogo', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const anno = Number(request.params.anno);
    if (!annoValido(anno)) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    const riepiloghi = await riepiloghiPeriodo(anno);
    if (!riepiloghi) return reply.send(null);

    return reply.send({
      etichetta: riepiloghi.etichetta,
      righe: [...riepiloghi.perUtente.entries()].map(([utenteId, ore]) => ({ utenteId, ...ore })),
    });
  });

  // Export PDF/Excel dei dati salvati di un anno (responsabile only). L'anno e'
  // validato prima di finire nel nome del file, nell'header Content-Disposition
  fastify.get<{ Params: { anno: string; formato: string } }>('/:anno/export/:formato', {
    preHandler: [fastify.requireRole('RESPONSABILE')],
  }, async (request, reply) => {
    const anno = Number(request.params.anno);
    if (!annoValido(anno)) {
      return reply.status(400).send({ error: 'Anno non valido' });
    }

    const formato = request.params.formato;
    if (formato !== 'pdf' && formato !== 'excel') {
      return reply.status(404).send({ error: 'Formato non supportato' });
    }

    const dati = await service.getAnno(anno);
    const [prospetto, riepiloghi] = await Promise.all([
      service.getProspetto(anno, dati),
      riepiloghiPeriodo(anno),
    ]);
    const buffer = formato === 'pdf'
      ? await exportService.generaPdf(dati, prospetto, anno, riepiloghi)
      : await exportService.generaExcel(dati, prospetto, anno, riepiloghi);
    const cfg = FORMATI[formato];

    return reply
      .header('Content-Type', cfg.contentType)
      .header('Content-Disposition', `attachment; filename="ore-dovute-${anno}.${cfg.estensione}"`)
      .send(buffer);
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
