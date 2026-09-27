import { PrismaClient } from '@prisma/client';
import { nomeUtente } from '../utils/nomeUtente.js';
import { inizioMese, minutiPerPercentuale, percentualeNelMese } from '../utils/percentualeLavoro.js';

const MESE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface RigaSaldoOre {
  utenteId: number;
  utenteNome: string;
  /** Percentuale in vigore nel mese richiesto. */
  percentualeLavoro: number;
  oreDovuteMinuti: number;
  oreEffettuateMinuti: number;
  /** Effettuate meno dovute: positiva se il dipendente ha lavorato di piu'. */
  differenzaMinuti: number;
  /** Somma delle differenze da gennaio al mese richiesto compreso. */
  saldoCumulativoMinuti: number;
}

export interface SaldiOreMese {
  righe: RigaSaldoOre[];
  /**
   * Mesi da gennaio a quello richiesto senza ore dovute impostate: valgono
   * zero, quindi differenza e saldo di quei mesi sono gonfiati.
   */
  mesiSenzaOreDovute: number[];
}

/**
 * Chi compare nei report delle ore: i dipendenti attivi, anche a zero ore,
 * perche' con le ore dovute un mese vuoto e' un saldo negativo. Chiunque altro
 * (responsabili, dipendenti disattivati) solo se ha ore di lavoro nel periodo,
 * `idsConOre`: il suo saldo esiste comunque. Condiviso con il prospetto delle
 * ore dovute, cosi' i due report elencano le stesse persone.
 */
export function utentiDeiReportOre(prisma: PrismaClient, idsConOre: number[]) {
  return prisma.utente.findMany({
    where: {
      OR: [
        { attivo: true, ruolo: 'DIPENDENTE' },
        { id: { in: idsConOre } },
      ],
    },
    select: {
      id: true,
      nome: true,
      cognome: true,
      percentualeLavoro: true,
      percentualiLavoro: { select: { decorrenza: true, percentuale: true } },
    },
    orderBy: [{ ruolo: 'asc' }, { cognome: 'asc' }, { nome: 'asc' }],
  });
}

export class SaldiOreService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Saldi ore del mese `YYYY-MM`, una riga per dipendente.
   *
   * Le ore effettuate sono le sole attivita' di lavoro: le assenze restano
   * fuori, comprese quelle che valgono una giornata piena (Vacanza, Malattia),
   * e non riducono le ore dovute: e' una scelta, un giorno di assenza fa
   * scendere il saldo. Il cumulativo riparte da zero a gennaio.
   */
  async getMese(meseKey: string): Promise<SaldiOreMese> {
    const match = MESE.exec(meseKey);
    if (!match) {
      throw new Error(`Mese non valido: ${meseKey}`);
    }

    const anno = Number(match[1]);
    const mese = Number(match[2]);
    const lavoro = { assenzaId: null };

    const [delMese, dallInizioAnno, oreDovute] = await Promise.all([
      this.prisma.attivita.groupBy({
        by: ['utenteId'],
        where: {
          ...lavoro,
          dataRiferimento: { gte: inizioMese(anno, mese), lt: inizioMese(anno, mese + 1) },
        },
        _sum: { durataMinuti: true },
      }),
      this.prisma.attivita.groupBy({
        by: ['utenteId'],
        where: {
          ...lavoro,
          dataRiferimento: { gte: inizioMese(anno, 1), lt: inizioMese(anno, mese + 1) },
        },
        _sum: { durataMinuti: true },
      }),
      this.prisma.oreDovuteMese.findMany({ where: { anno, mese: { lte: mese } } }),
    ]);

    // Minuti dovuti a tempo pieno, da gennaio al mese richiesto
    const tempoPieno = new Map(oreDovute.map((r) => [r.mese, r.minuti]));
    const mesiDelPeriodo = Array.from({ length: mese }, (_, i) => i + 1);

    const minutiMese = new Map(delMese.map((r) => [r.utenteId, r._sum.durataMinuti ?? 0]));
    const minutiAnno = new Map(dallInizioAnno.map((r) => [r.utenteId, r._sum.durataMinuti ?? 0]));

    const utenti = await utentiDeiReportOre(this.prisma, [...minutiAnno.keys()]);

    const righe = utenti.map((u) => {
      // Ogni mese con la percentuale in vigore in quel mese: una variazione
      // non riscrive i saldi dei mesi precedenti alla sua decorrenza
      const percentuale = (m: number) =>
        percentualeNelMese(u.percentualeLavoro, u.percentualiLavoro, anno, m);
      const dovuti = (m: number) => minutiPerPercentuale(tempoPieno.get(m) ?? 0, percentuale(m));

      const oreDovuteMinuti = dovuti(mese);
      const oreEffettuateMinuti = minutiMese.get(u.id) ?? 0;
      const dovuteAnno = mesiDelPeriodo.reduce((tot, m) => tot + dovuti(m), 0);

      return {
        utenteId: u.id,
        utenteNome: nomeUtente(u),
        percentualeLavoro: percentuale(mese),
        oreDovuteMinuti,
        oreEffettuateMinuti,
        differenzaMinuti: oreEffettuateMinuti - oreDovuteMinuti,
        saldoCumulativoMinuti: (minutiAnno.get(u.id) ?? 0) - dovuteAnno,
      };
    });

    return {
      righe,
      mesiSenzaOreDovute: mesiDelPeriodo.filter((m) => !tempoPieno.has(m)),
    };
  }
}
