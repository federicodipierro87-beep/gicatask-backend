/**
 * Le righe di riepilogo delle ore in fondo ai dettagli per dipendente, le
 * stesse del Report Attivita': totale (assenze comprese), dovute e saldo.
 */

export interface RiepilogoOre {
  /** Tutte le ore, assenze comprese. */
  totaleMinuti: number;
  dovutiMinuti: number;
  /**
   * Base del saldo. Fino al 28/10/2026 erano le sole ore di lavoro; ora sono
   * le ore effettuate del Report Saldi Ore, cioe' il totale.
   */
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
