/**
 * Formato del file di backup.
 *
 * Fino alla versione 1.0 il backup era un unico `JSON.stringify` di tutto il
 * database: una stringa sola, che V8 non sa costruire oltre ~512 MB. Bastavano
 * qualche centinaio di bollettini con firme della dimensione massima per far
 * finire in ERRORE ogni backup, automatico e manuale, e per non poter piu'
 * ripristinare un backup vicino al limite.
 *
 * Dalla 1.1 il file resta un JSON valido con la stessa struttura, ma scritto
 * un record per riga e costruito a pezzi:
 *
 *   {"version":"1.1","createdAt":"...","tables":{
 *   "utenti":[
 *   {...},
 *   {...}
 *   ],
 *   "clienti":[
 *   ]
 *   }}
 *
 * Nessuna stringa supera un singolo record. `JSON.stringify` non lascia mai
 * un a capo dentro un valore, quindi la riga e' un confine sicuro. La lettura
 * va riga per riga; i backup 1.0, indentati, si leggono ancora con JSON.parse.
 */

export interface FileBackup {
  version: string;
  createdAt: string;
  tables: Record<string, unknown[] | undefined>;
}

export const VERSIONE_BACKUP = '1.1';
const INIZIO_RIGHE = `{"version":"${VERSIONE_BACKUP}",`;
const A_CAPO = 0x0a;

export function serializzaBackup(dati: FileBackup): Buffer {
  const pezzi: Buffer[] = [];
  const scrivi = (testo: string) => pezzi.push(Buffer.from(testo + '\n', 'utf-8'));

  const intestazione = JSON.stringify({ version: VERSIONE_BACKUP, createdAt: dati.createdAt });
  scrivi(`${intestazione.slice(0, -1)},"tables":{`);

  const tabelle = Object.entries(dati.tables).filter(
    (voce): voce is [string, unknown[]] => voce[1] !== undefined
  );
  tabelle.forEach(([nome, righe], t) => {
    scrivi(`${JSON.stringify(nome)}:[`);
    righe.forEach((riga, i) => scrivi(JSON.stringify(riga) + (i < righe.length - 1 ? ',' : '')));
    scrivi(t < tabelle.length - 1 ? '],' : ']');
  });
  scrivi('}}');

  return Buffer.concat(pezzi);
}

export function leggiBackup(file: Buffer): FileBackup {
  if (!file.subarray(0, INIZIO_RIGHE.length).toString('utf-8').startsWith(INIZIO_RIGHE)) {
    // Backup 1.0: un unico JSON indentato
    return JSON.parse(file.toString('utf-8')) as FileBackup;
  }

  let pos = 0;
  const prossimaRiga = (): string | null => {
    if (pos >= file.length) return null;
    let fine = file.indexOf(A_CAPO, pos);
    if (fine === -1) fine = file.length;
    const riga = file.toString('utf-8', pos, fine);
    pos = fine + 1;
    return riga;
  };

  const prima = prossimaRiga()!;
  if (!prima.endsWith(',"tables":{')) throw new Error('Backup non valido: intestazione');
  const intestazione = JSON.parse(`${prima}}}`) as FileBackup;
  const tables: FileBackup['tables'] = {};

  let tabella: unknown[] | null = null;
  for (let riga = prossimaRiga(); riga !== null; riga = prossimaRiga()) {
    if (tabella === null) {
      if (riga === '}}') return { version: intestazione.version, createdAt: intestazione.createdAt, tables };
      if (!riga.endsWith(':[')) throw new Error('Backup non valido: tabella attesa');
      const nome = JSON.parse(riga.slice(0, -2)) as string;
      tabella = [];
      tables[nome] = tabella;
    } else if (riga === ']' || riga === '],') {
      tabella = null;
    } else {
      tabella.push(JSON.parse(riga.endsWith(',') ? riga.slice(0, -1) : riga));
    }
  }

  throw new Error('Backup non valido: file troncato');
}
