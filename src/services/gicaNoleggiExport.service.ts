import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

interface NoleggioExport {
  data: Date;
  osservazioni: string | null;
  importo: number;
  veicolo: { nome: string };
  cliente: { nome: string } | null;
}

interface PeriodoFiltri {
  startDate?: string;
  endDate?: string;
}

function formatData(date: Date): string {
  return new Date(date).toLocaleDateString('it-IT', { timeZone: 'UTC' });
}

// Punto decimale sostituito a mano invece di toLocaleString: le Helvetica di
// pdfkit sono in WinAnsi e i separatori delle locale non ci stanno tutti
function formatImporto(importo: number): string {
  return importo.toFixed(2).replace('.', ',');
}

/**
 * Il report e' stampato su A4 verticale: la pagina e' 595x842pt e la tabella
 * puo' usare 545pt di larghezza.
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
  value: (n: NoleggioExport) => string;
}

// Le larghezze sommano a 545: A4 verticale meno i due margini
const PDF_COLUMNS: PdfColumn[] = [
  { header: 'Data', width: 60, value: (n) => formatData(n.data) },
  { header: 'Veicolo', width: 110, value: (n) => n.veicolo.nome },
  { header: 'Cliente', width: 110, value: (n) => n.cliente?.nome || '-' },
  { header: 'Osservazioni', width: 195, value: (n) => n.osservazioni || '-' },
  { header: 'Importo', width: 70, value: (n) => formatImporto(n.importo) },
];

const TABLE_WIDTH = PDF_COLUMNS.reduce((sum, col) => sum + col.width, 0);

// Limite su una riga singola: una cella piu' alta di una pagina non entrerebbe
// mai nemmeno dopo un salto pagina, e il controllo andrebbe in ciclo
const MAX_ROW_HEIGHT = PDF_BOTTOM - PDF_MARGIN - HEADER_HEIGHT;

// Bordi espliciti e non `pageSetup.showGridLines`: le griglie del foglio sono
// un interruttore per tutto l'intervallo usato, riga del titolo compresa
const GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF999999' } },
  left: { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  right: { style: 'thin', color: { argb: 'FF999999' } },
};

const EXCEL_COLONNE = 5;

function applyGrid(row: ExcelJS.Row): void {
  for (let i = 1; i <= EXCEL_COLONNE; i++) {
    row.getCell(i).border = GRID_BORDER;
  }
}

export class GicaNoleggiExportService {
  async generaPdf(noleggi: NoleggioExport[], filtri: PeriodoFiltri): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Un rettangolo per cella: i separatori verticali restano visibili anche
      // sulle righe in cui una cella e' vuota
      const drawGrid = (y: number, height: number): void => {
        doc.lineWidth(GRID_LINE_WIDTH).strokeColor(GRID_COLOR);

        let x = PDF_MARGIN;
        PDF_COLUMNS.forEach((col) => {
          doc.rect(x, y, col.width, height).stroke();
          x += col.width;
        });
      };

      // Lascia attivo lo stile del corpo, cosi' il chiamante puo' tornare
      // subito a misurare e disegnare righe
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

      // Titolo
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000');
      doc.text('Report Gica', PDF_MARGIN, PDF_MARGIN, {
        width: TABLE_WIDTH,
        align: 'center',
      });

      // Periodo
      doc.font('Helvetica').fontSize(9).fillColor('#666666');
      const filterParts: string[] = [];
      if (filtri.startDate) filterParts.push(`Dal: ${filtri.startDate}`);
      if (filtri.endDate) filterParts.push(`Al: ${filtri.endDate}`);
      if (filterParts.length > 0) {
        doc.text(filterParts.join(' | '), { width: TABLE_WIDTH, align: 'center' });
      }
      doc.moveDown(0.5);

      let y = drawTableHeader(doc.y);

      noleggi.forEach((noleggio, index) => {
        const cells = PDF_COLUMNS.map((col) => ({ col, text: col.value(noleggio) }));

        // Il testo va a capo dentro la cella, quindi la riga e' alta quanto la
        // sua cella piu' alta
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
          doc.text(text, x + CELL_PAD_X, y + CELL_PAD_Y, {
            width: col.width - CELL_PAD_X * 2,
            height: rowHeight - CELL_PAD_Y,
          });
          x += col.width;
        });

        drawGrid(y, rowHeight);
        y += rowHeight;
      });

      // Riga dei totali, in coda alla tabella
      const totaleImporto = noleggi.reduce((sum, n) => sum + n.importo, 0);
      const totali = ['', '', '', 'TOTALE', formatImporto(totaleImporto)];

      if (y + MIN_ROW_HEIGHT > PDF_BOTTOM) {
        doc.addPage();
        y = drawTableHeader(PDF_MARGIN);
      }

      doc.font('Helvetica-Bold').fontSize(BODY_FONT_SIZE).fillColor('#000000');
      let xTotali = PDF_MARGIN;
      PDF_COLUMNS.forEach((col, i) => {
        doc.text(totali[i] as string, xTotali + CELL_PAD_X, y + CELL_PAD_Y, {
          width: col.width - CELL_PAD_X * 2,
          height: MIN_ROW_HEIGHT - CELL_PAD_Y,
        });
        xTotali += col.width;
      });
      drawGrid(y, MIN_ROW_HEIGHT);

      doc.end();
    });
  }

  async generaExcel(noleggi: NoleggioExport[], filtri: PeriodoFiltri): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GicaTask';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Gica');

    // Titolo con il periodo: il nome del file lo porta gia', ma il foglio viene
    // spesso letto staccato dal file da cui esce
    const periodo: string[] = [];
    if (filtri.startDate) periodo.push(`Dal: ${filtri.startDate}`);
    if (filtri.endDate) periodo.push(`Al: ${filtri.endDate}`);

    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').value =
      periodo.length > 0 ? `REPORT GICA - ${periodo.join(' | ')}` : 'REPORT GICA';
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    const headerRow = worksheet.addRow([
      'Data',
      'Veicolo',
      'Cliente',
      'Osservazioni',
      'Importo',
    ]);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF333333' },
    };
    applyGrid(headerRow);

    worksheet.columns = [
      { width: 12 }, // Data
      { width: 24 }, // Veicolo
      { width: 24 }, // Cliente
      { width: 60 }, // Osservazioni
      { width: 14 }, // Importo
    ];

    noleggi.forEach((noleggio) => {
      // La data e' @db.Date: scritta come Date, ExcelJS la convertirebbe con
      // getTime() e il fuso la sposterebbe al giorno prima
      const row = worksheet.addRow([
        formatData(noleggio.data),
        noleggio.veicolo.nome,
        noleggio.cliente?.nome ?? '',
        noleggio.osservazioni ?? '',
        noleggio.importo,
      ]);

      row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
      // Il valore e' un numero: senza formato Excel mostrerebbe 1,5 invece di 1,50
      row.getCell(5).numFmt = '0.00';
      applyGrid(row);
    });

    const totaleImporto = noleggi.reduce((sum, n) => sum + n.importo, 0);
    const totaliRow = worksheet.addRow(['TOTALE', '', '', '', totaleImporto]);
    totaliRow.font = { bold: true };
    totaliRow.getCell(5).numFmt = '0.00';
    applyGrid(totaliRow);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
