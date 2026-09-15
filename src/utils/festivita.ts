/**
 * Calendario dei giorni non lavorativi del Canton Ticino.
 *
 * Tutto il modulo ragiona a mezzanotte UTC: una data costruita dai componenti
 * locali cambierebbe giorno a seconda del fuso del server.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MS_GIORNO = 86_400_000;

/**
 * Tetto ai giorni segnaposto di un report: un anno bisestile.
 *
 * Non e' un limite estetico. Un `<input type="date">` accetta anni a quattro
 * cifre a partire da `0001`, quindi un refuso come `0202-03-01` produce un
 * periodo di 666.000 giorni: il cap si calcola dai timestamp *prima* del ciclo,
 * perche' allocare 666k stringhe e filtrarle dopo mette in ginocchio il
 * processo.
 */
export const MAX_GIORNI_SEGNAPOSTO = 366;

/** Domenica di Pasqua secondo l'algoritmo gregoriano anonimo. */
export function pasqua(anno: number): Date {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(anno, mese - 1, giorno));
}

export function isoUtc(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function piuGiorniUtc(data: Date, giorni: number): Date {
  return new Date(data.getTime() + giorni * MS_GIORNO);
}

/** Giorni festivi del Canton Ticino (il Venerdi' Santo non e' festivo). */
export function festiviTicino(anno: number): Set<string> {
  const fissi: [number, number][] = [
    [1, 1],   // Capodanno
    [1, 6],   // Epifania
    [3, 19],  // San Giuseppe
    [5, 1],   // Festa del lavoro
    [6, 29],  // Santi Pietro e Paolo
    [8, 1],   // Festa nazionale
    [8, 15],  // Assunzione
    [11, 1],  // Ognissanti
    [12, 8],  // Immacolata
    [12, 25], // Natale
    [12, 26], // Santo Stefano
  ];

  const giorni = fissi.map(([mese, giorno]) =>
    isoUtc(new Date(Date.UTC(anno, mese - 1, giorno)))
  );

  const domenicaPasqua = pasqua(anno);
  giorni.push(
    isoUtc(piuGiorniUtc(domenicaPasqua, 1)),  // Lunedi' dell'Angelo
    isoUtc(piuGiorniUtc(domenicaPasqua, 39)), // Ascensione
    isoUtc(piuGiorniUtc(domenicaPasqua, 50)), // Lunedi' di Pentecoste
    isoUtc(piuGiorniUtc(domenicaPasqua, 60))  // Corpus Domini
  );

  return new Set(giorni);
}

// giornoNonLavorativo() e' chiamata una volta per riga di report: senza cache
// ricalcolerebbe Pasqua per ognuna
const cacheFestivi = new Map<number, Set<string>>();

function festiviCache(anno: number): Set<string> {
  let festivi = cacheFestivi.get(anno);
  if (!festivi) {
    festivi = festiviTicino(anno);
    cacheFestivi.set(anno, festivi);
  }
  return festivi;
}

/** Sabato, domenica o festivo ticinese. */
export function giornoNonLavorativo(iso: string): boolean {
  const data = new Date(`${iso}T00:00:00.000Z`);
  const giornoSettimana = data.getUTCDay();

  if (giornoSettimana === 0 || giornoSettimana === 6) return true;

  return festiviCache(data.getUTCFullYear()).has(iso);
}

/**
 * Tutti i giorni del periodo, estremi inclusi, in ordine crescente.
 *
 * Ritorna una lista vuota se il periodo non e' un range chiuso valido: date
 * malformate, date invertite o piu' lunghe di `maxGiorni`.
 */
export function giorniPeriodo(
  startIso: string,
  endIso: string,
  maxGiorni: number
): string[] {
  if (!ISO_DATE.test(startIso) || !ISO_DATE.test(endIso)) return [];

  const startMs = Date.parse(`${startIso}T00:00:00.000Z`);
  const endMs = Date.parse(`${endIso}T00:00:00.000Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];

  const giorni = (endMs - startMs) / MS_GIORNO + 1;
  // Copre anche le date invertite, che danno un conteggio negativo
  if (giorni < 1 || giorni > maxGiorni) return [];

  const risultato: string[] = [];
  for (let i = 0; i < giorni; i++) {
    risultato.push(isoUtc(new Date(startMs + i * MS_GIORNO)));
  }

  return risultato;
}
