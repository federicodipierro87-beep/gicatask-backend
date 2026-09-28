import { PrismaClient, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { calculateDurationMinutes } from '../utils/duration.js';

/**
 * Import dei lavori registrati prima di GicaTask nel vecchio foglio Excel
 * ("import_vecchi_lavori.xlsx"): una riga per attività, con le colonne
 * DATA, EFFETTUATO DA, ATTIVITA' SVOLTA, Mattina inizio/fine, Pomeriggio
 * inizio/fine, Tot ore, Trasporto, Luogo montaggio, CLIENTE, DESCRIZIONE.
 *
 * I nomi nel foglio sono scritti a mano ("Er Noleggio", "ER Noleggio ",
 * "Ricky", "Richy"...), quindi l'import ha due passi: `analizza` raggruppa i
 * valori per chiave normalizzata e propone un abbinamento con le anagrafiche,
 * `importa` riceve la mappatura confermata dal responsabile e crea le attività.
 * Il file viene rispedito al secondo passo: il server non conserva nulla.
 */

export type Scelta =
  | { azione: 'esistente'; id: number }
  | { azione: 'nuovo'; nome: string }
  | { azione: 'nessuno' }
  | { azione: 'salta' };

export interface Voce {
  chiave: string;
  nome: string;
  varianti: string[];
  righe: number;
  suggerimento: Scelta | null;
}

export interface Mappatura {
  dipendenti: Record<string, Scelta>;
  clienti: Record<string, Scelta>;
  tipi: Record<string, Scelta>;
}

interface Fascia {
  inizio: string;
  fine: string;
}

interface RigaStorica {
  posizione: string;
  data: string; // YYYY-MM-DD
  dipendente: string;
  cliente: string;
  tipo: string;
  mattino: Fascia | null;
  pomeriggio: Fascia | null;
  descrizione: string;
  trasporto: string;
  luogo: string;
}

interface Lettura {
  fogli: string[];
  righe: RigaStorica[];
  errori: string[];
  avvisi: string[];
}

export interface Analisi {
  fogli: string[];
  righeValide: number;
  periodo: { da: string; a: string } | null;
  giaImportate: number;
  errori: string[];
  avvisi: string[];
  dipendenti: Voce[];
  clienti: Voce[];
  tipi: Voce[];
  anagrafiche: {
    utenti: { id: number; nome: string; cognome: string; attivo: boolean }[];
    clienti: { id: number; nome: string; attivo: boolean }[];
    tipi: { id: number; nome: string; attivo: boolean }[];
  };
}

export interface EsitoImport {
  attivitaCreate: number;
  duplicatiSaltati: number;
  righeSaltate: number;
  righeScartate: number;
  clientiCreati: number;
  tipiAttivitaCreati: number;
  errori: string[];
  avvisi: string[];
}

type Colonna =
  | 'data'
  | 'dipendente'
  | 'tipo'
  | 'mattinaInizio'
  | 'mattinaFine'
  | 'pomeriggioInizio'
  | 'pomeriggioFine'
  | 'trasporto'
  | 'luogo'
  | 'cliente'
  | 'descrizione';

const COLONNE_OBBLIGATORIE: Colonna[] = [
  'data',
  'dipendente',
  'mattinaInizio',
  'mattinaFine',
  'pomeriggioInizio',
  'pomeriggioFine',
];

// Riconosce una colonna dal testo normalizzato dell'intestazione
function colonnaDaIntestazione(testo: string): Colonna | null {
  const t = normalizza(testo);
  if (t === 'data') return 'data';
  if (t.startsWith('effettuato')) return 'dipendente';
  if (t.startsWith('attivita svolta')) return 'tipo';
  if (t === 'mattina inizio') return 'mattinaInizio';
  if (t === 'mattina fine') return 'mattinaFine';
  if (t === 'pomeriggio inizio') return 'pomeriggioInizio';
  if (t === 'pomeriggio fine') return 'pomeriggioFine';
  if (t.startsWith('trasporto')) return 'trasporto';
  if (t.startsWith('luogo')) return 'luogo';
  if (t === 'cliente') return 'cliente';
  if (t.startsWith('descrizione')) return 'descrizione';
  return null;
}

/** Chiave di confronto: minuscole, senza accenti, spazi e punteggiatura. */
export function normalizza(testo: string): string {
  return testo
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pulisci(testo: string): string {
  // Spazi (compreso quello indivisibile) e tab ridotti a uno, a capo conservati
  return testo.replace(/[^\S\r\n]+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const prec = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prec[0]!;
    prec[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const sopra = prec[j]!;
      prec[j] = Math.min(
        prec[j]! + 1,
        prec[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = sopra;
    }
  }
  return prec[b.length]!;
}

/**
 * Punteggio di somiglianza fra una chiave del foglio e una dell'anagrafica:
 * 3 uguali, 2 una è l'inizio dell'altra, 1 differiscono di una lettera
 * ("richy" / "ricky"), 0 nessuna somiglianza. L'inizio vale a parola intera
 * ("gica telone" / "gica"), o anche a metà parola con `parziale`, che serve
 * per i soprannomi ("benj" / "benjamin") ma non per i clienti ("lea" / "leandro").
 */
function somiglianza(chiave: string, candidata: string, parziale: boolean): number {
  if (!chiave || !candidata) return 0;
  if (chiave === candidata) return 3;
  const corta = chiave.length < candidata.length ? chiave : candidata;
  const lunga = corta === chiave ? candidata : chiave;
  if (corta.length >= 3 && lunga.startsWith(corta) && (parziale || lunga[corta.length] === ' ')) return 2;
  if (corta.length >= 4 && levenshtein(chiave, candidata) <= 1) return 1;
  return 0;
}

function migliore<T>(
  chiave: string,
  elementi: T[],
  chiavi: (e: T) => string[],
  parziale = false
): T | null {
  let best: T | null = null;
  let punti = 0;
  for (const e of elementi) {
    const p = Math.max(...chiavi(e).map((c) => somiglianza(chiave, normalizza(c), parziale)));
    if (p > punti) {
      best = e;
      punti = p;
    }
  }
  return best;
}

// Valore "semplice" di una cella: risolve formule, rich text e link
function valoreCella(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  if ('error' in v) return null;
  if ('result' in v) return (v as { result?: unknown }).result ?? null;
  if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  if ('text' in v) return (v as { text: unknown }).text;
  return null;
}

function testoCella(cell: ExcelJS.Cell): string {
  const v = valoreCella(cell);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return pulisci(String(v));
}

function due(n: number): string {
  return String(n).padStart(2, '0');
}

// Ora in minuti dalla mezzanotte, o null se la cella è vuota o illeggibile
function oraCella(cell: ExcelJS.Cell): number | null | 'invalida' {
  const v = valoreCella(cell);
  if (v === null || v === undefined || v === '') return null;

  let minuti: number;
  if (v instanceof Date) {
    // Le ore di Excel arrivano come date del 1899 in UTC
    const giorno = 24 * 60 * 60 * 1000;
    minuti = Math.round((((v.getTime() % giorno) + giorno) % giorno) / 60000);
  } else if (typeof v === 'number') {
    if (v < 0 || v > 1) return 'invalida';
    minuti = Math.round(v * 24 * 60);
  } else {
    const m = /^(\d{1,2})[:.,](\d{2})$/.exec(pulisci(String(v)));
    if (!m) return 'invalida';
    const ore = Number(m[1]);
    const min = Number(m[2]);
    if (ore > 24 || min > 59) return 'invalida';
    minuti = ore * 60 + min;
  }

  return minuti % (24 * 60);
}

function formattaOra(minuti: number): string {
  return `${due(Math.floor(minuti / 60))}:${due(minuti % 60)}`;
}

function dataCella(cell: ExcelJS.Cell): string | null {
  const v = valoreCella(cell);
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${due(v.getUTCMonth() + 1)}-${due(v.getUTCDate())}`;
  }
  if (typeof v === 'string') {
    const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v.trim());
    if (m) return `${m[3]}-${due(Number(m[2]))}-${due(Number(m[1]))}`;
  }
  return null;
}

function fascia(inizio: number | null, fine: number | null): Fascia | null {
  if (inizio === null || fine === null || inizio === fine) return null;
  return { inizio: formattaOra(inizio), fine: formattaOra(fine) };
}

function durata(riga: { mattino: Fascia | null; pomeriggio: Fascia | null }): number {
  let totale = 0;
  if (riga.mattino) totale += calculateDurationMinutes(riga.mattino.inizio, riga.mattino.fine);
  if (riga.pomeriggio) totale += calculateDurationMinutes(riga.pomeriggio.inizio, riga.pomeriggio.fine);
  return totale;
}

function chiaveDuplicato(
  utenteId: number,
  data: string,
  mattino: Fascia | null,
  pomeriggio: Fascia | null
): string {
  return [
    utenteId,
    data,
    mattino?.inizio ?? '',
    mattino?.fine ?? '',
    pomeriggio?.inizio ?? '',
    pomeriggio?.fine ?? '',
  ].join('|');
}

export class ImportStoricoService {
  constructor(private prisma: PrismaClient) {}

  private async leggi(buffer: Buffer): Promise<Lettura> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer);

    const lettura: Lettura = { fogli: [], righe: [], errori: [], avvisi: [] };

    for (const ws of workbook.worksheets) {
      // L'intestazione è la prima riga (entro le prime 10) con DATA ed EFFETTUATO DA
      let rigaIntestazione = 0;
      let colonne = new Map<Colonna, number>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const trovate = new Map<Colonna, number>();
        ws.getRow(r).eachCell((cell, col) => {
          const c = colonnaDaIntestazione(testoCella(cell));
          if (c && !trovate.has(c)) trovate.set(c, col);
        });
        if (trovate.has('data') && trovate.has('dipendente')) {
          rigaIntestazione = r;
          colonne = trovate;
          break;
        }
      }
      if (!rigaIntestazione) continue;

      const mancanti = COLONNE_OBBLIGATORIE.filter((c) => !colonne.has(c));
      if (mancanti.length > 0) {
        lettura.errori.push(`Foglio "${ws.name}": colonne mancanti (${mancanti.join(', ')})`);
        continue;
      }
      lettura.fogli.push(ws.name);

      const cella = (row: ExcelJS.Row, c: Colonna) => row.getCell(colonne.get(c) ?? 0);
      const testo = (row: ExcelJS.Row, c: Colonna) => (colonne.has(c) ? testoCella(cella(row, c)) : '');

      for (let r = rigaIntestazione + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const posizione = `${ws.name}, riga ${r}`;

        const vuota = [...colonne.values()].every((col) => testoCella(row.getCell(col)) === '');
        if (vuota) continue;

        const data = dataCella(cella(row, 'data'));
        if (!data) {
          lettura.errori.push(`${posizione}: data mancante o non valida`);
          continue;
        }

        const dipendente = testo(row, 'dipendente');
        if (!dipendente) {
          lettura.errori.push(`${posizione}: dipendente mancante`);
          continue;
        }

        const ore = {
          mi: oraCella(cella(row, 'mattinaInizio')),
          mf: oraCella(cella(row, 'mattinaFine')),
          pi: oraCella(cella(row, 'pomeriggioInizio')),
          pf: oraCella(cella(row, 'pomeriggioFine')),
        };
        if (Object.values(ore).includes('invalida')) {
          lettura.errori.push(`${posizione}: orario non leggibile`);
          continue;
        }
        const { mi, mf, pi, pf } = ore as Record<'mi' | 'mf' | 'pi' | 'pf', number | null>;

        let mattino = fascia(mi, mf);
        let pomeriggio = fascia(pi, pf);

        // Giornata senza pausa: inizio al mattino e fine al pomeriggio
        if (!mattino && !pomeriggio && mi !== null && pf !== null && mf === null && pi === null) {
          mattino = fascia(mi, pf);
        } else if ((mi !== null) !== (mf !== null) || (pi !== null) !== (pf !== null)) {
          lettura.avvisi.push(`${posizione}: fascia oraria incompleta, ignorata`);
        }

        if (!mattino && !pomeriggio) {
          lettura.errori.push(`${posizione}: nessuna fascia oraria valida`);
          continue;
        }

        lettura.righe.push({
          posizione,
          data,
          dipendente,
          cliente: testo(row, 'cliente'),
          tipo: testo(row, 'tipo'),
          mattino,
          pomeriggio,
          descrizione: testo(row, 'descrizione'),
          trasporto: testo(row, 'trasporto'),
          luogo: testo(row, 'luogo'),
        });
      }
    }

    if (lettura.fogli.length === 0 && lettura.errori.length === 0) {
      lettura.errori.push(
        'Nessun foglio riconosciuto: serve una riga di intestazione con DATA ed EFFETTUATO DA'
      );
    }

    return lettura;
  }

  // Raggruppa i valori di una colonna per chiave normalizzata
  private raggruppa(righe: RigaStorica[], campo: 'dipendente' | 'cliente' | 'tipo') {
    const gruppi = new Map<string, { conteggi: Map<string, number>; righe: number }>();
    for (const riga of righe) {
      const valore = riga[campo];
      const chiave = normalizza(valore);
      const g = gruppi.get(chiave) ?? { conteggi: new Map(), righe: 0 };
      g.righe++;
      if (valore) g.conteggi.set(valore, (g.conteggi.get(valore) ?? 0) + 1);
      gruppi.set(chiave, g);
    }

    return [...gruppi.entries()]
      .map(([chiave, g]) => {
        const varianti = [...g.conteggi.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
        return { chiave, nome: varianti[0] ?? '', varianti, righe: g.righe };
      })
      .sort((a, b) => b.righe - a.righe);
  }

  private async anagrafiche() {
    const [utenti, clienti, tipi] = await Promise.all([
      this.prisma.utente.findMany({
        select: { id: true, nome: true, cognome: true, attivo: true },
        orderBy: [{ nome: 'asc' }, { cognome: 'asc' }],
      }),
      this.prisma.cliente.findMany({
        select: { id: true, nome: true, attivo: true },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.tipoAttivita.findMany({
        select: { id: true, nome: true, attivo: true },
        orderBy: { nome: 'asc' },
      }),
    ]);
    return { utenti, clienti, tipi };
  }

  // Giorni in cui un dipendente ha già attività nel portale ("utenteId|YYYY-MM-DD"):
  // i vecchi lavori di quei giorni non si caricano, per non sovrapporli né sostituirli
  private async giorniPresenti(righe: { utenteId: number; data: string }[]): Promise<Set<string>> {
    const chiavi = new Set<string>();
    if (righe.length === 0) return chiavi;

    const date = righe.map((r) => r.data).sort();
    const trovate = await this.prisma.attivita.findMany({
      where: {
        utenteId: { in: [...new Set(righe.map((r) => r.utenteId))] },
        dataRiferimento: { gte: new Date(date[0]!), lte: new Date(date[date.length - 1]!) },
      },
      select: { utenteId: true, dataRiferimento: true },
    });

    for (const a of trovate) {
      chiavi.add(`${a.utenteId}|${a.dataRiferimento.toISOString().slice(0, 10)}`);
    }
    return chiavi;
  }

  async analizza(buffer: Buffer): Promise<Analisi> {
    const lettura = await this.leggi(buffer);
    const anagrafiche = await this.anagrafiche();

    const dipendenti: Voce[] = this.raggruppa(lettura.righe, 'dipendente').map((g) => {
      const u = migliore(
        g.chiave,
        anagrafiche.utenti,
        (u) => [u.nome, u.cognome, `${u.nome} ${u.cognome}`, `${u.cognome} ${u.nome}`],
        true
      );
      return { ...g, suggerimento: u ? { azione: 'esistente', id: u.id } : null };
    });

    const suggerisci = (
      gruppi: ReturnType<ImportStoricoService['raggruppa']>,
      elenco: { id: number; nome: string }[],
      gica = false
    ): Voce[] =>
      gruppi.map((g) => {
        // Le righe senza cliente sono lavori interni: vanno su GiCa
        if (!g.chiave) {
          if (!gica) return { ...g, suggerimento: { azione: 'nessuno' } };
          const e = elenco.find((e) => normalizza(e.nome) === 'gica');
          return { ...g, suggerimento: e ? { azione: 'esistente', id: e.id } : { azione: 'nuovo', nome: 'GiCa' } };
        }
        const e = migliore(g.chiave, elenco, (e) => [e.nome]);
        if (e) return { ...g, suggerimento: { azione: 'esistente', id: e.id } };
        // Simile a una voce più frequente dello stesso file ("Trasporto" e
        // "Trasporti"): stesso nome, così alla creazione diventano una sola
        const simile = gruppi.find(
          (a) => a.righe > g.righe && g.chiave.length >= 4 && levenshtein(a.chiave, g.chiave) <= 1
        );
        return { ...g, suggerimento: { azione: 'nuovo', nome: (simile ?? g).nome } };
      });

    // Quante righe cadono in giorni già presenti, con i dipendenti suggeriti
    const utentePer = new Map(
      dipendenti.flatMap((d) => (d.suggerimento?.azione === 'esistente' ? [[d.chiave, d.suggerimento.id]] : []))
    );
    const abbinate = lettura.righe.flatMap((r) => {
      const utenteId = utentePer.get(normalizza(r.dipendente));
      return utenteId ? [{ ...r, utenteId }] : [];
    });
    const giorni = await this.giorniPresenti(abbinate);
    const giaImportate = abbinate.filter((r) => giorni.has(`${r.utenteId}|${r.data}`)).length;

    const date = lettura.righe.map((r) => r.data).sort();

    return {
      fogli: lettura.fogli,
      righeValide: lettura.righe.length,
      periodo: date.length ? { da: date[0]!, a: date[date.length - 1]! } : null,
      giaImportate,
      errori: lettura.errori,
      avvisi: lettura.avvisi,
      dipendenti,
      clienti: suggerisci(this.raggruppa(lettura.righe, 'cliente'), anagrafiche.clienti, true),
      tipi: suggerisci(this.raggruppa(lettura.righe, 'tipo'), anagrafiche.tipi),
      anagrafiche,
    };
  }

  async importa(buffer: Buffer, mappatura: Mappatura, createdById: number): Promise<EsitoImport> {
    const lettura = await this.leggi(buffer);
    const anagrafiche = await this.anagrafiche();

    // Ogni valore del foglio deve avere una scelta valida
    const utentiIds = new Set(anagrafiche.utenti.map((u) => u.id));
    const clientiIds = new Set(anagrafiche.clienti.map((c) => c.id));
    const tipiIds = new Set(anagrafiche.tipi.map((t) => t.id));

    const verifica = (
      etichetta: string,
      campo: 'dipendente' | 'cliente' | 'tipo',
      scelte: Record<string, Scelta> | undefined,
      ids: Set<number>,
      ammesse: Scelta['azione'][]
    ) => {
      for (const g of this.raggruppa(lettura.righe, campo)) {
        const s = scelte?.[g.chiave];
        const nome = g.nome || '(vuoto)';
        if (!s || !ammesse.includes(s.azione)) {
          throw new Error(`Abbinamento mancante o non valido per ${etichetta} "${nome}"`);
        }
        if (s.azione === 'esistente' && !ids.has(s.id)) {
          throw new Error(`${etichetta} "${nome}": abbinato a una voce che non esiste più`);
        }
        if (s.azione === 'nuovo' && !pulisci(s.nome ?? '')) {
          throw new Error(`${etichetta} "${nome}": manca il nome della nuova voce`);
        }
      }
    };
    verifica('il dipendente', 'dipendente', mappatura.dipendenti, utentiIds, ['esistente', 'salta']);
    verifica('il cliente', 'cliente', mappatura.clienti, clientiIds, ['esistente', 'nuovo', 'nessuno', 'salta']);
    verifica('il tipo attività', 'tipo', mappatura.tipi, tipiIds, ['esistente', 'nuovo', 'nessuno', 'salta']);

    const esito: EsitoImport = {
      attivitaCreate: 0,
      duplicatiSaltati: 0,
      righeSaltate: 0,
      righeScartate: lettura.errori.length,
      clientiCreati: 0,
      tipiAttivitaCreati: 0,
      errori: lettura.errori,
      avvisi: lettura.avvisi,
    };

    const scelta = (scelte: Record<string, Scelta>, valore: string) => scelte[normalizza(valore)]!;

    // Righe da importare: fuori quelle con una scelta "salta"
    const daImportare = lettura.righe.flatMap((r) => {
      const d = scelta(mappatura.dipendenti, r.dipendente);
      const c = scelta(mappatura.clienti, r.cliente);
      const t = scelta(mappatura.tipi, r.tipo);
      if (d.azione !== 'esistente' || c.azione === 'salta' || t.azione === 'salta') {
        esito.righeSaltate++;
        return [];
      }
      return [{ ...r, utenteId: d.id, sceltaCliente: c, sceltaTipo: t }];
    });

    const giorni = await this.giorniPresenti(daImportare);

    await this.prisma.$transaction(
      async (tx) => {
        // Le voci nuove con lo stesso nome (a meno di maiuscole) diventano una sola
        const nuoviClienti = new Map<string, number>();
        const nuoviTipi = new Map<string, number>();

        const idCliente = async (s: Scelta): Promise<number | null> => {
          if (s.azione === 'esistente') return s.id;
          if (s.azione !== 'nuovo') return null;
          const nome = pulisci(s.nome);
          const chiave = normalizza(nome);
          let id = nuoviClienti.get(chiave);
          if (id === undefined) {
            const esiste = await tx.cliente.findFirst({
              where: { nome: { equals: nome, mode: 'insensitive' } },
            });
            if (esiste) {
              id = esiste.id;
            } else {
              id = (await tx.cliente.create({ data: { nome } })).id;
              esito.clientiCreati++;
            }
            nuoviClienti.set(chiave, id);
          }
          return id;
        };

        const idTipo = async (s: Scelta): Promise<number | null> => {
          if (s.azione === 'esistente') return s.id;
          if (s.azione !== 'nuovo') return null;
          const nome = pulisci(s.nome);
          const chiave = normalizza(nome);
          let id = nuoviTipi.get(chiave);
          if (id === undefined) {
            const esiste = await tx.tipoAttivita.findFirst({
              where: { nome: { equals: nome, mode: 'insensitive' } },
            });
            if (esiste) {
              id = esiste.id;
            } else {
              id = (await tx.tipoAttivita.create({ data: { nome } })).id;
              esito.tipiAttivitaCreati++;
            }
            nuoviTipi.set(chiave, id);
          }
          return id;
        };

        const dati: Prisma.AttivitaCreateManyInput[] = [];
        const nelFile = new Map<string, string>();
        for (const r of daImportare) {
          if (giorni.has(`${r.utenteId}|${r.data}`)) {
            esito.duplicatiSaltati++;
            continue;
          }
          const chiave = chiaveDuplicato(r.utenteId, r.data, r.mattino, r.pomeriggio);
          const doppione = nelFile.get(chiave);
          if (doppione) {
            esito.duplicatiSaltati++;
            esito.avvisi.push(`${r.posizione}: stessi dipendente, giorno e orari di ${doppione}, saltata`);
            continue;
          }
          nelFile.set(chiave, r.posizione.replace(/^.*, /, ''));

          const clienteId = await idCliente(r.sceltaCliente);
          const tipoAttivitaId = await idTipo(r.sceltaTipo);

          // Quello che non trova posto nei campi dell'attività finisce nelle note
          const note = [
            r.descrizione,
            r.trasporto && `Trasporto: ${r.trasporto}`,
            r.luogo && `Luogo montaggio: ${r.luogo}`,
            r.cliente && clienteId === null && `Cliente: ${r.cliente}`,
            r.tipo && tipoAttivitaId === null && `Attività svolta: ${r.tipo}`,
          ]
            .filter(Boolean)
            .join('\n');

          dati.push({
            utenteId: r.utenteId,
            dataRiferimento: new Date(r.data),
            oraInizioMattino: r.mattino?.inizio ?? null,
            oraFineMattino: r.mattino?.fine ?? null,
            oraInizioPomeriggio: r.pomeriggio?.inizio ?? null,
            oraFinePomeriggio: r.pomeriggio?.fine ?? null,
            durataMinuti: durata(r),
            clienteId,
            tipoAttivitaId,
            note: note || null,
            createdById,
          });
        }

        if (dati.length > 0) {
          esito.attivitaCreate = (await tx.attivita.createMany({ data: dati })).count;
        }
      },
      { timeout: 60000 }
    );

    return esito;
  }
}
