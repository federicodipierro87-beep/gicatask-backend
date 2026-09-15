/**
 * Regola che decide quanto vale una giornata di assenza sul montante ore.
 *
 * Un'assenza vale sempre una giornata lavorativa piena, a prescindere dagli
 * orari inseriti. Il segno pero' cambia: la maggior parte delle assenze
 * (Vacanza, Malattia, Festivo...) *aggiunge* ore al montante, mentre il
 * "Recupero ore" le *sottrae*, perche' e' tempo gia' maturato che il
 * dipendente sta consumando.
 *
 * Il riconoscimento avviene dal nome del tipo assenza, non da un flag sullo
 * schema. E' il compromesso scelto per non introdurre una migrazione e una UI
 * dedicata; il prezzo e' che un rename del tipo cambierebbe il segno, per
 * questo `tipiAssenza.service.ts` blocca i rename che attraversano la regola.
 *
 * Questo file e' il punto unico che conosce la regola: per passare domani a un
 * flag persistito basta riscrivere `isAssenzaNegativa`.
 */

/** Una giornata lavorativa piena. */
export const DURATA_ASSENZA_MINUTI = 8 * 60 + 12;

/** Nomi (gia' normalizzati) delle assenze che sottraggono ore dal montante. */
const ASSENZE_NEGATIVE = new Set(['recupero ore']);

/**
 * Normalizza il nome di un tipo assenza per il confronto: senza spazi ai bordi,
 * minuscolo e con gli spazi interni collassati a uno solo. Cosi'
 * `"  RECUPERO   ORE  "` e `"Recupero ore"` sono lo stesso tipo.
 */
export function normalizzaNomeAssenza(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True se il tipo assenza sottrae ore invece di aggiungerle. */
export function isAssenzaNegativa(nome: string): boolean {
  return ASSENZE_NEGATIVE.has(normalizzaNomeAssenza(nome));
}

/** Minuti da salvare in `durataMinuti` per un'assenza di questo tipo. */
export function durataAssenzaMinuti(nome: string): number {
  return isAssenzaNegativa(nome) ? -DURATA_ASSENZA_MINUTI : DURATA_ASSENZA_MINUTI;
}
