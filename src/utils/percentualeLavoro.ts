/**
 * Percentuale di lavoro in vigore in un mese.
 *
 * Le variazioni valgono dal mese di decorrenza fino alla successiva; prima
 * della prima variazione vale la percentuale base dell'utente. La
 * granularita' e' il mese, come le ore dovute: una decorrenza a meta' mese
 * richiederebbe un pro-rata sui giorni che il calcolo non fa.
 */

const MESE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface VariazionePercentuale {
  decorrenza: Date;
  percentuale: number;
}

/** Primo giorno del mese a mezzanotte UTC, come Prisma rilegge le @db.Date. */
export function inizioMese(anno: number, mese: number): Date {
  return new Date(Date.UTC(anno, mese - 1, 1));
}

/** La data di decorrenza da "YYYY-MM", `null` se il testo non e' un mese. */
export function decorrenzaDaMese(meseKey: string): Date | null {
  const match = MESE.exec(meseKey);
  return match ? inizioMese(Number(match[1]), Number(match[2])) : null;
}

/**
 * Minuti dovuti da chi lavora a `percentuale` in un mese che a tempo pieno ne
 * vale `minutiTempoPieno`. Arrotondati al minuto mese per mese: il saldo
 * cumulativo somma gli stessi valori che il report mostra.
 */
export function minutiPerPercentuale(minutiTempoPieno: number, percentuale: number): number {
  return Math.round((minutiTempoPieno * percentuale) / 100);
}

export function percentualeNelMese(
  base: number,
  variazioni: VariazionePercentuale[],
  anno: number,
  mese: number
): number {
  const inizio = inizioMese(anno, mese).getTime();

  // Non si conta sull'ordine in cui arrivano: vince la decorrenza piu' recente
  // fra quelle gia' iniziate
  let inVigore: VariazionePercentuale | null = null;
  for (const v of variazioni) {
    const t = v.decorrenza.getTime();
    if (t <= inizio && (!inVigore || t > inVigore.decorrenza.getTime())) {
      inVigore = v;
    }
  }

  return inVigore?.percentuale ?? base;
}
