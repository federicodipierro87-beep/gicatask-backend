import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';

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

interface ReportFilters {
  startDate?: string;
  endDate?: string;
  clienteNome?: string;
  utenteNome?: string;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('it-IT');
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// An activity can have the afternoon slot only, and an absence has no slot at all
function orarioInizio(att: AttivitaExport): string {
  return att.oraInizioMattino || att.oraInizioPomeriggio || '';
}

/**
 * Order the rows for the Excel report: day by day (oldest first) and, inside
 * each day, grouped by employee and ordered by start time.
 *
 * The employee is sorted on "Nome Cognome", the same string shown in the
 * column, so the order is evident to whoever reads the sheet.
 */
function sortForReport(attivita: AttivitaExport[]): AttivitaExport[] {
  return [...attivita].sort((a, b) => {
    const dataA = new Date(a.dataRiferimento).getTime();
    const dataB = new Date(b.dataRiferimento).getTime();
    if (dataA !== dataB) return dataA - dataB;

    const utenteA = `${a.utente.nome} ${a.utente.cognome}`;
    const utenteB = `${b.utente.nome} ${b.utente.cognome}`;
    const byUtente = utenteA.localeCompare(utenteB, 'it');
    if (byUtente !== 0) return byUtente;

    return orarioInizio(a).localeCompare(orarioInizio(b));
  });
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

interface PdfColumn {
  header: string;
  width: number;
  value: (att: AttivitaExport) => string;
}

// The widths add up to 1141: A3 landscape width minus the two margins
const PDF_COLUMNS: PdfColumn[] = [
  { header: 'Data', width: 62, value: (a) => formatDate(a.dataRiferimento) },
  { header: 'Dipendente', width: 130, value: (a) => `${a.utente.nome} ${a.utente.cognome}` },
  { header: 'Cliente', width: 150, value: (a) => a.cliente?.nome ?? '' },
  { header: 'Cantiere', width: 140, value: (a) => a.cantiere?.nome ?? '' },
  { header: 'Tipo', width: 120, value: (a) => a.tipoAttivita?.nome ?? '' },
  { header: 'Assenza', width: 100, value: (a) => a.assenza?.nome ?? '' },
  { header: 'Note', width: 234, value: (a) => a.note || '-' },
  {
    header: 'Mattino',
    width: 75,
    value: (a) => formatTimeSlot(a.oraInizioMattino, a.oraFineMattino),
  },
  {
    header: 'Pomeriggio',
    width: 75,
    value: (a) => formatTimeSlot(a.oraInizioPomeriggio, a.oraFinePomeriggio),
  },
  { header: 'Durata', width: 55, value: (a) => formatDuration(a.durataMinuti) },
];

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

function applyGrid(row: ExcelJS.Row, columnCount: number): void {
  for (let i = 1; i <= columnCount; i++) {
    row.getCell(i).border = GRID_BORDER;
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

export class ExportService {
  async generatePDF(attivita: AttivitaExport[], filters: ReportFilters): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A3', layout: 'landscape' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

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

      // Filters info
      doc.font('Helvetica').fontSize(9).fillColor('#666666');
      const filterParts: string[] = [];
      if (filters.startDate) filterParts.push(`Dal: ${filters.startDate}`);
      if (filters.endDate) filterParts.push(`Al: ${filters.endDate}`);
      if (filters.clienteNome) filterParts.push(`Cliente: ${filters.clienteNome}`);
      if (filters.utenteNome) filterParts.push(`Dipendente: ${filters.utenteNome}`);
      if (filterParts.length > 0) {
        doc.text(filterParts.join(' | '), { width: TABLE_WIDTH, align: 'center' });
      }

      // Summary
      const totalMinutes = attivita.reduce((sum, a) => sum + a.durataMinuti, 0);
      const totalHours = (totalMinutes / 60).toFixed(1);
      doc.fontSize(10).fillColor('#000000');
      doc.text(`Totale: ${attivita.length} attività - ${totalHours} ore`, {
        width: TABLE_WIDTH,
        align: 'center',
      });
      doc.moveDown(0.5);

      // Table. Same columns and same order as the Excel sheet
      let y = drawTableHeader(doc.y);

      sortForReport(attivita).forEach((att, index) => {
        const cells = PDF_COLUMNS.map((col) => ({ col, text: col.value(att) }));

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

        if (index % 2 === 0) {
          doc.rect(PDF_MARGIN, y, TABLE_WIDTH, rowHeight).fill('#f5f5f5');
        }

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

      doc.end();
    });
  }

  async generateExcel(attivita: AttivitaExport[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GicaTask';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Attività');

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

    headerRow.font = { bold: true };
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
    sortForReport(attivita).forEach((att) => {
      const row = worksheet.addRow([
        formatDate(att.dataRiferimento),
        `${att.utente.nome} ${att.utente.cognome}`,
        att.cliente?.nome ?? '',
        att.cantiere?.nome ?? '',
        att.tipoAttivita?.nome ?? '',
        att.assenza?.nome ?? '',
        wrapNote(att.note),
        formatTimeSlot(att.oraInizioMattino, att.oraFineMattino),
        formatTimeSlot(att.oraInizioPomeriggio, att.oraFinePomeriggio),
        parseFloat((att.durataMinuti / 60).toFixed(2)),
      ]);

      // Without wrapText Excel shows the line breaks as a single long line
      row.getCell(7).alignment = { wrapText: true, vertical: 'top' };
      applyGrid(row, 10);
    });

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
      const key = `${att.utente.nome} ${att.utente.cognome}`;
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
