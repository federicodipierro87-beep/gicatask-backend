/**
 * Le righe di riepilogo delle ore in fondo ai dettagli per dipendente, le
 * stesse del Report Attivita': il totale comprende le assenze, il saldo si fa
 * sulle sole ore di lavoro. La riga delle ore di lavoro c'e' solo quando
 * differisce dal totale, cioe' con delle assenze, altrimenti sarebbe un
 * doppione.
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
  const righe: RigaRiepilogoOre[] = [
    { etichetta: etichettaTotale, minuti: r.totaleMinuti },
    { etichetta: 'TOTALE ORE DOVUTE', minuti: r.dovutiMinuti },
  ];
  if (r.lavoroMinuti !== r.totaleMinuti) {
    righe.push({ etichetta: 'ORE DI LAVORO (SENZA ASSENZE)', minuti: r.lavoroMinuti });
  }
  righe.push({ etichetta: 'SALDO ORE', minuti: r.lavoroMinuti - r.dovutiMinuti, saldo: true });
  return righe;
}
