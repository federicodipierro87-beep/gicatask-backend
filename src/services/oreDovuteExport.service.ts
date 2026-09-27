import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type { OreDovuteAnno } from './oreDovute.service.js';

const NOMI_MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

/** "172:12", lo stesso formato dei campi della pagina Ore dovute. */
function formatOre(minuti: number): string {
  const assoluti = Math.abs(minuti);
  const testo = `${Math.floor(assoluti / 60)}:${String(assoluti % 60).padStart(2, '0')}`;
  return minuti < 0 ? `-${testo}` : testo;
}

/** Ore decimali per il foglio: 172:12 = 172,20, sommabili in Excel. */
function oreDecimali(minuti: number): number {
  return Math.round((minuti / 60) * 100) / 100;
}

interface Riepilogo {
  sommaMesi: number;
  mesiImpostati: number;
  /** Positivo se ai mesi mancano ore per arrivare alle annue; null senza annue. */
  scarto: number | null;
  esito: string;
}

// Stessi messaggi della pagina, cosi' export e schermo dicono la stessa cosa
function riepilogo(dati: OreDovuteAnno): Riepilogo {
  const sommaMesi = dati.mesi.reduce((tot, m) => tot + (m.minuti ?? 0), 0);
  const mesiImpostati = dati.mesi.filter((m) => m.minuti !== null).length;
  const scarto = dati.minutiAnnui !== null ? dati.minutiAnnui - sommaMesi : null;

  let esito: string;
  if (scarto === null) {
    esito = 'Ore annue non impostate: controllo incrociato non disponibile.';
  } else if (scarto === 0) {
    esito = 'La somma dei mesi corrisponde alle ore annue.';
  } else if (scarto > 0) {
    esito = `Mancano ${formatOre(scarto)} per arrivare alle ore annue.`;
  } else {
    esito = `La somma dei mesi supera le ore annue di ${formatOre(-scarto)}.`;
  }

  return { sommaMesi, mesiImpostati, scarto, esito };
}

/** A4 verticale: tabella stretta e centrata, due sole colonne. */
const PDF_MARGIN = 25;
const PAGE_WIDTH = 595;
const COL_MESE = 160;
const COL_ORE = 110;
const TABLE_WIDTH = COL_MESE + COL_ORE;
const TABLE_X = (PAGE_WIDTH - TABLE_WIDTH) / 2;
const ROW_HEIGHT = 18;
const CELL_PAD_X = 6;
const CELL_PAD_Y = 5;
const FONT_SIZE = 10;

const GRID_COLOR = '#999999';
const VERDE = '#15803d';
const AMBRA = '#b45309';

const GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF999999' } },
  left: { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  right: { style: 'thin', color: { argb: 'FF999999' } },
};

const EXCEL_COLONNE = 3;

function applyGrid(row: ExcelJS.Row): void {
  for (let i = 1; i <= EXCEL_COLONNE; i++) {
    row.getCell(i).border = GRID_BORDER;
  }
}

export class OreDovuteExportService {
  async generaPdf(dati: OreDovuteAnno, anno: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const larghezzaTesto = PAGE_WIDTH - PDF_MARGIN * 2;

      const drawRow = (
        y: number,
        mese: string,
        ore: string,
        stile: { font?: string; fill?: string; testo?: string } = {}
      ) => {
        if (stile.fill) doc.rect(TABLE_X, y, TABLE_WIDTH, ROW_HEIGHT).fill(stile.fill);
        doc.font(stile.font ?? 'Helvetica').fontSize(FONT_SIZE).fillColor(stile.testo ?? '#000000');
        doc.text(mese, TABLE_X + CELL_PAD_X, y + CELL_PAD_Y, {
          width: COL_MESE - CELL_PAD_X * 2,
          lineBreak: false,
        });
        doc.text(ore, TABLE_X + COL_MESE + CELL_PAD_X, y + CELL_PAD_Y, {
          width: COL_ORE - CELL_PAD_X * 2,
          align: 'right',
          lineBreak: false,
        });
        doc.lineWidth(0.5).strokeColor(GRID_COLOR);
        doc.rect(TABLE_X, y, COL_MESE, ROW_HEIGHT).stroke();
        doc.rect(TABLE_X + COL_MESE, y, COL_ORE, ROW_HEIGHT).stroke();
        return y + ROW_HEIGHT;
      };

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000');
      doc.text(`Ore Dovute ${anno}`, PDF_MARGIN, PDF_MARGIN, { width: larghezzaTesto, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#666666');
      doc.text('Ore dovute di ogni mese per un tempo pieno (100%), in ore:minuti.', {
        width: larghezzaTesto,
        align: 'center',
      });
      doc.moveDown(1.2);

      let y = drawRow(doc.y, 'Mese', 'Ore dovute', {
        font: 'Helvetica-Bold',
        fill: '#333333',
        testo: '#ffffff',
      });

      dati.mesi.forEach((m, i) => {
        y = drawRow(
          y,
          NOMI_MESI[m.mese - 1] ?? String(m.mese),
          m.minuti === null ? 'non impostato' : formatOre(m.minuti),
          {
            fill: i % 2 === 0 ? '#f5f5f5' : undefined,
            testo: m.minuti === null ? AMBRA : undefined,
          }
        );
      });

      const r = riepilogo(dati);
      y = drawRow(y, 'Somma dei mesi', formatOre(r.sommaMesi), { font: 'Helvetica-Bold', fill: '#e5e5e5' });
      y = drawRow(
        y,
        'Ore annue',
        dati.minutiAnnui === null ? 'non impostate' : formatOre(dati.minutiAnnui),
        { font: 'Helvetica-Bold', fill: '#e5e5e5' }
      );

      doc.font('Helvetica').fontSize(10).fillColor(r.scarto === 0 ? VERDE : AMBRA);
      doc.text(r.esito, PDF_MARGIN, y + 12, { width: larghezzaTesto, align: 'center' });
      if (r.mesiImpostati < 12) {
        doc.fillColor(AMBRA).text(
          `${12 - r.mesiImpostati} ${12 - r.mesiImpostati === 1 ? 'mese non impostato' : 'mesi non impostati'}.`,
          { width: larghezzaTesto, align: 'center' }
        );
      }

      doc.end();
    });
  }

  async generaExcel(dati: OreDovuteAnno, anno: number): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GicaTask';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(`Ore dovute ${anno}`);

    worksheet.mergeCells('A1:C1');
    worksheet.getCell('A1').value = `ORE DOVUTE ${anno}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:C2');
    worksheet.getCell('A2').value =
      'Tempo pieno (100%). Ore decimali: 172,20 = 172:12.';
    worksheet.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF666666' } };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    const headerRow = worksheet.addRow(['Mese', 'Ore (ore:minuti)', 'Ore decimali']);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
    applyGrid(headerRow);

    worksheet.columns = [{ width: 18 }, { width: 18 }, { width: 14 }];

    // Il testo ore:minuti allineato a destra come un numero
    const formatta = (row: ExcelJS.Row) => {
      row.getCell(2).alignment = { horizontal: 'right' };
      row.getCell(3).numFmt = '0.00';
      applyGrid(row);
    };

    dati.mesi.forEach((m) => {
      const row = worksheet.addRow([
        NOMI_MESI[m.mese - 1] ?? String(m.mese),
        m.minuti === null ? 'non impostato' : formatOre(m.minuti),
        m.minuti === null ? null : oreDecimali(m.minuti),
      ]);
      formatta(row);
      if (m.minuti === null) row.getCell(2).font = { color: { argb: 'FFB45309' } };
    });

    const r = riepilogo(dati);
    const sommaRow = worksheet.addRow(['Somma dei mesi', formatOre(r.sommaMesi), oreDecimali(r.sommaMesi)]);
    sommaRow.font = { bold: true };
    formatta(sommaRow);

    const annueRow = worksheet.addRow([
      'Ore annue',
      dati.minutiAnnui === null ? 'non impostate' : formatOre(dati.minutiAnnui),
      dati.minutiAnnui === null ? null : oreDecimali(dati.minutiAnnui),
    ]);
    annueRow.font = { bold: true };
    formatta(annueRow);

    worksheet.addRow([]);
    const esitoRow = worksheet.addRow([r.esito]);
    worksheet.mergeCells(`A${esitoRow.number}:C${esitoRow.number}`);
    esitoRow.getCell(1).font = { bold: true, color: { argb: r.scarto === 0 ? 'FF15803D' : 'FFB45309' } };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
