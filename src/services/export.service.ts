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
 * Order the rows for the Excel report: grouped by employee and, inside each
 * group, chronologically (oldest first, then by start time).
 *
 * The employee is sorted on "Nome Cognome", the same string shown in the
 * column, so the order is evident to whoever reads the sheet.
 */
function sortForReport(attivita: AttivitaExport[]): AttivitaExport[] {
  return [...attivita].sort((a, b) => {
    const utenteA = `${a.utente.nome} ${a.utente.cognome}`;
    const utenteB = `${b.utente.nome} ${b.utente.cognome}`;
    const byUtente = utenteA.localeCompare(utenteB, 'it');
    if (byUtente !== 0) return byUtente;

    const dataA = new Date(a.dataRiferimento).getTime();
    const dataB = new Date(b.dataRiferimento).getTime();
    if (dataA !== dataB) return dataA - dataB;

    return orarioInizio(a).localeCompare(orarioInizio(b));
  });
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
      const doc = new PDFDocument({ margin: 25, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = 842 - 50; // A4 landscape width minus margins
      const startX = 25;

      // Title
      doc.fontSize(14).text('Report Attività', { align: 'center' });

      // Filters info
      doc.fontSize(8).fillColor('#666');
      const filterParts: string[] = [];
      if (filters.startDate) filterParts.push(`Dal: ${filters.startDate}`);
      if (filters.endDate) filterParts.push(`Al: ${filters.endDate}`);
      if (filters.clienteNome) filterParts.push(`Cliente: ${filters.clienteNome}`);
      if (filters.utenteNome) filterParts.push(`Dipendente: ${filters.utenteNome}`);
      if (filterParts.length > 0) {
        doc.text(filterParts.join(' | '), { align: 'center' });
      }

      // Summary
      const totalMinutes = attivita.reduce((sum, a) => sum + a.durataMinuti, 0);
      const totalHours = (totalMinutes / 60).toFixed(1);
      doc.fontSize(9).fillColor('#000');
      doc.text(`Totale: ${attivita.length} attività - ${totalHours} ore`, { align: 'center' });
      doc.moveDown(0.3);

      // Table header - same order as Excel
      const tableTop = doc.y;
      // Data, Dipendente, Cliente, Cantiere, Tipo, Assenza, Note, Mattino, Pomeriggio, Durata
      const colWidths = [55, 92, 92, 82, 78, 78, 125, 66, 66, 46];
      const headers = ['Data', 'Dipendente', 'Cliente', 'Cantiere', 'Tipo', 'Assenza', 'Note', 'Mattino', 'Pomeriggio', 'Durata'];
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);

      doc.fontSize(7).fillColor('#fff');
      doc.rect(startX, tableTop, tableWidth, 12).fill('#333');

      let xPos = startX + 2;
      headers.forEach((header, i) => {
        const width = colWidths[i] ?? 50;
        doc.fillColor('#fff').text(header, xPos, tableTop + 3, { width: width - 4 });
        xPos += width;
      });

      // Table rows
      let yPos = tableTop + 14;
      const rowHeight = 11;

      attivita.forEach((att, index) => {
        if (yPos > 560) {
          doc.addPage();
          yPos = 25;
        }

        // Alternate row background
        if (index % 2 === 0) {
          doc.rect(startX, yPos - 1, tableWidth, rowHeight).fill('#f8f8f8');
        }

        xPos = startX + 2;
        doc.fillColor('#000').fontSize(6);

        const row = [
          formatDate(att.dataRiferimento),
          `${att.utente.nome} ${att.utente.cognome}`,
          att.cliente?.nome ?? '',
          att.cantiere?.nome ?? '',
          att.tipoAttivita?.nome ?? '',
          att.assenza?.nome ?? '',
          att.note || '-',
          formatTimeSlot(att.oraInizioMattino, att.oraFineMattino),
          formatTimeSlot(att.oraInizioPomeriggio, att.oraFinePomeriggio),
          formatDuration(att.durataMinuti),
        ];

        row.forEach((cell, i) => {
          const width = colWidths[i] ?? 50;
          const maxChars = Math.floor(width / 3.5);
          const truncated = cell.length > maxChars ? cell.substring(0, maxChars - 1) + '…' : cell;
          doc.text(truncated, xPos, yPos + 2, { width: width - 4 });
          xPos += width;
        });

        yPos += rowHeight;
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

    Array.from(clientStats.entries())
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .forEach(([cliente, stats]) => {
        summarySheet.addRow([
          cliente,
          stats.count,
          (stats.minutes / 60).toFixed(1),
          formatDuration(stats.minutes),
        ]);
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
        summarySheet.addRow([
          dipendente,
          stats.count,
          (stats.minutes / 60).toFixed(1),
          formatDuration(stats.minutes),
        ]);
      });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
