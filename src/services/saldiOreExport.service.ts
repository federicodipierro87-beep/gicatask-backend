import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type { RigaSaldoOre, SaldiOreMese } from './saldiOre.service.js';

const NOMI_MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

/** "Settembre 2026" da "2026-09". Il mese arriva gia' validato dal servizio. */
function titoloMese(meseKey: string): string {
  return `${NOMI_MESI[Number(meseKey.slice(5, 7)) - 1]} ${meseKey.slice(0, 4)}`;
}

/** Come `formatDuration` del frontend: "8h 12m", "-3h", "45m". */
function formatDurata(minuti: number): string {
  const segno = minuti < 0 ? '-' : '';
  const assoluti = Math.abs(minuti);
  const ore = Math.floor(assoluti / 60);
  const min = assoluti % 60;
  if (ore === 0) return `${segno}${min}m`;
  if (min === 0) return `${segno}${ore}h`;
  return `${segno}${ore}h ${min}m`;
}

/** Differenza e saldo portano il "+" quando il dipendente e' a credito. */
function formatSaldo(minuti: number): string {
  return minuti > 0 ? `+${formatDurata(minuti)}` : formatDurata(minuti);
}

function nomeConPercentuale(r: RigaSaldoOre): string {
  return r.percentualeLavoro === 100 ? r.utenteNome : `${r.utenteNome} (${r.percentualeLavoro}%)`;
}

function avvisoMesiMancanti(dati: SaldiOreMese, meseKey: string): string | null {
  if (dati.mesiSenzaOreDovute.length === 0) return null;
  const mesi = dati.mesiSenzaOreDovute.map((m) => NOMI_MESI[m - 1]?.toLowerCase()).join(', ');
  return `Ore dovute non impostate per ${mesi} ${meseKey.slice(0, 4)}: in quei mesi valgono zero.`;
}

interface Totali {
  dovute: number;
  effettuate: number;
  differenza: number;
  saldo: number;
}

function calcolaTotali(righe: RigaSaldoOre[]): Totali {
  return righe.reduce(
    (acc, r) => ({
      dovute: acc.dovute + r.oreDovuteMinuti,
      effettuate: acc.effettuate + r.oreEffettuateMinuti,
      differenza: acc.differenza + r.differenzaMinuti,
      saldo: acc.saldo + r.saldoCumulativoMinuti,
    }),
    { dovute: 0, effettuate: 0, differenza: 0, saldo: 0 }
  );
}

/**
 * A4 verticale come il Report Gica: la pagina e' 595x842pt e la tabella puo'
 * usare 545pt di larghezza. Una riga per dipendente, quindi niente testo a
 * capo: l'altezza delle righe e' fissa.
 */
const PDF_MARGIN = 25;
const PDF_PAGE_HEIGHT = 842;
const PDF_BOTTOM = PDF_PAGE_HEIGHT - PDF_MARGIN;

const CELL_PAD_X = 4;
const CELL_PAD_Y = 4;
const HEADER_HEIGHT = 18;
const ROW_HEIGHT = 16;
const FONT_SIZE = 9;

const GRID_COLOR = '#999999';
const GRID_LINE_WIDTH = 0.5;

const VERDE = '#15803d';
const ROSSO = '#dc2626';

interface PdfColumn {
  header: string;
  width: number;
  align: 'left' | 'right';
  value: (r: RigaSaldoOre) => string;
  /** Minuti che decidono il colore della cella, per differenza e saldo. */
  segno?: (r: RigaSaldoOre) => number;
}

// Le larghezze sommano a 545: A4 verticale meno i due margini
const PDF_COLUMNS: PdfColumn[] = [
  { header: 'Dipendente', width: 185, align: 'left', value: nomeConPercentuale },
  { header: 'Ore dovute', width: 90, align: 'right', value: (r) => formatDurata(r.oreDovuteMinuti) },
  { header: 'Ore effettuate', width: 90, align: 'right', value: (r) => formatDurata(r.oreEffettuateMinuti) },
  {
    header: 'Differenza',
    width: 85,
    align: 'right',
    value: (r) => formatSaldo(r.differenzaMinuti),
    segno: (r) => r.differenzaMinuti,
  },
  {
    header: 'Saldo cumulativo',
    width: 95,
    align: 'right',
    value: (r) => formatSaldo(r.saldoCumulativoMinuti),
    segno: (r) => r.saldoCumulativoMinuti,
  },
];

const TABLE_WIDTH = PDF_COLUMNS.reduce((sum, col) => sum + col.width, 0);

function coloreSegno(minuti: number): string {
  if (minuti > 0) return VERDE;
  if (minuti < 0) return ROSSO;
  return '#000000';
}

// Bordi espliciti come negli altri export: `showGridLines` varrebbe anche per
// le righe del titolo
const GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF999999' } },
  left: { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  right: { style: 'thin', color: { argb: 'FF999999' } },
};

const EXCEL_COLONNE = 6;

function applyGrid(row: ExcelJS.Row): void {
  for (let i = 1; i <= EXCEL_COLONNE; i++) {
    row.getCell(i).border = GRID_BORDER;
  }
}

/**
 * Nel foglio le ore sono numeri decimali (8h 30m = 8,50) e non durate di
 * Excel: con il formato `[h]:mm` i valori negativi di differenza e saldo
 * uscirebbero come ####. Cosi' restano anche sommabili.
 */
function oreDecimali(minuti: number): number {
  return Math.round((minuti / 60) * 100) / 100;
}

const FORMATO_ORE = '0.00';
// Il "+" sui crediti come nel PDF, verde/rosso come a schermo
const FORMATO_SALDO = '[Color10]+0.00;[Red]-0.00;0.00';

export class SaldiOreExportService {
  async generaPdf(dati: SaldiOreMese, meseKey: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const drawGrid = (y: number, height: number): void => {
        doc.lineWidth(GRID_LINE_WIDTH).strokeColor(GRID_COLOR);
        let x = PDF_MARGIN;
        PDF_COLUMNS.forEach((col) => {
          doc.rect(x, y, col.width, height).stroke();
          x += col.width;
        });
      };

      const drawTableHeader = (y: number): number => {
        doc.rect(PDF_MARGIN, y, TABLE_WIDTH, HEADER_HEIGHT).fill('#333333');
        doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#ffffff');

        let x = PDF_MARGIN;
        PDF_COLUMNS.forEach((col) => {
          doc.text(col.header, x + CELL_PAD_X, y + CELL_PAD_Y + 1, {
            width: col.width - CELL_PAD_X * 2,
            align: col.align,
            lineBreak: false,
          });
          x += col.width;
        });

        drawGrid(y, HEADER_HEIGHT);
        return y + HEADER_HEIGHT;
      };

      // Una riga: testo nero, tranne le colonne con segno che si colorano
      const drawRow = (y: number, testi: string[], segni: (number | undefined)[], bold: boolean) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT_SIZE);
        let x = PDF_MARGIN;
        PDF_COLUMNS.forEach((col, i) => {
          const segno = segni[i];
          doc.fillColor(segno === undefined ? '#000000' : coloreSegno(segno));
          doc.text(testi[i] ?? '', x + CELL_PAD_X, y + CELL_PAD_Y, {
            width: col.width - CELL_PAD_X * 2,
            align: col.align,
            lineBreak: false,
            ellipsis: true,
          });
          x += col.width;
        });
        drawGrid(y, ROW_HEIGHT);
      };

      // Titolo e mese
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000');
      doc.text('Report Saldi Ore', PDF_MARGIN, PDF_MARGIN, { width: TABLE_WIDTH, align: 'center' });
      doc.font('Helvetica').fontSize(11).fillColor('#333333');
      doc.text(titoloMese(meseKey), { width: TABLE_WIDTH, align: 'center' });

      doc.fontSize(8).fillColor('#666666');
      doc.text(
        'Ore dovute = ore del mese a tempo pieno x percentuale di lavoro. Ore effettuate senza ' +
          'assenze. Saldo cumulativo da gennaio.',
        { width: TABLE_WIDTH, align: 'center' }
      );

      const avviso = avvisoMesiMancanti(dati, meseKey);
      if (avviso) {
        doc.moveDown(0.3).fillColor('#b45309').text(avviso, { width: TABLE_WIDTH, align: 'center' });
      }
      doc.moveDown(0.8);

      let y = drawTableHeader(doc.y);

      dati.righe.forEach((riga, index) => {
        if (y + ROW_HEIGHT > PDF_BOTTOM) {
          doc.addPage();
          y = drawTableHeader(PDF_MARGIN);
        }

        if (index % 2 === 0) {
          doc.rect(PDF_MARGIN, y, TABLE_WIDTH, ROW_HEIGHT).fill('#f5f5f5');
        }

        drawRow(
          y,
          PDF_COLUMNS.map((col) => col.value(riga)),
          PDF_COLUMNS.map((col) => col.segno?.(riga)),
          false
        );
        y += ROW_HEIGHT;
      });

      if (y + ROW_HEIGHT > PDF_BOTTOM) {
        doc.addPage();
        y = drawTableHeader(PDF_MARGIN);
      }

      const totali = calcolaTotali(dati.righe);
      doc.rect(PDF_MARGIN, y, TABLE_WIDTH, ROW_HEIGHT).fill('#e5e5e5');
      drawRow(
        y,
        [
          'TOTALE',
          formatDurata(totali.dovute),
          formatDurata(totali.effettuate),
          formatSaldo(totali.differenza),
          formatSaldo(totali.saldo),
        ],
        [undefined, undefined, undefined, totali.differenza, totali.saldo],
        true
      );

      doc.end();
    });
  }

  async generaExcel(dati: SaldiOreMese, meseKey: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GicaTask';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Saldi Ore');

    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').value = `REPORT SALDI ORE - ${titoloMese(meseKey).toUpperCase()}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:F2');
    worksheet.getCell('A2').value =
      'Ore in formato decimale (8,50 = 8h 30m). Ore effettuate senza assenze. Saldo cumulativo da gennaio.';
    worksheet.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF666666' } };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    const avviso = avvisoMesiMancanti(dati, meseKey);
    if (avviso) {
      worksheet.mergeCells('A3:F3');
      worksheet.getCell('A3').value = avviso;
      worksheet.getCell('A3').font = { size: 9, bold: true, color: { argb: 'FFB45309' } };
      worksheet.getCell('A3').alignment = { horizontal: 'center' };
    }

    // Riga vuota fra le note e la tabella
    worksheet.addRow([]);

    const headerRow = worksheet.addRow([
      'Dipendente',
      '% lavoro',
      'Ore dovute',
      'Ore effettuate',
      'Differenza',
      'Saldo cumulativo',
    ]);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
    applyGrid(headerRow);

    worksheet.columns = [
      { width: 32 }, // Dipendente
      { width: 10 }, // % lavoro
      { width: 14 }, // Ore dovute
      { width: 15 }, // Ore effettuate
      { width: 13 }, // Differenza
      { width: 18 }, // Saldo cumulativo
    ];

    const formattaRiga = (row: ExcelJS.Row) => {
      row.getCell(2).numFmt = '0"%"';
      row.getCell(3).numFmt = FORMATO_ORE;
      row.getCell(4).numFmt = FORMATO_ORE;
      row.getCell(5).numFmt = FORMATO_SALDO;
      row.getCell(6).numFmt = FORMATO_SALDO;
      applyGrid(row);
    };

    dati.righe.forEach((r) => {
      formattaRiga(
        worksheet.addRow([
          r.utenteNome,
          r.percentualeLavoro,
          oreDecimali(r.oreDovuteMinuti),
          oreDecimali(r.oreEffettuateMinuti),
          oreDecimali(r.differenzaMinuti),
          oreDecimali(r.saldoCumulativoMinuti),
        ])
      );
    });

    const totali = calcolaTotali(dati.righe);
    const totaliRow = worksheet.addRow([
      'TOTALE',
      null,
      oreDecimali(totali.dovute),
      oreDecimali(totali.effettuate),
      oreDecimali(totali.differenza),
      oreDecimali(totali.saldo),
    ]);
    totaliRow.font = { bold: true };
    formattaRiga(totaliRow);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
