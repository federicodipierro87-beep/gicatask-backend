/**
 * Le righe di riepilogo delle ore in fondo ai dettagli per dipendente, le
 * stesse del Report Attivita': il totale comprende le assenze, il saldo si fa
 * sulle sole ore di lavoro. Le ore di lavoro senza assenze non hanno una riga
 * propria.
 */

export interface RiepilogoOre {
  /** Tutte le ore, assenze comprese. */
  totaleMinuti: number;
  dovutiMinuti: number;
  /** Solo ore di lavoro. */
  lavoroMinuti: number;
}

export interface RigaRiepilogoOre {
  etichetta: string;
  minuti: number;
  /** La riga del saldo, che si colora col segno. */
  saldo?: boolean;
}

export function righeRiepilogoOre(
  r: RiepilogoOre,
  etichettaTotale = 'TOTALE ORE MESE'
): RigaRiepilogoOre[] {
  return [
    { etichetta: etichettaTotale, minuti: r.totaleMinuti },
    { etichetta: 'TOTALE ORE DOVUTE', minuti: r.dovutiMinuti },
    { etichetta: 'SALDO ORE', minuti: r.lavoroMinuti - r.dovutiMinuti, saldo: true },
  ];
}
