import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type { MeseSaldoOre, RigaSaldoOre, SaldiOreMese } from './saldiOre.service.js';
import { nomeFoglio } from '../utils/nomeFoglioExcel.js';
import { righeRiepilogoOre } from '../utils/righeRiepilogoOre.js';

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
const AMBRA_PDF = '#b45309';

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

const MESI_BREVI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

/**
 * Intestazioni dei mesi del prospetto, da gennaio a quello scelto. Un mese
 * senza ore dovute ha l'asterisco: la sua differenza e' gonfiata.
 */
function intestazioniMesi(dati: SaldiOreMese, meseKey: string): string[] {
  const mesi = Number(meseKey.slice(5, 7));
  return MESI_BREVI.slice(0, mesi).map((m, i) =>
    dati.mesiSenzaOreDovute.includes(i + 1) ? `${m}*` : m
  );
}

/** Differenze di tutte le righe sommate mese per mese. */
function totaliMensili(righe: RigaSaldoOre[], mesi: number): number[] {
  return Array.from({ length: mesi }, (_, i) =>
    righe.reduce((tot, r) => tot + (r.differenzeMensili[i] ?? 0), 0)
  );
}

const NOTA_PROSPETTO =
  'Differenza di ogni mese (ore effettuate - ore dovute); l\'ultima colonna e\' il saldo cumulativo.';
const NOTA_ASTERISCO = '* ore dovute non impostate: in quel mese valgono zero.';

/**
 * Prospetto su A4 orizzontale: 792pt utili, nome 150, saldo 70 e fino a
 * dodici mesi da 47. Con meno mesi la tabella si accorcia.
 */
const LAND_WIDTH = 842;
const LAND_HEIGHT = 595;
const P_COL_NOME = 150;
const P_COL_MESE = 47;
const P_COL_SALDO = 70;
const P_ROW = 15;
const P_FONT = 8;
const P_PAD = 3;

/**
 * Pagina per dipendente, A4 verticale: le larghezze sommano a 545 come nella
 * tabella del mese. Al massimo dodici mesi, quindi una pagina basta sempre.
 */
const D_COLUMNS: { header: string; width: number }[] = [
  { header: 'Mese', width: 100 },
  { header: '% lavoro', width: 60 },
  { header: 'Ore dovute', width: 95 },
  { header: 'Ore effettuate', width: 95 },
  { header: 'Differenza', width: 90 },
  { header: 'Saldo progressivo', width: 105 },
];
const D_TABLE_WIDTH = D_COLUMNS.reduce((tot, col) => tot + col.width, 0);

function riepilogoDelMese(m: MeseSaldoOre) {
  return { totaleMinuti: m.totaleMinuti, dovutiMinuti: m.dovutiMinuti, lavoroMinuti: m.effettuatiMinuti };
}

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
        doc.moveDown(0.3).fillColor(AMBRA_PDF).text(avviso, { width: TABLE_WIDTH, align: 'center' });
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

      this.disegnaProspetto(doc, dati, meseKey);
      this.disegnaDipendenti(doc, dati, meseKey);

      doc.end();
    });
  }

  /** Pagine orizzontali: una riga per dipendente, differenza di ogni mese e saldo. */
  /**
   * Una pagina per dipendente dopo il prospetto, come i fogli dell'Excel: una
   * riga per mese da gennaio con percentuale, ore dovute ed effettuate,
   * differenza e saldo progressivo. L'ultimo saldo e' quello del report.
   */
  private disegnaDipendenti(doc: PDFKit.PDFDocument, dati: SaldiOreMese, meseKey: string): void {
    const anno = meseKey.slice(0, 4);

    const riga = (
      y: number,
      testi: string[],
      stile: { font?: string; fill?: string; colore?: string; segni?: (number | undefined)[] } = {}
    ): number => {
      if (stile.fill) doc.rect(PDF_MARGIN, y, D_TABLE_WIDTH, ROW_HEIGHT).fill(stile.fill);
      doc.font(stile.font ?? 'Helvetica').fontSize(FONT_SIZE);

      let x = PDF_MARGIN;
      D_COLUMNS.forEach((col, i) => {
        const segno = stile.segni?.[i];
        doc.fillColor(stile.colore ?? (segno === undefined ? '#000000' : coloreSegno(segno)));
        doc.text(testi[i] ?? '', x + CELL_PAD_X, y + CELL_PAD_Y, {
          width: col.width - CELL_PAD_X * 2,
          align: i === 0 ? 'left' : 'right',
          lineBreak: false,
        });
        x += col.width;
      });

      doc.lineWidth(GRID_LINE_WIDTH).strokeColor(GRID_COLOR);
      x = PDF_MARGIN;
      D_COLUMNS.forEach((col) => {
        doc.rect(x, y, col.width, ROW_HEIGHT).stroke();
        x += col.width;
      });
      return y + ROW_HEIGHT;
    };

    dati.righe.forEach((r) => {
      doc.addPage({ size: 'A4', margin: PDF_MARGIN });

      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000');
      doc.text(r.utenteNome, PDF_MARGIN, PDF_MARGIN, { width: D_TABLE_WIDTH, align: 'center' });
      doc.font('Helvetica').fontSize(10).fillColor('#333333');
      doc.text(`Saldi Ore ${anno} - da gennaio a ${titoloMese(meseKey).toLowerCase()}`, {
        width: D_TABLE_WIDTH,
        align: 'center',
      });
      doc.fontSize(8).fillColor('#666666');
      doc.text('Ore effettuate senza assenze. % lavoro in vigore nel mese.', {
        width: D_TABLE_WIDTH,
        align: 'center',
      });
      if (dati.mesiSenzaOreDovute.length > 0) {
        doc.fillColor(AMBRA_PDF).text(NOTA_ASTERISCO, { width: D_TABLE_WIDTH, align: 'center' });
      }
      doc.moveDown(0.8);

      let y = riga(doc.y, D_COLUMNS.map((col) => col.header), {
        font: 'Helvetica-Bold',
        fill: '#333333',
        colore: '#ffffff',
      });

      // Somma delle differenze arrotondate al minuto, come il report
      let saldo = 0;
      r.mensili.forEach((m, index) => {
        saldo += m.differenzaMinuti;
        const senzaDovute = dati.mesiSenzaOreDovute.includes(m.mese);
        y = riga(
          y,
          [
            `${NOMI_MESI[m.mese - 1]}${senzaDovute ? '*' : ''}`,
            `${m.percentuale}%`,
            formatDurata(m.dovutiMinuti),
            formatDurata(m.effettuatiMinuti),
            formatSaldo(m.differenzaMinuti),
            formatSaldo(saldo),
          ],
          {
            fill: index % 2 === 0 ? '#f5f5f5' : undefined,
            segni: [undefined, undefined, undefined, undefined, m.differenzaMinuti, saldo],
          }
        );
      });

      riga(
        y,
        [
          'TOTALE',
          '',
          formatDurata(r.mensili.reduce((t, m) => t + m.dovutiMinuti, 0)),
          formatDurata(r.mensili.reduce((t, m) => t + m.effettuatiMinuti, 0)),
          formatSaldo(r.saldoCumulativoMinuti),
          formatSaldo(r.saldoCumulativoMinuti),
        ],
        {
          font: 'Helvetica-Bold',
          fill: '#e5e5e5',
          segni: [undefined, undefined, undefined, undefined, r.saldoCumulativoMinuti, r.saldoCumulativoMinuti],
        }
      );

      // Riepilogo del mese scelto, con le righe del Report Attivita'
      const ultimo = r.mensili[r.mensili.length - 1];
      if (!ultimo) return;

      y += ROW_HEIGHT + 12;
      doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#000000');
      doc.text(`Riepilogo di ${titoloMese(meseKey).toLowerCase()}`, PDF_MARGIN, y);
      y += ROW_HEIGHT;

      const larghezzaEtichetta = D_TABLE_WIDTH - (D_COLUMNS[D_COLUMNS.length - 1] as { width: number }).width;
      const larghezzaValore = D_TABLE_WIDTH - larghezzaEtichetta;
      righeRiepilogoOre(riepilogoDelMese(ultimo)).forEach(({ etichetta, minuti, saldo }) => {
        doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#000000');
        doc.text(etichetta, PDF_MARGIN + CELL_PAD_X, y + CELL_PAD_Y, { lineBreak: false });
        doc.fillColor(saldo ? coloreSegno(minuti) : '#000000');
        doc.text(saldo ? formatSaldo(minuti) : formatDurata(minuti), PDF_MARGIN + larghezzaEtichetta + CELL_PAD_X, y + CELL_PAD_Y, {
          width: larghezzaValore - CELL_PAD_X * 2,
          align: 'right',
          lineBreak: false,
        });
        doc.lineWidth(GRID_LINE_WIDTH).strokeColor(GRID_COLOR);
        doc.rect(PDF_MARGIN, y, larghezzaEtichetta, ROW_HEIGHT).stroke();
        doc.rect(PDF_MARGIN + larghezzaEtichetta, y, larghezzaValore, ROW_HEIGHT).stroke();
        y += ROW_HEIGHT;
      });
    });
  }

  private disegnaProspetto(doc: PDFKit.PDFDocument, dati: SaldiOreMese, meseKey: string): void {
    const intestazioni = intestazioniMesi(dati, meseKey);
    const mesi = intestazioni.length;
    const colonne = [P_COL_NOME, ...Array(mesi).fill(P_COL_MESE), P_COL_SALDO] as number[];
    const larghezza = colonne.reduce((tot, w) => tot + w, 0);
    const bottom = LAND_HEIGHT - PDF_MARGIN;
    const nuovaPagina = () => doc.addPage({ size: 'A4', layout: 'landscape', margin: PDF_MARGIN });

    // Testi di una riga; `segni` colora le celle numeriche come nel resto del report
    const riga = (
      y: number,
      testi: string[],
      stile: { font?: string; fill?: string; colore?: string; segni?: (number | undefined)[] } = {}
    ): number => {
      if (stile.fill) doc.rect(PDF_MARGIN, y, larghezza, P_ROW).fill(stile.fill);
      doc.font(stile.font ?? 'Helvetica').fontSize(P_FONT);

      let x = PDF_MARGIN;
      testi.forEach((t, i) => {
        const w = colonne[i] as number;
        const segno = stile.segni?.[i];
        doc.fillColor(stile.colore ?? (segno === undefined ? '#000000' : coloreSegno(segno)));
        // Un valore piu' largo della colonna ("+283h 24m" in grassetto) pdfkit
        // lo manderebbe a capo sullo spazio, fuori dalla cella: si rimpicciolisce
        // il carattere della sola cella. Il nome resta com'e', coi puntini
        let size = P_FONT;
        doc.fontSize(size);
        while (i > 0 && size > 5 && doc.widthOfString(t) > w - P_PAD * 2) {
          size -= 0.5;
          doc.fontSize(size);
        }
        doc.text(t, x + P_PAD, y + P_PAD + 1 + (P_FONT - size) / 2, {
          width: w - P_PAD * 2,
          align: i === 0 ? 'left' : 'right',
          lineBreak: false,
          ellipsis: true,
        });
        x += w;
      });

      doc.lineWidth(GRID_LINE_WIDTH).strokeColor(GRID_COLOR);
      x = PDF_MARGIN;
      colonne.forEach((w) => {
        doc.rect(x, y, w, P_ROW).stroke();
        x += w;
      });
      return y + P_ROW;
    };

    const intestazione = (y: number) =>
      riga(y, ['Dipendente', ...intestazioni, 'Saldo'], {
        font: 'Helvetica-Bold',
        fill: '#333333',
        colore: '#ffffff',
      });

    nuovaPagina();
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000');
    doc.text(
      `Saldi Ore - Prospetto gennaio-${titoloMese(meseKey).toLowerCase()}`,
      PDF_MARGIN,
      PDF_MARGIN,
      { width: LAND_WIDTH - PDF_MARGIN * 2, align: 'center' }
    );
    doc.font('Helvetica').fontSize(8).fillColor('#666666');
    doc.text(NOTA_PROSPETTO, { width: LAND_WIDTH - PDF_MARGIN * 2, align: 'center' });
    if (dati.mesiSenzaOreDovute.length > 0) {
      doc.fillColor(AMBRA_PDF).text(NOTA_ASTERISCO, { width: LAND_WIDTH - PDF_MARGIN * 2, align: 'center' });
    }
    doc.moveDown(0.8);

    let y = intestazione(doc.y);

    dati.righe.forEach((r, index) => {
      if (y + P_ROW > bottom) {
        nuovaPagina();
        y = intestazione(PDF_MARGIN);
      }
      const segni = [undefined, ...r.differenzeMensili, r.saldoCumulativoMinuti];
      y = riga(
        y,
        [nomeConPercentuale(r), ...r.differenzeMensili.map(formatSaldo), formatSaldo(r.saldoCumulativoMinuti)],
        { fill: index % 2 === 0 ? '#f5f5f5' : undefined, segni }
      );
    });

    if (y + P_ROW > bottom) {
      nuovaPagina();
      y = intestazione(PDF_MARGIN);
    }

    const totali = totaliMensili(dati.righe, mesi);
    const saldo = dati.righe.reduce((tot, r) => tot + r.saldoCumulativoMinuti, 0);
    riga(y, ['TOTALE', ...totali.map(formatSaldo), formatSaldo(saldo)], {
      font: 'Helvetica-Bold',
      fill: '#e5e5e5',
      segni: [undefined, ...totali, saldo],
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

    this.foglioProspetto(workbook, dati, meseKey);
    this.fogliDipendenti(workbook, dati, meseKey);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Secondo foglio: differenza di ogni mese da gennaio e saldo, in ore decimali. */
  private foglioProspetto(workbook: ExcelJS.Workbook, dati: SaldiOreMese, meseKey: string): void {
    const intestazioni = intestazioniMesi(dati, meseKey);
    const mesi = intestazioni.length;
    const colonne = mesi + 2;

    const ws = workbook.addWorksheet('Prospetto', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    const titolo = ws.addRow([`SALDI ORE - PROSPETTO GENNAIO-${titoloMese(meseKey).toUpperCase()}`]);
    ws.mergeCells(titolo.number, 1, titolo.number, colonne);
    titolo.getCell(1).font = { size: 16, bold: true };
    titolo.getCell(1).alignment = { horizontal: 'center' };

    const note = [
      `Ore decimali (8,50 = 8h 30m). ${NOTA_PROSPETTO}`,
      ...(dati.mesiSenzaOreDovute.length > 0 ? [NOTA_ASTERISCO] : []),
    ];
    note.forEach((testo, i) => {
      const row = ws.addRow([testo]);
      ws.mergeCells(row.number, 1, row.number, colonne);
      row.getCell(1).font = i === 0
        ? { size: 9, italic: true, color: { argb: 'FF666666' } }
        : { size: 9, bold: true, color: { argb: 'FFB45309' } };
      row.getCell(1).alignment = { horizontal: 'center' };
    });

    ws.addRow([]);

    const header = ws.addRow(['Dipendente', ...intestazioni, 'Saldo']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };

    ws.columns = [{ width: 32 }, ...Array(mesi).fill({ width: 9 }), { width: 11 }];

    const formatta = (row: ExcelJS.Row) => {
      for (let i = 1; i <= colonne; i++) {
        row.getCell(i).border = GRID_BORDER;
        if (i >= 2) row.getCell(i).numFmt = FORMATO_SALDO;
      }
    };
    formatta(header);

    dati.righe.forEach((r) => {
      formatta(
        ws.addRow([
          nomeConPercentuale(r),
          ...r.differenzeMensili.map(oreDecimali),
          oreDecimali(r.saldoCumulativoMinuti),
        ])
      );
    });

    const totaliRow = ws.addRow([
      'TOTALE',
      ...totaliMensili(dati.righe, mesi).map(oreDecimali),
      oreDecimali(dati.righe.reduce((tot, r) => tot + r.saldoCumulativoMinuti, 0)),
    ]);
    totaliRow.font = { bold: true };
    formatta(totaliRow);

    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: header.number }];
  }

  /**
   * Un foglio per dipendente, dopo i due riepiloghi: una riga per mese da
   * gennaio con percentuale, ore dovute ed effettuate, differenza e saldo
   * progressivo. L'ultimo saldo e' quello del report.
   */
  private fogliDipendenti(workbook: ExcelJS.Workbook, dati: SaldiOreMese, meseKey: string): void {
    const usati = new Set(['saldi ore', 'prospetto']);
    const anno = meseKey.slice(0, 4);
    const colonne = 6;

    dati.righe.forEach((r) => {
      const ws = workbook.addWorksheet(nomeFoglio(r.utenteNome, usati));

      const titolo = ws.addRow([`${r.utenteNome.toUpperCase()} - SALDI ORE ${anno}`]);
      ws.mergeCells(titolo.number, 1, titolo.number, colonne);
      titolo.getCell(1).font = { size: 14, bold: true };

      const nota = ws.addRow([
        `Da gennaio a ${titoloMese(meseKey).toLowerCase()}. Ore decimali (8,50 = 8h 30m). ` +
          'Ore effettuate senza assenze.',
      ]);
      ws.mergeCells(nota.number, 1, nota.number, colonne);
      nota.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF666666' } };

      if (dati.mesiSenzaOreDovute.length > 0) {
        const asterisco = ws.addRow([NOTA_ASTERISCO]);
        ws.mergeCells(asterisco.number, 1, asterisco.number, colonne);
        asterisco.getCell(1).font = { size: 9, bold: true, color: { argb: 'FFB45309' } };
      }

      ws.addRow([]);

      const header = ws.addRow([
        'Mese',
        '% lavoro',
        'Ore dovute',
        'Ore effettuate',
        'Differenza',
        'Saldo progressivo',
      ]);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };

      ws.columns = [{ width: 14 }, { width: 10 }, { width: 13 }, { width: 15 }, { width: 13 }, { width: 18 }];

      const formatta = (row: ExcelJS.Row) => {
        row.getCell(2).numFmt = '0"%"';
        row.getCell(3).numFmt = FORMATO_ORE;
        row.getCell(4).numFmt = FORMATO_ORE;
        row.getCell(5).numFmt = FORMATO_SALDO;
        row.getCell(6).numFmt = FORMATO_SALDO;
        for (let i = 1; i <= colonne; i++) row.getCell(i).border = GRID_BORDER;
      };
      formatta(header);

      // Il saldo progressivo somma le differenze arrotondate al minuto, come
      // il report: l'ultima riga coincide col saldo cumulativo
      let saldo = 0;
      r.mensili.forEach((m) => {
        saldo += m.differenzaMinuti;
        const senzaDovute = dati.mesiSenzaOreDovute.includes(m.mese);
        formatta(
          ws.addRow([
            `${NOMI_MESI[m.mese - 1]}${senzaDovute ? '*' : ''}`,
            m.percentuale,
            oreDecimali(m.dovutiMinuti),
            oreDecimali(m.effettuatiMinuti),
            oreDecimali(m.differenzaMinuti),
            oreDecimali(saldo),
          ])
        );
      });

      const totale = ws.addRow([
        'TOTALE',
        null,
        oreDecimali(r.mensili.reduce((t, m) => t + m.dovutiMinuti, 0)),
        oreDecimali(r.mensili.reduce((t, m) => t + m.effettuatiMinuti, 0)),
        oreDecimali(r.saldoCumulativoMinuti),
        oreDecimali(r.saldoCumulativoMinuti),
      ]);
      totale.font = { bold: true };
      formatta(totale);

      // Riepilogo del mese scelto, con le righe del Report Attivita'.
      // Etichetta su A-E unite, valore sotto la colonna del saldo
      const ultimo = r.mensili[r.mensili.length - 1];
      if (ultimo) {
        ws.addRow([]);
        const titoloRiepilogo = ws.addRow([`Riepilogo di ${titoloMese(meseKey).toLowerCase()}`]);
        titoloRiepilogo.font = { bold: true };

        righeRiepilogoOre(riepilogoDelMese(ultimo)).forEach(({ etichetta, minuti, saldo }) => {
          const row = ws.addRow([etichetta, null, null, null, null, oreDecimali(minuti)]);
          ws.mergeCells(row.number, 1, row.number, 5);
          row.font = { bold: true };
          row.getCell(6).numFmt = saldo ? FORMATO_SALDO : FORMATO_ORE;
          for (let i = 1; i <= colonne; i++) row.getCell(i).border = GRID_BORDER;
        });
      }

      ws.views = [{ state: 'frozen', ySplit: header.number }];
    });
  }
}
