import { Prisma, PrismaClient } from '@prisma/client';
import { nomeUtente } from '../utils/nomeUtente.js';
import { inizioMese, minutiPerPercentuale, percentualeNelMese } from '../utils/percentualeLavoro.js';
import { utentiDeiReportOre } from './saldiOre.service.js';

export interface MeseOreDovute {
  mese: number;
  /** Minuti dovuti a tempo pieno, `null` se il mese non e' stato impostato. */
  minuti: number | null;
}

export interface OreDovuteAnno {
  mesi: MeseOreDovute[];
  /**
   * Ore annue a tempo pieno inserite a mano, `null` se non impostate. Servono
   * solo da controllo incrociato con la somma dei mesi.
   */
  minutiAnnui: number | null;
}

export interface RigaProspetto {
  utenteId: number;
  utenteNome: string;
  /** Percentuale in vigore in ciascun mese, gennaio in posizione 0. */
  percentuali: number[];
  /** Minuti dovuti mese per mese; `null` dove il mese non e' impostato. */
  minuti: (number | null)[];
  totale: number;
}

export interface OreDovutePeriodo {
  minuti: number;
  /** Mesi del periodo senza ore dovute impostate, come "2026-03": valgono zero. */
  mesiNonImpostati: string[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Oltre non e' piu' un report mensile: e' quasi certamente un refuso nelle date
const MAX_MESI_PERIODO = 36;

/**
 * I mesi (anno, mese) di un periodo fatto di mesi interi: dal primo giorno di
 * un mese all'ultimo di un mese. `null` per qualunque altro periodo, perche'
 * le ore dovute esistono solo per mese intero e un pro-rata sui giorni di
 * calendario darebbe un numero che nessuno ha deciso.
 */
export function mesiInteriDelPeriodo(
  startDate: string,
  endDate: string
): { anno: number; mese: number }[] | null {
  const inizio = ISO_DATE.exec(startDate);
  const fine = ISO_DATE.exec(endDate);
  if (!inizio || !fine || inizio[3] !== '01') return null;

  const annoFine = Number(fine[1]);
  const meseFine = Number(fine[2]);
  // Ultimo giorno del mese: il giorno 0 del mese dopo
  const ultimoGiorno = new Date(Date.UTC(annoFine, meseFine, 0)).getUTCDate();
  if (Number(fine[3]) !== ultimoGiorno) return null;

  const mesi: { anno: number; mese: number }[] = [];
  let anno = Number(inizio[1]);
  let mese = Number(inizio[2]);
  while (anno < annoFine || (anno === annoFine && mese <= meseFine)) {
    mesi.push({ anno, mese });
    if (mesi.length > MAX_MESI_PERIODO) return null;
    mese += 1;
    if (mese > 12) {
      mese = 1;
      anno += 1;
    }
  }

  return mesi.length > 0 ? mesi : null;
}

const MAX_MINUTI_MESE = 31 * 24 * 60;
const MAX_MINUTI_ANNO = 366 * 24 * 60;

export function annoValido(anno: number): boolean {
  return Number.isInteger(anno) && anno >= 2000 && anno <= 2100;
}

export class OreDovuteService {
  constructor(private prisma: PrismaClient) {}

  /** I dodici mesi dell'anno, anche quelli non ancora impostati, e le ore annue. */
  async getAnno(anno: number): Promise<OreDovuteAnno> {
    const [righe, annuale] = await Promise.all([
      this.prisma.oreDovuteMese.findMany({ where: { anno } }),
      this.prisma.oreDovuteAnno.findUnique({ where: { anno } }),
    ]);
    const perMese = new Map(righe.map((r) => [r.mese, r.minuti]));

    return {
      mesi: Array.from({ length: 12 }, (_, i) => ({
        mese: i + 1,
        minuti: perMese.get(i + 1) ?? null,
      })),
      minutiAnnui: annuale?.minuti ?? null,
    };
  }

  /**
   * Ore dovute di un dipendente su un periodo a mesi interi, con la
   * percentuale in vigore in ciascun mese: gli stessi valori del Report Saldi
   * Ore. `null` se il periodo non e' fatto di mesi interi.
   */
  async getOreDovutePeriodo(
    utenteId: number,
    startDate: string,
    endDate: string
  ): Promise<OreDovutePeriodo | null> {
    const mesi = mesiInteriDelPeriodo(startDate, endDate);
    if (!mesi) return null;

    const [righe, utente] = await Promise.all([
      this.prisma.oreDovuteMese.findMany({
        where: { OR: mesi.map(({ anno, mese }) => ({ anno, mese })) },
      }),
      this.prisma.utente.findUnique({
        where: { id: utenteId },
        select: {
          percentualeLavoro: true,
          percentualiLavoro: { select: { decorrenza: true, percentuale: true } },
        },
      }),
    ]);
    if (!utente) return null;

    const tempoPieno = new Map(righe.map((r) => [`${r.anno}-${r.mese}`, r.minuti]));
    let minuti = 0;
    const mesiNonImpostati: string[] = [];

    for (const { anno, mese } of mesi) {
      const base = tempoPieno.get(`${anno}-${mese}`);
      if (base === undefined) {
        mesiNonImpostati.push(`${anno}-${String(mese).padStart(2, '0')}`);
        continue;
      }
      const percentuale = percentualeNelMese(
        utente.percentualeLavoro,
        utente.percentualiLavoro,
        anno,
        mese
      );
      minuti += minutiPerPercentuale(base, percentuale);
    }

    return { minuti, mesiNonImpostati };
  }

  /**
   * Ore dovute di ciascun dipendente nei dodici mesi: quelle a tempo pieno per
   * la percentuale in vigore in quel mese, come nel Report Saldi Ore. Le
   * persone sono le stesse del report, con le ore di lavoro dell'intero anno.
   */
  async getProspetto(anno: number, dati?: OreDovuteAnno): Promise<RigaProspetto[]> {
    const [tempoPieno, conOre] = await Promise.all([
      dati ?? this.getAnno(anno),
      this.prisma.attivita.groupBy({
        by: ['utenteId'],
        where: {
          assenzaId: null,
          dataRiferimento: { gte: inizioMese(anno, 1), lt: inizioMese(anno + 1, 1) },
        },
      }),
    ]);

    const utenti = await utentiDeiReportOre(this.prisma, conOre.map((r) => r.utenteId));

    return utenti.map((u) => {
      const percentuali = tempoPieno.mesi.map((m) =>
        percentualeNelMese(u.percentualeLavoro, u.percentualiLavoro, anno, m.mese)
      );
      const minuti = tempoPieno.mesi.map((m, i) =>
        m.minuti === null ? null : minutiPerPercentuale(m.minuti, percentuali[i] as number)
      );

      return {
        utenteId: u.id,
        utenteNome: nomeUtente(u),
        percentuali,
        minuti,
        totale: minuti.reduce<number>((tot, m) => tot + (m ?? 0), 0),
      };
    });
  }

  /**
   * Salva i mesi ricevuti: un valore li crea o li aggiorna, `null` li
   * cancella. I mesi non presenti nella richiesta restano come sono, e cosi'
   * le ore annue se `minutiAnnui` e' `undefined`.
   *
   * Le ore annue non devono coincidere con la somma dei mesi: il controllo
   * incrociato e' un avviso nella pagina, non un vincolo. I mesi si inseriscono
   * anche uno alla volta, e un salvataggio a meta' deve restare possibile.
   */
  async salvaAnno(
    anno: number,
    mesi: MeseOreDovute[],
    minutiAnnui?: number | null
  ): Promise<OreDovuteAnno> {
    for (const { mese, minuti } of mesi) {
      if (!Number.isInteger(mese) || mese < 1 || mese > 12) {
        throw new Error(`Mese non valido: ${mese}`);
      }
      if (minuti !== null && (!Number.isInteger(minuti) || minuti < 0 || minuti > MAX_MINUTI_MESE)) {
        throw new Error(`Ore non valide per il mese ${mese}`);
      }
    }
    if (
      minutiAnnui != null &&
      (!Number.isInteger(minutiAnnui) || minutiAnnui < 0 || minutiAnnui > MAX_MINUTI_ANNO)
    ) {
      throw new Error('Ore annue non valide');
    }

    const operazioni: Prisma.PrismaPromise<unknown>[] = mesi.map(({ mese, minuti }) =>
      minuti === null
        ? this.prisma.oreDovuteMese.deleteMany({ where: { anno, mese } })
        : this.prisma.oreDovuteMese.upsert({
            where: { anno_mese: { anno, mese } },
            create: { anno, mese, minuti },
            update: { minuti },
          })
    );

    if (minutiAnnui === null) {
      operazioni.push(this.prisma.oreDovuteAnno.deleteMany({ where: { anno } }));
    } else if (minutiAnnui !== undefined) {
      operazioni.push(
        this.prisma.oreDovuteAnno.upsert({
          where: { anno },
          create: { anno, minuti: minutiAnnui },
          update: { minuti: minutiAnnui },
        })
      );
    }

    await this.prisma.$transaction(operazioni);

    return this.getAnno(anno);
  }
}
