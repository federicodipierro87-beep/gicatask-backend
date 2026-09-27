import { Prisma, PrismaClient } from '@prisma/client';

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

const MAX_MINUTI_MESE = 31 * 24 * 60;
const MAX_MINUTI_ANNO = 366 * 24 * 60;

export function annoValido(anno: number): boolean {
  return Number.isInteger(anno) && anno >= 2000 && anno <= 2100;
}

/**
 * Minuti dovuti da chi lavora a `percentuale` in un mese che a tempo pieno ne
 * vale `minutiTempoPieno`. Arrotondati al minuto mese per mese: il saldo
 * cumulativo somma gli stessi valori che il report mostra.
 */
export function minutiPerPercentuale(minutiTempoPieno: number, percentuale: number): number {
  return Math.round((minutiTempoPieno * percentuale) / 100);
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
