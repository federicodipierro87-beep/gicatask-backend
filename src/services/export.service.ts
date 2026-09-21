import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import {
  MAX_GIORNI_SEGNAPOSTO,
  giorniPeriodo,
  giornoNonLavorativo,
  isoUtc,
} from '../utils/festivita.js';
import { nomeUtente } from '../utils/nomeUtente.js';

interface AttivitaExport {
  id: number;
  dataRiferimento: Date;
  oraInizioMattino?: string | null;
  oraFineMattino?: string | null;
  oraInizioPomeriggio?: string | null;
  oraFinePomeriggio?: string | null;
  durataMinuti: number;
  note?: string | null;
  cliente: { nome: string } | null;
  cantiere: { nome: string } | null;
  tipoAttivita: { nome: string } | null;
  assenza: { nome: string } | null;
  utente: { nome: string; cognome: string };
}

function formatTimeSlot(start?: string | null, end?: string | null): string {
  if (start && end) {
    return end < start ? `${start}-${end} (+1)` : `${start}-${end}`;
  }
  return '-';
}

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  clienteNome?: string;
  /**
   * Il report e' filtrato su almeno una persona e su nessun cliente o
   * cantiere. E' la condizione che abilita i giorni segnaposto: con un cliente
   * selezionato una riga vuota del 12 marzo sembrerebbe dire "non ha
   * lavorato", mentre direbbe solo "non ha lavorato per quel cliente".
   *
   * Basta "almeno una" perche' ogni gruppo e' per costruzione di un dipendente
   * solo: il vincolo su cliente e cantiere resta intatto.
   */
  soloDipendente?: boolean;
}

/**
 * Una sezione del report: il PDF ne stampa una per pagina e l'Excel una per
 * foglio. Con un gruppo solo il documento e' identico a quello di prima.
 */
export interface GruppoReport {
  /** `undefined` sul report unico non filtrato su una persona. */
  utenteNome?: string;
  attivita: AttivitaExport[];
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('it-IT');
}

// Il segno va davanti alla stringa intera: un Recupero ore vale -492 minuti e
// scomporlo con Math.floor produrrebbe "-9h -12m"
function formatDuration(minutes: number): string {
  const segno = minutes < 0 ? '-' : '';
  const assoluti = Math.abs(minutes);
  const hours = Math.floor(assoluti / 60);
  const mins = assoluti % 60;
  if (hours === 0) return `${segno}${mins}m`;
  if (mins === 0) return `${segno}${hours}h`;
  return `${segno}${hours}h ${mins}m`;
}

// Ore in decimali, sempre con due cifre: e' il formato della colonna
// "Durata (ore)" in entrambi gli export, cosi' la colonna resta incolonnata e
// il totale in fondo si legge come la somma delle righe sopra
function oreDecimali(minutes: number): number {
  return parseFloat((minutes / 60).toFixed(2));
}

function formatOreDecimali(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

// An activity can have the afternoon slot only, and an absence has no slot at all
function orarioInizio(att: AttivitaExport): string {
  return att.oraInizioMattino || att.oraInizioPomeriggio || '';
}

/**
 * Order the rows for the Excel report: day by day (oldest first) and, inside
 * each day, grouped by employee and ordered by start time.
 *
 * The employee is sorted on "Cognome Nome", the same string shown in the
 * column, so the order is evident to whoever reads the sheet.
 */
function sortForReport(attivita: AttivitaExport[]): AttivitaExport[] {
  return [...attivita].sort((a, b) => {
    const dataA = new Date(a.dataRiferimento).getTime();
    const dataB = new Date(b.dataRiferimento).getTime();
    if (dataA !== dataB) return dataA - dataB;

    const byUtente = nomeUtente(a.utente).localeCompare(nomeUtente(b.utente), 'it');
    if (byUtente !== 0) return byUtente;

    return orarioInizio(a).localeCompare(orarioInizio(b));
  });
}

/**
 * Una riga della tabella del report, o un'attivita' o un giorno senza nulla
 * registrato.
 *
 * `grigia` dipende solo dal giorno, non dal contenuto: la riga di un sabato
 * lavorato resta grigia. Weekend e festivo collassano qui in un booleano solo,
 * perche' nessuna colonna li distingue.
 */
interface RigaReport {
  grigia: boolean;
  /** Mezzanotte UTC, come la `dataRiferimento` che arriva da Prisma. */
  data: Date;
  /** Sulle righe vuote e' il dipendente del filtro. */
  utenteNome: string;
  att: AttivitaExport | null;
}

/**
 * I giorni del periodo in cui il dipendente della sezione non ha registrato
 * nulla, cosi' il mese si legge intero senza salti.
 *
 * Vuoti se manca anche solo una delle condizioni: `utenteNome` del gruppo e'
 * insieme il segnale che un dipendente e' selezionato e il dato che riempie la
 * colonna Dipendente delle righe vuote.
 */
function giorniSenzaAttivita(
  gruppo: GruppoReport,
  filters: ReportFilters
): RigaReport[] {
  const { startDate, endDate, soloDipendente } = filters;
  const { utenteNome, attivita } = gruppo;
  if (!utenteNome || !soloDipendente || !startDate || !endDate) return [];

  // `dataRiferimento` e' @db.Date e Prisma la rilegge a mezzanotte UTC, quindi
  // qui `toISOString().slice(0, 10)` e' la chiave giorno esatta. Il divieto di
  // `toISOString` della Nota 8 riguarda le date costruite da componenti
  // *locali*, che non e' questo caso: non va "corretto".
  const conAttivita = new Set(
    attivita.map((att) => isoUtc(new Date(att.dataRiferimento)))
  );

  return giorniPeriodo(startDate, endDate, MAX_GIORNI_SEGNAPOSTO)
    .filter((giorno) => !conAttivita.has(giorno))
    .map((giorno) => ({
      grigia: giornoNonLavorativo(giorno),
      // Stessa specie di `Date` delle righe piene, cosi' le due passano dalla
      // stessa formatDate e non divergono su un server con offset negativo
      data: new Date(`${giorno}T00:00:00.000Z`),
      utenteNome,
      att: null,
    }));
}

/** Le righe della tabella, attivita' e giorni vuoti, in ordine di data. */
function righeReport(
  gruppo: GruppoReport,
  filters: ReportFilters
): RigaReport[] {
  const piene: RigaReport[] = sortForReport(gruppo.attivita).map((att) => {
    const data = new Date(att.dataRiferimento);
    return {
      grigia: giornoNonLavorativo(isoUtc(data)),
      data,
      utenteNome: nomeUtente(att.utente),
      att,
    };
  });

  const vuote = giorniSenzaAttivita(gruppo, filters);
  if (vuote.length === 0) return piene;

  // Le due liste sono gia' ordinate per data e disgiunte per data (un giorno
  // segnaposto e' per definizione senza attivita'), quindi si fondono in
  // lineare: nessun riordino dopo la fusione, cosi' l'ordine interno al giorno
  // prodotto da sortForReport resta intatto
  const fuse: RigaReport[] = [];
  let i = 0;
  let j = 0;

  while (i < piene.length && j < vuote.length) {
    fuse.push(
      (piene[i] as RigaReport).data <= (vuote[j] as RigaReport).data
        ? (piene[i++] as RigaReport)
        : (vuote[j++] as RigaReport)
    );
  }
  while (i < piene.length) fuse.push(piene[i++] as RigaReport);
  while (j < vuote.length) fuse.push(vuote[j++] as RigaReport);

  return fuse;
}

/**
 * PDF layout. The report is printed by the customer on A3 landscape, so the
 * page is 1191x842pt and the table can use 1141pt of width.
 */
const PDF_MARGIN = 25;
const PDF_PAGE_HEIGHT = 842;
const PDF_BOTTOM = PDF_PAGE_HEIGHT - PDF_MARGIN;

const CELL_PAD_X = 3;
const CELL_PAD_Y = 3;
const HEADER_HEIGHT = 16;
const MIN_ROW_HEIGHT = 14;

const BODY_FONT_SIZE = 8;
const HEADER_FONT_SIZE = 8;

const GRID_COLOR = '#999999';
const GRID_LINE_WIDTH = 0.5;

// Weekend e festivi. Da tenere allineato all'ARGB di XLS_GRIGIO_FESTIVO: i due
// export vanno letti uno accanto all'altro.
// Non e' lo zebra striping di prima, che e' stato tolto: alternare il grigio
// riga su riga renderebbe grigio un martedi' su due e il colore smetterebbe di
// voler dire "giorno non lavorativo"
const PDF_GRIGIO_FESTIVO = '#ededed';
const XLS_GRIGIO_FESTIVO = 'FFEDEDED';

interface PdfColumn {
  header: string;
  width: number;
  value: (riga: RigaReport) => string;
}

// The widths add up to 1141: A3 landscape width minus the two margins
const PDF_COLUMNS: PdfColumn[] = [
  { header: 'Data', width: 62, value: (r) => formatDate(r.data) },
  { header: 'Dipendente', width: 130, value: (r) => r.utenteNome },
  { header: 'Cliente', width: 150, value: (r) => r.att?.cliente?.nome ?? '' },
  { header: 'Cantiere', width: 140, value: (r) => r.att?.cantiere?.nome ?? '' },
  { header: 'Tipo', width: 120, value: (r) => r.att?.tipoAttivita?.nome ?? '' },
  { header: 'Assenza', width: 100, value: (r) => r.att?.assenza?.nome ?? '' },
  // 229 e non 234: i 5pt in meno sono andati a "Durata (ore)", la cui
  // intestazione e' piu' lunga della "Durata" di prima.
  // Il ramo esplicito sul giorno vuoto serve: il trattino significa "attivita'
  // senza note", non "giorno senza attivita'"
  { header: 'Note', width: 229, value: (r) => (r.att ? r.att.note || '-' : '') },
  {
    header: 'Mattino',
    width: 75,
    value: (r) =>
      r.att ? formatTimeSlot(r.att.oraInizioMattino, r.att.oraFineMattino) : '',
  },
  {
    header: 'Pomeriggio',
    width: 75,
    value: (r) =>
      r.att ? formatTimeSlot(r.att.oraInizioPomeriggio, r.att.oraFinePomeriggio) : '',
  },
  // 60 e non 55: l'intestazione misura 45pt a 8pt grassetto e nella larghezza
  // di prima le restavano meno di 4pt di margine, troppo pochi per non
  // rischiare che vada a capo e sfondi l'altezza fissa della testata
  { header: 'Durata (ore)', width: 60, value: (r) => (r.att ? formatOreDecimali(r.att.durataMinuti) : '') },
];

// La riga dei totali porta l'etichetta nella prima colonna e la somma sotto
// l'ultima, dove stanno i valori che somma
const PDF_COLONNA_TOTALE = PDF_COLUMNS.length - 1;

const TABLE_WIDTH = PDF_COLUMNS.reduce((sum, col) => sum + col.width, 0);

// Hard bound on a single row: a cell taller than a whole page would never fit
// after a page break, and the break check would loop forever
const MAX_ROW_HEIGHT = PDF_BOTTOM - PDF_MARGIN - HEADER_HEIGHT;

// Explicit borders and not `pageSetup.showGridLines`: the sheet gridlines are
// an on/off switch for the whole used range, title row included
const GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF999999' } },
  left: { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  right: { style: 'thin', color: { argb: 'FF999999' } },
};

function applyGrid(row: ExcelJS.Row, columnCount: number, sfondo?: string): void {
  for (let i = 1; i <= columnCount; i++) {
    const cell = row.getCell(i);
    cell.border = GRID_BORDER;
    // Cella per cella e non `row.fill`: il ciclo esiste gia' e non lascia
    // dubbi su quali celle vengono colorate
    if (sfondo) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sfondo } };
    }
  }
}

const NOTE_PAROLE_PER_RIGA = 8;

// Break long notes every few words, so they stay readable inside the cell
function wrapNote(note?: string | null): string {
  if (!note) return '';

  const parole = note.trim().split(/\s+/);
  const righe: string[] = [];

  for (let i = 0; i < parole.length; i += NOTE_PAROLE_PER_RIGA) {
    righe.push(parole.slice(i, i + NOTE_PAROLE_PER_RIGA).join(' '));
  }

  return righe.join('\n');
}

/**
 * Titolo, riga dei filtri, riepilogo e tabella di un gruppo, a partire dalla
 * pagina corrente. Non crea ne' chiude il documento: e' il chiamante a
 * decidere dove comincia la sezione, come in `bollettinoPdf.service.ts`.
 */
function renderSezione(
  doc: PDFKit.PDFDocument,
  gruppo: GruppoReport,
  filters: ReportFilters
): void {
  // One rectangle per cell: the vertical separators stay visible even on
  // the rows where a cell is empty
  const drawGrid = (y: number, height: number): void => {
    doc.lineWidth(GRID_LINE_WIDTH).strokeColor(GRID_COLOR);

    let x = PDF_MARGIN;
    PDF_COLUMNS.forEach((col) => {
      doc.rect(x, y, col.width, height).stroke();
      x += col.width;
    });
  };

  // Leaves the body style active, so the caller can go straight back to
  // measuring and drawing rows
  const drawTableHeader = (y: number): number => {
    doc.rect(PDF_MARGIN, y, TABLE_WIDTH, HEADER_HEIGHT).fill('#333333');
    doc.font('Helvetica-Bold').fontSize(HEADER_FONT_SIZE).fillColor('#ffffff');

    let x = PDF_MARGIN;
    PDF_COLUMNS.forEach((col) => {
      doc.text(col.header, x + CELL_PAD_X, y + CELL_PAD_Y + 1, {
        width: col.width - CELL_PAD_X * 2,
        height: HEADER_HEIGHT - CELL_PAD_Y,
      });
      x += col.width;
    });

    drawGrid(y, HEADER_HEIGHT);
    doc.font('Helvetica').fontSize(BODY_FONT_SIZE).fillColor('#000000');

    return y + HEADER_HEIGHT;
  };

  // Title
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000');
  doc.text('Report Attività', PDF_MARGIN, PDF_MARGIN, { width: TABLE_WIDTH, align: 'center' });

  // Filters info. Il dipendente e' quello del gruppo, quindi ogni sezione si
  // identifica da sola senza un'intestazione in piu'
  doc.font('Helvetica').fontSize(9).fillColor('#666666');
  const filterParts: string[] = [];
  if (filters.startDate) filterParts.push(`Dal: ${filters.startDate}`);
  if (filters.endDate) filterParts.push(`Al: ${filters.endDate}`);
  if (filters.clienteNome) filterParts.push(`Cliente: ${filters.clienteNome}`);
  if (gruppo.utenteNome) filterParts.push(`Dipendente: ${gruppo.utenteNome}`);
  if (filterParts.length > 0) {
    doc.text(filterParts.join(' | '), { width: TABLE_WIDTH, align: 'center' });
  }

  // Summary
  const totalMinutes = gruppo.attivita.reduce((sum, a) => sum + a.durataMinuti, 0);
  const totalHours = formatOreDecimali(totalMinutes);
  doc.fontSize(10).fillColor('#000000');
  doc.text(`Totale: ${gruppo.attivita.length} attività - ${totalHours} ore`, {
    width: TABLE_WIDTH,
    align: 'center',
  });
  doc.moveDown(0.5);

  // Table. Same columns and same order as the Excel sheet
  let y = drawTableHeader(doc.y);

  righeReport(gruppo, filters).forEach((riga) => {
    const cells = PDF_COLUMNS.map((col) => ({ col, text: col.value(riga) }));

    // Text wraps inside the cell, so the row is as tall as its tallest cell
    const contentHeight = cells.reduce(
      (max, { col, text }) =>
        Math.max(max, doc.heightOfString(text, { width: col.width - CELL_PAD_X * 2 })),
      0
    );
    const rowHeight = Math.min(
      Math.max(contentHeight + CELL_PAD_Y * 2, MIN_ROW_HEIGHT),
      MAX_ROW_HEIGHT
    );

    if (y + rowHeight > PDF_BOTTOM) {
      doc.addPage();
      y = drawTableHeader(PDF_MARGIN);
    }

    // Dopo il controllo di salto pagina, che riassegna `y`. I feriali non
    // si dipingono di bianco: la pagina e' gia' bianca e un rect coprirebbe
    // meta' del bordo inferiore della riga sopra
    if (riga.grigia) {
      doc.rect(PDF_MARGIN, y, TABLE_WIDTH, rowHeight).fill(PDF_GRIGIO_FESTIVO);
    }

    // Fuori dall'if: `fill()` sporca il fillColor corrente, quindi dentro
    // il ramo grigio tutte le righe dopo una grigia uscirebbero col testo
    // grigio
    doc.fillColor('#000000');
    let x = PDF_MARGIN;
    cells.forEach(({ col, text }) => {
      // height keeps the cell inside its own row: a row clamped to
      // MAX_ROW_HEIGHT would otherwise spill over the ones below.
      // No `ellipsis`: pdfkit appends it whenever the *next* line would not
      // fit, so with a height set every cell would end in "…"
      doc.text(text, x + CELL_PAD_X, y + CELL_PAD_Y, {
        width: col.width - CELL_PAD_X * 2,
        height: rowHeight - CELL_PAD_Y,
      });
      x += col.width;
    });

    drawGrid(y, rowHeight);
    y += rowHeight;
  });

  // Riga totali. Se non entra nella pagina corrente ne apre una nuova con
  // l'intestazione ripetuta, come per le righe normali
  if (y + MIN_ROW_HEIGHT > PDF_BOTTOM) {
    doc.addPage();
    y = drawTableHeader(PDF_MARGIN);
  }

  doc.font('Helvetica-Bold').fillColor('#000000');
  let xTotali = PDF_MARGIN;
  PDF_COLUMNS.forEach((col, index) => {
    const testo =
      index === 0 ? 'TOTALE' : index === PDF_COLONNA_TOTALE ? totalHours : '';

    if (testo) {
      doc.text(testo, xTotali + CELL_PAD_X, y + CELL_PAD_Y, {
        width: col.width - CELL_PAD_X * 2,
        height: MIN_ROW_HEIGHT - CELL_PAD_Y,
      });
    }
    xTotali += col.width;
  });

  drawGrid(y, MIN_ROW_HEIGHT);
  doc.font('Helvetica');
}

// Excel vieta `: \ / ? * [ ]` nel nome di un foglio, lo tronca a 31 caratteri
// e non ammette duplicati: un nome non ripulito fa aprire il file come
// danneggiato
const XLS_MAX_NOME_FOGLIO = 31;

function nomeFoglio(testo: string, usati: Set<string>): string {
  const pulito =
    testo.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, XLS_MAX_NOME_FOGLIO) || 'Attività';

  let nome = pulito;
  let progressivo = 2;
  while (usati.has(nome)) {
    const suffisso = ` (${progressivo++})`;
    nome = pulito.slice(0, XLS_MAX_NOME_FOGLIO - suffisso.length) + suffisso;
  }

  usati.add(nome);
  return nome;
}

/** Intestazione, righe e riga TOTALE del foglio di un gruppo. */
function scriviFoglioAttivita(
  worksheet: ExcelJS.Worksheet,
  gruppo: GruppoReport,
  filters: ReportFilters
): void {
  // Title. The period is carried by the file name, not by a row here
  worksheet.mergeCells('A1:J1');
  worksheet.getCell('A1').value = "REPORT ATTIVITA'";
  worksheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FFFF0000' } };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  // Column headers
  const headerRow = worksheet.addRow([
    'Data',
    'Dipendente',
    'Cliente',
    'Cantiere',
    'Tipo Attività',
    'Assenza',
    'Note',
    'Mattino',
    'Pomeriggio',
    'Durata (ore)',
  ]);

  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF333333' },
  };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  applyGrid(headerRow, 10);

  // Set column widths
  worksheet.columns = [
    { width: 12 },  // Data
    { width: 20 },  // Dipendente
    { width: 20 },  // Cliente
    { width: 20 },  // Cantiere
    { width: 20 },  // Tipo Attività
    { width: 18 },  // Assenza
    // Wide enough to hold the eight words per line of wrapNote(): with a
    // narrower column Excel would wrap on the width and ignore the breaks
    { width: 60 },  // Note
    { width: 12 },  // Mattino
    { width: 12 },  // Pomeriggio
    { width: 12 },  // Durata (ore)
  ];

  // Data rows, grouped by employee and ordered by date and start time
  righeReport(gruppo, filters).forEach((riga) => {
    const att = riga.att;
    const row = worksheet.addRow([
      formatDate(riga.data),
      riga.utenteNome,
      att?.cliente?.nome ?? '',
      att?.cantiere?.nome ?? '',
      att?.tipoAttivita?.nome ?? '',
      att?.assenza?.nome ?? '',
      att ? wrapNote(att.note) : '',
      att ? formatTimeSlot(att.oraInizioMattino, att.oraFineMattino) : '',
      att ? formatTimeSlot(att.oraInizioPomeriggio, att.oraFinePomeriggio) : '',
      // `null` e non `0`: uno zero si sommerebbe a vista con le durate vere.
      // La cella viene creata lo stesso, quindi resta grigia e bordata
      att ? oreDecimali(att.durataMinuti) : null,
    ]);

    // Without wrapText Excel shows the line breaks as a single long line
    row.getCell(7).alignment = { wrapText: true, vertical: 'top' };
    // Il valore e' un numero: senza formato Excel mostrerebbe 1,5 invece di 1,50
    row.getCell(10).numFmt = '0.00';
    applyGrid(row, 10, riga.grigia ? XLS_GRIGIO_FESTIVO : undefined);
  });

  // Riga totali in fondo alla tabella
  const totaleMinuti = gruppo.attivita.reduce((sum, att) => sum + att.durataMinuti, 0);
  const totaliRow = worksheet.addRow(['TOTALE', '', '', '', '', '', '', '', '', oreDecimali(totaleMinuti)]);
  totaliRow.font = { bold: true };
  totaliRow.getCell(10).numFmt = '0.00';
  applyGrid(totaliRow, 10);
}

export class ExportService {
  /**
   * Un documento, una pagina nuova per gruppo, una sola `end`: e' lo schema di
   * `BollettinoPdfService.generateCumulativo`.
   */
  async generatePDF(gruppi: GruppoReport[], filters: ReportFilters): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A3', layout: 'landscape' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      gruppi.forEach((gruppo, index) => {
        // La prima sezione sta sulla pagina che PDFDocument apre da solo
        if (index > 0) doc.addPage();
        renderSezione(doc, gruppo, filters);
      });

      doc.end();
    });
  }

  /**
   * Un foglio per gruppo quando sono piu' d'uno, col nome del dipendente; con
   * un gruppo solo il foglio resta `Attività`, come prima.
   */
  async generateExcel(gruppi: GruppoReport[], filters: ReportFilters): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GicaTask';
    workbook.created = new Date();

    const usati = new Set<string>();
    gruppi.forEach((gruppo) => {
      const titolo =
        gruppi.length > 1 ? nomeFoglio(gruppo.utenteNome ?? 'Attività', usati) : 'Attività';
      scriviFoglioAttivita(workbook.addWorksheet(titolo), gruppo, filters);
    });

    // Il riepilogo resta uno e sull'unione: e' il quadro d'insieme, e serve
    // proprio a confrontare le persone fra loro
    const attivita = gruppi.flatMap((gruppo) => gruppo.attivita);

    // Aggregation by client
    const summarySheet = workbook.addWorksheet('Riepilogo');

    summarySheet.mergeCells('A1:D1');
    summarySheet.getCell('A1').value = 'Riepilogo per Cliente';
    summarySheet.getCell('A1').font = { size: 14, bold: true };

    const clientStats = new Map<string, { count: number; minutes: number }>();
    attivita.forEach((att) => {
      const key = att.cliente?.nome ?? 'Assenze';
      const existing = clientStats.get(key) || { count: 0, minutes: 0 };
      clientStats.set(key, {
        count: existing.count + 1,
        minutes: existing.minutes + att.durataMinuti,
      });
    });

    const clientHeaderRow = summarySheet.addRow(['Cliente', 'Attività', 'Ore', 'Durata']);
    clientHeaderRow.font = { bold: true };
    applyGrid(clientHeaderRow, 4);

    Array.from(clientStats.entries())
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .forEach(([cliente, stats]) => {
        const row = summarySheet.addRow([
          cliente,
          stats.count,
          (stats.minutes / 60).toFixed(1),
          formatDuration(stats.minutes),
        ]);
        applyGrid(row, 4);
      });

    summarySheet.columns = [
      { width: 25 },
      { width: 12 },
      { width: 10 },
      { width: 12 },
    ];

    // Aggregation by employee
    summarySheet.addRow([]);
    summarySheet.addRow([]);
    const empTitleRow = summarySheet.addRow(['Riepilogo per Dipendente']);
    empTitleRow.font = { size: 14, bold: true };
    summarySheet.mergeCells(`A${empTitleRow.number}:D${empTitleRow.number}`);

    const empHeaderRow = summarySheet.addRow(['Dipendente', 'Attività', 'Ore', 'Durata']);
    empHeaderRow.font = { bold: true };
    applyGrid(empHeaderRow, 4);

    const empStats = new Map<string, { count: number; minutes: number }>();
    attivita.forEach((att) => {
      const key = nomeUtente(att.utente);
      const existing = empStats.get(key) || { count: 0, minutes: 0 };
      empStats.set(key, {
        count: existing.count + 1,
        minutes: existing.minutes + att.durataMinuti,
      });
    });

    Array.from(empStats.entries())
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .forEach(([dipendente, stats]) => {
        const row = summarySheet.addRow([
          dipendente,
          stats.count,
          (stats.minutes / 60).toFixed(1),
          formatDuration(stats.minutes),
        ]);
        applyGrid(row, 4);
      });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
