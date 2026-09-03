import ExcelJS from 'exceljs';

/**
 * Export del calendario eventi: un foglio per anno con una colonna per giorno,
 * pallini Wingdings sui giorni occupati e riga di totali in fondo.
 *
 * Tutte le date scritte nel foglio sono mezzanotte UTC: ExcelJS converte i
 * `Date` con `getTime()`, quindi una mezzanotte locale in Europe/Rome
 * finirebbe nel giorno precedente una volta aperta in Excel.
 */

const COLONNA_PRIMO_GIORNO = 5; // A nome, B dal, C al, D importo, E... giorni
const RIGA_MESI = 3;
const RIGA_GIORNI = 4;
const RIGA_PRIMO_EVENTO = 5;

const BLU = 'FF0070C0';
const ROSSO = 'FFFF0000';
const ROSA_HEADER = 'FFD99694';
const ROSA_CORPO = 'FFF2DCDB';
const BIANCO = 'FFFFFFFF';
const NERO = 'FF000000';
const VERDE = 'FF008000';

const MESI = [
  'GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
  'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE',
];

const FONT = 'Calibri';
const BORDO_HAIR = {
  top: { style: 'hair' as const },
  left: { style: 'hair' as const },
  bottom: { style: 'hair' as const },
  right: { style: 'hair' as const },
};

export type Pallino = 'consegna' | 'evento' | 'smontaggio';

const COLORE_PALLINO: Record<Pallino, string> = {
  consegna: ROSSO,
  evento: NERO,
  smontaggio: VERDE,
};

// Nella stessa cella possono cadere piu' tipi: l'ordine e' sempre questo,
// cosi' due celle con gli stessi pallini si leggono allo stesso modo
const ORDINE_PALLINI: Pallino[] = ['consegna', 'evento', 'smontaggio'];

export interface EventoExport {
  id: number;
  nome: string | null;
  dataInizio: Date;
  dataFine: Date;
  dataConsegna: Date | null;
  dataSmontaggio: Date | null;
  importo: number | null;
  cliente: { nome: string };
}

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

function iso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function piuGiorni(data: Date, giorni: number): Date {
  return new Date(data.getTime() + giorni * 86_400_000);
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
    iso(new Date(Date.UTC(anno, mese - 1, giorno)))
  );

  const domenicaPasqua = pasqua(anno);
  giorni.push(
    iso(piuGiorni(domenicaPasqua, 1)),  // Lunedi' dell'Angelo
    iso(piuGiorni(domenicaPasqua, 39)), // Ascensione
    iso(piuGiorni(domenicaPasqua, 50)), // Lunedi' di Pentecoste
    iso(piuGiorni(domenicaPasqua, 60))  // Corpus Domini
  );

  return new Set(giorni);
}

export interface GiornoAnno {
  iso: string;
  data: Date;
  /** Colonna del foglio, E = 5 per il 1 gennaio. */
  col: number;
  /** Indice del mese, 0 = gennaio. */
  mese: number;
  weekend: boolean;
  festivo: boolean;
}

/** Tutti i giorni dell'anno, 365 o 366 a seconda del bisestile. */
export function giorniAnno(anno: number): GiornoAnno[] {
  const festivi = festiviTicino(anno);
  const giorni: GiornoAnno[] = [];

  let cursore = new Date(Date.UTC(anno, 0, 1));
  while (cursore.getUTCFullYear() === anno) {
    const giornoSettimana = cursore.getUTCDay();
    const chiave = iso(cursore);

    giorni.push({
      iso: chiave,
      data: cursore,
      col: COLONNA_PRIMO_GIORNO + giorni.length,
      mese: cursore.getUTCMonth(),
      weekend: giornoSettimana === 0 || giornoSettimana === 6,
      festivo: festivi.has(chiave),
    });

    cursore = piuGiorni(cursore, 1);
  }

  return giorni;
}

/**
 * Il pallino e' il carattere 'l' reso con Wingdings; il tipo si distingue solo
 * dal colore del font, quindi ogni tipo e' un run separato del rich text.
 */
export function cellaPallini(tipi: Set<Pallino>): ExcelJS.CellRichTextValue {
  return {
    richText: ORDINE_PALLINI.filter((tipo) => tipi.has(tipo)).map((tipo) => ({
      text: 'l',
      font: { name: 'Wingdings', size: 9, color: { argb: COLORE_PALLINO[tipo] } },
    })),
  };
}

function fill(argb: string): ExcelJS.FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** Indice di colonna 1-based nella notazione Excel (1 = A, 27 = AA). */
function lettera(col: number): string {
  let n = col;
  let out = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    out = String.fromCharCode(65 + resto) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function nomeEvento(evento: EventoExport): string {
  return evento.nome?.trim() || evento.cliente.nome;
}

function legenda(): ExcelJS.CellRichTextValue {
  const voci: [Pallino, string][] = [
    ['evento', ' giorni evento    '],
    ['consegna', ' consegna    '],
    ['smontaggio', ' smontaggio'],
  ];

  return {
    richText: voci.flatMap(([tipo, etichetta]) => [
      {
        text: 'l',
        font: { name: 'Wingdings', size: 9, color: { argb: COLORE_PALLINO[tipo] } },
      },
      {
        text: etichetta,
        font: { name: FONT, size: 9, color: { argb: NERO } },
      },
    ]),
  };
}

export class CalendarioEventiExportService {
  async generaExcel(anno: number, eventi: EventoExport[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(`Eventi ${anno}`, {
      views: [
        {
          state: 'frozen',
          xSplit: COLONNA_PRIMO_GIORNO - 1,
          ySplit: RIGA_PRIMO_EVENTO - 1,
          showGridLines: false,
          zoomScale: 90,
        },
      ],
    });

    const giorni = giorniAnno(anno);
    const ultimaColonna = COLONNA_PRIMO_GIORNO + giorni.length - 1;

    ws.getColumn(1).width = 22.86;
    ws.getColumn(2).width = 11.14;
    ws.getColumn(3).width = 10.71;
    ws.getColumn(4).width = 10.43;
    for (let col = COLONNA_PRIMO_GIORNO; col <= ultimaColonna; col++) {
      ws.getColumn(col).width = 3.14;
    }

    // Legenda dei colori, sopra la griglia
    ws.getCell(1, 1).value = legenda();

    this.scriviIntestazioni(ws, anno, giorni, ultimaColonna);
    const righeEvento = this.scriviEventi(ws, anno, giorni, eventi);
    this.scriviTotali(ws, giorni, righeEvento);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private scriviIntestazioni(
    ws: ExcelJS.Worksheet,
    anno: number,
    giorni: GiornoAnno[],
    ultimaColonna: number
  ): void {
    const righeMesi = ws.getRow(RIGA_MESI);
    righeMesi.height = 28.5;

    ws.mergeCells(RIGA_MESI, 1, RIGA_GIORNI, 1);
    ws.mergeCells(RIGA_MESI, 2, RIGA_MESI, 3);

    const titolo = ws.getCell(RIGA_MESI, 1);
    titolo.value = 'Evento';
    const anniCella = ws.getCell(RIGA_MESI, 2);
    anniCella.value = String(anno);

    for (const cella of [titolo, anniCella]) {
      cella.font = { name: FONT, size: 9, bold: true, color: { argb: BIANCO } };
      cella.fill = fill(BLU);
      cella.alignment = { horizontal: 'center', vertical: 'middle' };
      cella.numFmt = '@';
    }

    // Un merge per mese: i giorni sono contigui, bastano primo e ultimo indice
    for (let mese = 0; mese < 12; mese++) {
      const delMese = giorni.filter((g) => g.mese === mese);
      const primo = delMese[0]!;
      const ultimo = delMese[delMese.length - 1]!;

      ws.mergeCells(RIGA_MESI, primo.col, RIGA_MESI, ultimo.col);
      const cella = ws.getCell(RIGA_MESI, primo.col);
      cella.value = MESI[mese] as string;
      cella.font = { name: FONT, size: 9, bold: true, color: { argb: BIANCO } };
      cella.fill = fill(BLU);
      cella.alignment = { horizontal: 'center', vertical: 'middle' };
      cella.numFmt = '@';
    }

    for (let col = 1; col <= ultimaColonna; col++) {
      ws.getCell(RIGA_MESI, col).border = BORDO_HAIR;
    }

    const rigaGiorni = ws.getRow(RIGA_GIORNI);
    rigaGiorni.height = 44.25;

    const etichette = ['', 'dal', 'al', 'Importo'];
    for (let col = 2; col <= 4; col++) {
      const cella = ws.getCell(RIGA_GIORNI, col);
      cella.value = etichette[col - 1] as string;
      cella.font = { name: FONT, size: 9, bold: true, color: { argb: BIANCO } };
      cella.fill = fill(BLU);
      cella.alignment = { horizontal: 'center', vertical: 'middle' };
      cella.numFmt = '@';
      cella.border = BORDO_HAIR;
    }

    for (const giorno of giorni) {
      const cella = ws.getCell(RIGA_GIORNI, giorno.col);
      cella.value = giorno.data;
      cella.numFmt = 'dd/mm/yy;@';
      cella.font = { name: FONT, size: 9, color: { argb: BIANCO } };
      // Un festivo che cade di sabato resta rosso: la festivita' prevale
      cella.fill = fill(giorno.festivo ? ROSSO : giorno.weekend ? ROSA_HEADER : BLU);
      cella.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        textRotation: 90,
      };
      cella.border = BORDO_HAIR;
    }
  }

  /** Scrive una riga per evento e restituisce il numero di righe scritte. */
  private scriviEventi(
    ws: ExcelJS.Worksheet,
    anno: number,
    giorni: GiornoAnno[],
    eventi: EventoExport[]
  ): number {
    const primoGiornoAnno = new Date(Date.UTC(anno, 0, 1));
    const ultimoGiornoAnno = new Date(Date.UTC(anno, 11, 31));

    eventi.forEach((evento, indice) => {
      const numeroRiga = RIGA_PRIMO_EVENTO + indice;
      const riga = ws.getRow(numeroRiga);
      riga.height = 18.75;

      const cellaNome = ws.getCell(numeroRiga, 1);
      cellaNome.value = nomeEvento(evento);
      cellaNome.font = { name: FONT, size: 9 };
      cellaNome.alignment = { vertical: 'middle' };

      // B e C mostrano sempre le date reali, anche quando cadono fuori
      // dall'anno del foglio: e' l'unico modo per leggere la durata vera
      for (const [col, data] of [
        [2, evento.dataInizio],
        [3, evento.dataFine],
      ] as [number, Date][]) {
        const cella = ws.getCell(numeroRiga, col);
        cella.value = data;
        cella.numFmt = 'dd/mm/yyyy;@';
        cella.font = { name: FONT, size: 9 };
        cella.alignment = { horizontal: 'center', vertical: 'middle' };
      }

      const cellaImporto = ws.getCell(numeroRiga, 4);
      // Un importo mancante resta vuoto: uno zero falserebbe il totale a vista
      if (evento.importo !== null) {
        cellaImporto.value = evento.importo;
        cellaImporto.numFmt = '#,##0';
      }
      cellaImporto.font = { name: FONT, size: 9 };
      cellaImporto.alignment = { horizontal: 'right', vertical: 'middle' };

      for (let col = 1; col <= 4; col++) {
        ws.getCell(numeroRiga, col).border = BORDO_HAIR;
      }

      const pallini = this.palliniEvento(evento, primoGiornoAnno, ultimoGiornoAnno);

      for (const giorno of giorni) {
        const cella = ws.getCell(numeroRiga, giorno.col);
        const tipi = pallini.get(giorno.iso);
        if (tipi) cella.value = cellaPallini(tipi);

        cella.fill = fill(
          giorno.festivo ? ROSSO : giorno.weekend ? ROSA_CORPO : BIANCO
        );
        cella.alignment = { horizontal: 'center', vertical: 'middle' };
        cella.border = BORDO_HAIR;
      }
    });

    return eventi.length;
  }

  /**
   * Mappa giorno -> pallini da disegnare, limitata all'anno del foglio.
   * L'iterazione somma 86.400.000 ms: e' esatta perche' le date sono UTC e
   * quindi non incontrano cambi di ora legale.
   */
  private palliniEvento(
    evento: EventoExport,
    primoGiornoAnno: Date,
    ultimoGiornoAnno: Date
  ): Map<string, Set<Pallino>> {
    const mappa = new Map<string, Set<Pallino>>();

    const aggiungi = (data: Date, tipo: Pallino) => {
      if (data < primoGiornoAnno || data > ultimoGiornoAnno) return;
      const chiave = iso(data);
      const esistenti = mappa.get(chiave);
      if (esistenti) esistenti.add(tipo);
      else mappa.set(chiave, new Set([tipo]));
    };

    const da = evento.dataInizio < primoGiornoAnno ? primoGiornoAnno : evento.dataInizio;
    const a = evento.dataFine > ultimoGiornoAnno ? ultimoGiornoAnno : evento.dataFine;

    for (let g = da; g <= a; g = piuGiorni(g, 1)) {
      aggiungi(g, 'evento');
    }

    if (evento.dataConsegna) aggiungi(evento.dataConsegna, 'consegna');
    if (evento.dataSmontaggio) aggiungi(evento.dataSmontaggio, 'smontaggio');

    return mappa;
  }

  private scriviTotali(
    ws: ExcelJS.Worksheet,
    giorni: GiornoAnno[],
    righeEvento: number
  ): void {
    const numeroRiga = RIGA_PRIMO_EVENTO + righeEvento;
    const riga = ws.getRow(numeroRiga);
    riga.height = 18.75;

    const cellaTitolo = ws.getCell(numeroRiga, 1);
    cellaTitolo.value = 'TOTALE';
    cellaTitolo.font = { name: FONT, size: 9, bold: true };
    cellaTitolo.alignment = { vertical: 'middle' };

    const ultimaRigaEvento = numeroRiga - 1;
    // Senza eventi non c'e' un intervallo da sommare: le formule sarebbero
    // riferimenti all'indietro e Excel le segnerebbe come errore
    const conEventi = righeEvento > 0;

    const cellaImporto = ws.getCell(numeroRiga, 4);
    if (conEventi) {
      cellaImporto.value = {
        formula: `SUM(D${RIGA_PRIMO_EVENTO}:D${ultimaRigaEvento})`,
      };
    }
    cellaImporto.numFmt = '#,##0';
    cellaImporto.font = { name: FONT, size: 9, bold: true };
    cellaImporto.alignment = { horizontal: 'right', vertical: 'middle' };

    for (let col = 1; col <= 4; col++) {
      ws.getCell(numeroRiga, col).border = BORDO_HAIR;
    }

    for (const giorno of giorni) {
      const cella = ws.getCell(numeroRiga, giorno.col);
      if (conEventi) {
        const col = lettera(giorno.col);
        cella.value = {
          formula: `COUNTA(${col}${RIGA_PRIMO_EVENTO}:${col}${ultimaRigaEvento})`,
        };
      }
      cella.font = { name: FONT, size: 9, bold: true };
      cella.alignment = { horizontal: 'center', vertical: 'middle' };
      cella.border = BORDO_HAIR;
    }
  }
}
