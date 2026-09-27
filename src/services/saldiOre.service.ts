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
  /**
   * Differenza di ciascun mese da gennaio a quello richiesto (gennaio in
   * posizione 0): la loro somma e' il saldo cumulativo. Serve al prospetto
   * annuale degli export.
   */
  differenzeMensili: number[];
  /** Dettaglio di ciascun mese da gennaio: serve al foglio per dipendente. */
  mensili: MeseSaldoOre[];
}

export interface MeseSaldoOre {
  mese: number;
  percentuale: number;
  dovutiMinuti: number;
  /** Solo ore di lavoro, senza assenze: e' la base del saldo. */
  effettuatiMinuti: number;
  differenzaMinuti: number;
  /**
   * Tutte le ore del mese, assenze comprese: il "Totale ore mese" del Report
   * Attivita'. Non entra nel saldo.
   */
  totaleMinuti: number;
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
    // Le singole attivita' e non un groupBy: Prisma non raggruppa per mese di
    // una data, e le righe di un anno sono poche migliaia al massimo. Assenze
    // comprese: servono al totale ore mese, e restano fuori da lavoro e saldo
    const [attivita, oreDovute] = await Promise.all([
      this.prisma.attivita.findMany({
        where: {
          dataRiferimento: { gte: inizioMese(anno, 1), lt: inizioMese(anno, mese + 1) },
        },
        select: { utenteId: true, dataRiferimento: true, durataMinuti: true, assenzaId: true },
      }),
      this.prisma.oreDovuteMese.findMany({ where: { anno, mese: { lte: mese } } }),
    ]);

    // Minuti dovuti a tempo pieno, da gennaio al mese richiesto
    const tempoPieno = new Map(oreDovute.map((r) => [r.mese, r.minuti]));
    const mesiDelPeriodo = Array.from({ length: mese }, (_, i) => i + 1);

    // Minuti per utente, un elemento per mese da gennaio: `effettuati` le sole
    // ore di lavoro, `totali` anche le assenze. La data e' @db.Date, riletta a
    // mezzanotte UTC: il mese va preso in UTC
    const effettuati = new Map<number, number[]>();
    const totali = new Map<number, number[]>();
    const aggiungi = (mappa: Map<number, number[]>, utenteId: number, i: number, minuti: number) => {
      let mesi = mappa.get(utenteId);
      if (!mesi) {
        mesi = Array(mese).fill(0) as number[];
        mappa.set(utenteId, mesi);
      }
      mesi[i] = (mesi[i] ?? 0) + minuti;
    };
    for (const a of attivita) {
      const i = a.dataRiferimento.getUTCMonth();
      aggiungi(totali, a.utenteId, i, a.durataMinuti);
      if (a.assenzaId === null) aggiungi(effettuati, a.utenteId, i, a.durataMinuti);
    }

    const utenti = await utentiDeiReportOre(this.prisma, [...effettuati.keys()]);

    const righe = utenti.map((u) => {
      // Ogni mese con la percentuale in vigore in quel mese: una variazione
      // non riscrive i saldi dei mesi precedenti alla sua decorrenza
      const percentuale = (m: number) =>
        percentualeNelMese(u.percentualeLavoro, u.percentualiLavoro, anno, m);
      const dovuti = (m: number) => minutiPerPercentuale(tempoPieno.get(m) ?? 0, percentuale(m));

      const mesiEffettuati = effettuati.get(u.id) ?? (Array(mese).fill(0) as number[]);
      const mesiTotali = totali.get(u.id);
      const mensili: MeseSaldoOre[] = mesiDelPeriodo.map((m) => {
        const dovutiMinuti = dovuti(m);
        const effettuatiMinuti = mesiEffettuati[m - 1] ?? 0;
        return {
          mese: m,
          percentuale: percentuale(m),
          dovutiMinuti,
          effettuatiMinuti,
          differenzaMinuti: effettuatiMinuti - dovutiMinuti,
          totaleMinuti: mesiTotali?.[m - 1] ?? 0,
        };
      });
      const differenzeMensili = mensili.map((x) => x.differenzaMinuti);

      const oreDovuteMinuti = dovuti(mese);
      const oreEffettuateMinuti = mesiEffettuati[mese - 1] ?? 0;

      return {
        utenteId: u.id,
        utenteNome: nomeUtente(u),
        percentualeLavoro: percentuale(mese),
        oreDovuteMinuti,
        oreEffettuateMinuti,
        differenzaMinuti: oreEffettuateMinuti - oreDovuteMinuti,
        saldoCumulativoMinuti: differenzeMensili.reduce((tot, d) => tot + d, 0),
        differenzeMensili,
        mensili,
      };
    });

    return {
      righe,
      mesiSenzaOreDovute: mesiDelPeriodo.filter((m) => !tempoPieno.has(m)),
    };
  }
}
