import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';

interface AttivitaExport {
  id: number;
  dataRiferimento: Date;
  oraInizio: string;
  oraFine: string;
  durataMinuti: number;
  note?: string | null;
  cliente: { nome: string };
  cantiere: { nome: string };
  tipoAttivita: { nome: string };
  utente: { nome: string; cognome: string };
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

export class ExportService {
  async generatePDF(attivita: AttivitaExport[], filters: ReportFilters): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title
      doc.fontSize(18).text('Report Attività', { align: 'center' });
      doc.moveDown(0.5);

      // Filters info
      doc.fontSize(10).fillColor('#666');
      const filterParts: string[] = [];
      if (filters.startDate) filterParts.push(`Dal: ${filters.startDate}`);
      if (filters.endDate) filterParts.push(`Al: ${filters.endDate}`);
      if (filters.clienteNome) filterParts.push(`Cliente: ${filters.clienteNome}`);
      if (filters.utenteNome) filterParts.push(`Dipendente: ${filters.utenteNome}`);
      if (filterParts.length > 0) {
        doc.text(filterParts.join(' | '), { align: 'center' });
      }
      doc.text(`Generato il: ${new Date().toLocaleString('it-IT')}`, { align: 'center' });
      doc.moveDown();

      // Summary
      const totalMinutes = attivita.reduce((sum, a) => sum + a.durataMinuti, 0);
      const totalHours = (totalMinutes / 60).toFixed(1);
      doc.fontSize(11).fillColor('#000');
      doc.text(`Totale: ${attivita.length} attività - ${totalHours} ore (${formatDuration(totalMinutes)})`);
      doc.moveDown();

      // Table header
      const tableTop = doc.y;
      const colWidths = [70, 60, 45, 100, 100, 90, 100, 100];
      const headers = ['Data', 'Orario', 'Durata', 'Dipendente', 'Cliente', 'Cantiere', 'Tipo', 'Note'];

      doc.fontSize(9).fillColor('#fff');
      doc.rect(50, tableTop, 742, 18).fill('#333');

      let xPos = 55;
      headers.forEach((header, i) => {
        const width = colWidths[i] ?? 80;
        doc.fillColor('#fff').text(header, xPos, tableTop + 5, { width: width - 5 });
        xPos += width;
      });

      // Table rows
      let yPos = tableTop + 22;
      doc.fillColor('#000');

      attivita.forEach((att, index) => {
        if (yPos > 520) {
          doc.addPage();
          yPos = 50;
        }

        // Alternate row background
        if (index % 2 === 0) {
          doc.rect(50, yPos - 2, 742, 16).fill('#f5f5f5');
        }

        xPos = 55;
        doc.fillColor('#000').fontSize(8);

        const row = [
          formatDate(att.dataRiferimento),
          `${att.oraInizio}-${att.oraFine}`,
          formatDuration(att.durataMinuti),
          `${att.utente.nome} ${att.utente.cognome}`,
          att.cliente.nome,
          att.cantiere.nome,
          att.tipoAttivita.nome,
          att.note || '-',
        ];

        row.forEach((cell, i) => {
          const width = colWidths[i] ?? 80;
          doc.text(cell.substring(0, 25), xPos, yPos, { width: width - 5 });
          xPos += width;
        });

        yPos += 16;
      });

      doc.end();
    });
  }

  async generateExcel(attivita: AttivitaExport[], filters: ReportFilters): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GicaTask';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Attività');

    // Header info
    worksheet.mergeCells('A1:I1');
    worksheet.getCell('A1').value = 'Report Attività';
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    const filterParts: string[] = [];
    if (filters.startDate) filterParts.push(`Dal: ${filters.startDate}`);
    if (filters.endDate) filterParts.push(`Al: ${filters.endDate}`);
    if (filters.clienteNome) filterParts.push(`Cliente: ${filters.clienteNome}`);
    if (filters.utenteNome) filterParts.push(`Dipendente: ${filters.utenteNome}`);

    worksheet.mergeCells('A2:I2');
    worksheet.getCell('A2').value = filterParts.length > 0 ? filterParts.join(' | ') : 'Tutti i dati';
    worksheet.getCell('A2').font = { size: 10, italic: true };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    const totalMinutes = attivita.reduce((sum, a) => sum + a.durataMinuti, 0);
    worksheet.mergeCells('A3:I3');
    worksheet.getCell('A3').value = `Totale: ${attivita.length} attività - ${(totalMinutes / 60).toFixed(1)} ore`;
    worksheet.getCell('A3').font = { size: 10 };
    worksheet.getCell('A3').alignment = { horizontal: 'center' };

    // Column headers
    const headerRow = worksheet.addRow([
      'Data',
      'Dipendente',
      'Cliente',
      'Cantiere',
      'Tipo Attività',
      'Note',
      'Ora Inizio',
      'Ora Fine',
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
      { width: 30 },  // Note
      { width: 10 },  // Ora Inizio
      { width: 10 },  // Ora Fine
      { width: 12 },  // Durata (ore)
    ];

    // Data rows
    attivita.forEach((att) => {
      worksheet.addRow([
        formatDate(att.dataRiferimento),
        `${att.utente.nome} ${att.utente.cognome}`,
        att.cliente.nome,
        att.cantiere.nome,
        att.tipoAttivita.nome,
        att.note || '',
        att.oraInizio,
        att.oraFine,
        parseFloat((att.durataMinuti / 60).toFixed(2)),
      ]);
    });

    // Aggregation by client
    const summarySheet = workbook.addWorksheet('Riepilogo');

    summarySheet.mergeCells('A1:D1');
    summarySheet.getCell('A1').value = 'Riepilogo per Cliente';
    summarySheet.getCell('A1').font = { size: 14, bold: true };

    const clientStats = new Map<string, { count: number; minutes: number }>();
    attivita.forEach((att) => {
      const key = att.cliente.nome;
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
