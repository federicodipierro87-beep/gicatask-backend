import PDFDocument from 'pdfkit';
import type { QuotaNoleggio } from '@prisma/client';

interface NoleggioExport {
  data: Date;
  osservazioni: string | null;
  importo: number;
  quota: QuotaNoleggio;
  importoCalcolato: number;
  veicolo: { nome: string };
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

function etichettaQuota(quota: QuotaNoleggio): string {
  return quota === 'SETTANTA_TRENTA' ? '70/30' : '100';
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
  { header: 'Veicolo', width: 115, value: (n) => n.veicolo.nome },
  { header: 'Osservazioni', width: 210, value: (n) => n.osservazioni || '-' },
  { header: 'Importo', width: 65, value: (n) => formatImporto(n.importo) },
  { header: 'Quota', width: 45, value: (n) => etichettaQuota(n.quota) },
  { header: 'Importo calc.', width: 50, value: (n) => formatImporto(n.importoCalcolato) },
];

const TABLE_WIDTH = PDF_COLUMNS.reduce((sum, col) => sum + col.width, 0);

// Limite su una riga singola: una cella piu' alta di una pagina non entrerebbe
// mai nemmeno dopo un salto pagina, e il controllo andrebbe in ciclo
const MAX_ROW_HEIGHT = PDF_BOTTOM - PDF_MARGIN - HEADER_HEIGHT;

export class DreamNoleggiPdfService {
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
      doc.text('Report Dream Noleggio', PDF_MARGIN, PDF_MARGIN, {
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
      const totaleCalcolato = noleggi.reduce((sum, n) => sum + n.importoCalcolato, 0);

      const totali = ['', '', 'TOTALE', formatImporto(totaleImporto), '-', formatImporto(totaleCalcolato)];

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
}
