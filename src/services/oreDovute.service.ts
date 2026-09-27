import { PrismaClient } from '@prisma/client';

export interface MeseOreDovute {
  mese: number;
  /** Minuti dovuti a tempo pieno, `null` se il mese non e' stato impostato. */
  minuti: number | null;
}

const MAX_MINUTI_MESE = 31 * 24 * 60;

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

  /** I dodici mesi dell'anno, anche quelli non ancora impostati. */
  async getAnno(anno: number): Promise<MeseOreDovute[]> {
    const righe = await this.prisma.oreDovuteMese.findMany({ where: { anno } });
    const perMese = new Map(righe.map((r) => [r.mese, r.minuti]));

    return Array.from({ length: 12 }, (_, i) => ({
      mese: i + 1,
      minuti: perMese.get(i + 1) ?? null,
    }));
  }

  /**
   * Salva i mesi ricevuti: un valore li crea o li aggiorna, `null` li
   * cancella. I mesi non presenti nella richiesta restano come sono.
   */
  async salvaAnno(anno: number, mesi: MeseOreDovute[]): Promise<MeseOreDovute[]> {
    for (const { mese, minuti } of mesi) {
      if (!Number.isInteger(mese) || mese < 1 || mese > 12) {
        throw new Error(`Mese non valido: ${mese}`);
      }
      if (minuti !== null && (!Number.isInteger(minuti) || minuti < 0 || minuti > MAX_MINUTI_MESE)) {
        throw new Error(`Ore non valide per il mese ${mese}`);
      }
    }

    await this.prisma.$transaction(
      mesi.map(({ mese, minuti }) =>
        minuti === null
          ? this.prisma.oreDovuteMese.deleteMany({ where: { anno, mese } })
          : this.prisma.oreDovuteMese.upsert({
              where: { anno_mese: { anno, mese } },
              create: { anno, mese, minuti },
              update: { minuti },
            })
      )
    );

    return this.getAnno(anno);
  }
}
