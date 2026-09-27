import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type { OreDovuteAnno, RigaProspetto } from './oreDovute.service.js';
import { nomeFoglio } from '../utils/nomeFoglioExcel.js';
import { righeRiepilogoOre } from '../utils/righeRiepilogoOre.js';
import type { RiepilogoOre } from '../utils/righeRiepilogoOre.js';

/**
 * Ore del periodo trascorso per dipendente, per le righe di riepilogo in fondo
 * al dettaglio: `etichetta` e' il periodo, come "gennaio-settembre 2026".
 * Assente per un anno futuro, in cui non c'e' ancora niente da confrontare.
 */
export interface RiepiloghiPeriodo {
  etichetta: string;
  perUtente: Map<number, RiepilogoOre>;
}

const NOMI_MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/**
 * Le percentuali dell'anno in breve: "80%" se non cambiano, altrimenti i
 * tratti consecutivi, "gen-giu 80%, lug-dic 60%". Vuoto per un tempo pieno
 * tutto l'anno, il caso piu' comune, che non ha bisogno di nota.
 */
function descriviPercentuali(percentuali: number[]): string {
  const tratti: { da: number; a: number; percentuale: number }[] = [];
  percentuali.forEach((p, i) => {
    const ultimo = tratti[tratti.length - 1];
    if (ultimo && ultimo.percentuale === p) ultimo.a = i;
    else tratti.push({ da: i, a: i, percentuale: p });
  });

  if (tratti.length === 1) {
    const unico = tratti[0] as { percentuale: number };
    return unico.percentuale === 100 ? '' : `${unico.percentuale}%`;
  }

  return tratti
    .map((t) =>
      t.da === t.a
        ? `${MESI_BREVI[t.da]} ${t.percentuale}%`
        : `${MESI_BREVI[t.da]}-${MESI_BREVI[t.a]} ${t.percentuale}%`
    )
    .join(', ');
}

/** Minuti per mese sommati su tutte le righe; `null` dove il mese non e' impostato. */
function totaliProspetto(righe: RigaProspetto[], dati: OreDovuteAnno): (number | null)[] {
  return dati.mesi.map((m, i) =>
    m.minuti === null ? null : righe.reduce((tot, r) => tot + (r.minuti[i] ?? 0), 0)
  );
}

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

/**
 * Prospetto per dipendente su A4 orizzontale: 842pt meno i margini fa 792pt,
 * nome 150 + 12 mesi da 48 + totale 66.
 */
const LAND_WIDTH = 842;
const LAND_HEIGHT = 595;
const P_COL_NOME = 150;
const P_COL_MESE = 48;
const P_COL_TOTALE = 66;
const P_TABLE_WIDTH = P_COL_NOME + P_COL_MESE * 12 + P_COL_TOTALE;
const P_FONT = 8;
const P_FONT_NOTA = 6.5;
const P_PAD = 3;
const P_MIN_ROW = 15;

/**
 * Pagina per dipendente, A4 verticale: 545pt di tabella. Dodici righe al
 * massimo, quindi una pagina basta sempre.
 */
const D_COLUMNS: { header: string; width: number }[] = [
  { header: 'Mese', width: 160 },
  { header: 'Ore a tempo pieno', width: 130 },
  { header: '% lavoro', width: 100 },
  { header: 'Ore dovute', width: 155 },
];
const D_TABLE_WIDTH = D_COLUMNS.reduce((tot, col) => tot + col.width, 0);

export class OreDovuteExportService {
  async generaPdf(
    dati: OreDovuteAnno,
    prospetto: RigaProspetto[],
    anno: number,
    riepiloghi?: RiepiloghiPeriodo
  ): Promise<Buffer> {
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

      this.disegnaProspetto(doc, dati, prospetto, anno);
      this.disegnaDipendenti(doc, dati, prospetto, anno, riepiloghi);

      doc.end();
    });
  }

  /** Pagine orizzontali con una riga per dipendente e una colonna per mese. */
  /**
   * Una pagina per dipendente dopo il prospetto: per ogni mese le ore a tempo
   * pieno, la percentuale in vigore e le ore dovute che ne risultano.
   */
  private disegnaDipendenti(
    doc: PDFKit.PDFDocument,
    dati: OreDovuteAnno,
    righe: RigaProspetto[],
    anno: number,
    riepiloghi?: RiepiloghiPeriodo
  ): void {
    const riga = (
      y: number,
      testi: string[],
      stile: { font?: string; fill?: string; colore?: string; colori?: (string | undefined)[] } = {}
    ): number => {
      if (stile.fill) doc.rect(PDF_MARGIN, y, D_TABLE_WIDTH, ROW_HEIGHT).fill(stile.fill);
      doc.font(stile.font ?? 'Helvetica').fontSize(FONT_SIZE);

      let x = PDF_MARGIN;
      D_COLUMNS.forEach((col, i) => {
        doc.fillColor(stile.colore ?? stile.colori?.[i] ?? '#000000');
        doc.text(testi[i] ?? '', x + CELL_PAD_X, y + CELL_PAD_Y, {
          width: col.width - CELL_PAD_X * 2,
          align: i === 0 ? 'left' : 'right',
          lineBreak: false,
        });
        x += col.width;
      });

      doc.lineWidth(0.5).strokeColor(GRID_COLOR);
      x = PDF_MARGIN;
      D_COLUMNS.forEach((col) => {
        doc.rect(x, y, col.width, ROW_HEIGHT).stroke();
        x += col.width;
      });
      return y + ROW_HEIGHT;
    };

    righe.forEach((r) => {
      doc.addPage({ size: 'A4', margin: PDF_MARGIN });

      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000');
      doc.text(r.utenteNome, PDF_MARGIN, PDF_MARGIN, { width: D_TABLE_WIDTH, align: 'center' });
      doc.font('Helvetica').fontSize(10).fillColor('#333333');
      doc.text(`Ore dovute ${anno}`, { width: D_TABLE_WIDTH, align: 'center' });
      doc.fontSize(8).fillColor('#666666');
      doc.text('Ore a tempo pieno del mese x percentuale di lavoro in vigore nel mese.', {
        width: D_TABLE_WIDTH,
        align: 'center',
      });
      doc.moveDown(0.8);

      let y = riga(doc.y, D_COLUMNS.map((col) => col.header), {
        font: 'Helvetica-Bold',
        fill: '#333333',
        colore: '#ffffff',
      });

      dati.mesi.forEach((m, i) => {
        const impostato = m.minuti !== null;
        const dovuti = r.minuti[i];
        y = riga(
          y,
          [
            NOMI_MESI[m.mese - 1] ?? String(m.mese),
            impostato ? formatOre(m.minuti as number) : 'non impostato',
            `${r.percentuali[i] ?? 100}%`,
            dovuti == null ? '-' : formatOre(dovuti),
          ],
          {
            fill: i % 2 === 0 ? '#f5f5f5' : undefined,
            colori: impostato ? undefined : [AMBRA, AMBRA, undefined, AMBRA],
          }
        );
      });

      y = riga(
        y,
        ['TOTALE', formatOre(riepilogo(dati).sommaMesi), '', formatOre(r.totale)],
        { font: 'Helvetica-Bold', fill: '#e5e5e5' }
      );

      // Riepilogo del periodo trascorso, con le righe del Report Attivita'.
      // Etichetta sulle prime tre colonne, valore sotto le ore dovute
      const ore = riepiloghi?.perUtente.get(r.utenteId);
      if (!riepiloghi || !ore) return;

      y += 12;
      doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#000000');
      doc.text(`Riepilogo ${riepiloghi.etichetta}`, PDF_MARGIN, y);
      y += ROW_HEIGHT;

      const larghezzaValore = (D_COLUMNS[D_COLUMNS.length - 1] as { width: number }).width;
      const larghezzaEtichetta = D_TABLE_WIDTH - larghezzaValore;
      righeRiepilogoOre(ore, 'TOTALE ORE').forEach(({ etichetta, minuti, saldo }) => {
        doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#000000');
        doc.text(etichetta, PDF_MARGIN + CELL_PAD_X, y + CELL_PAD_Y, { lineBreak: false });
        doc.fillColor(saldo ? (minuti > 0 ? VERDE : minuti < 0 ? '#dc2626' : '#000000') : '#000000');
        doc.text(saldo && minuti > 0 ? `+${formatOre(minuti)}` : formatOre(minuti), PDF_MARGIN + larghezzaEtichetta + CELL_PAD_X, y + CELL_PAD_Y, {
          width: larghezzaValore - CELL_PAD_X * 2,
          align: 'right',
          lineBreak: false,
        });
        doc.lineWidth(0.5).strokeColor(GRID_COLOR);
        doc.rect(PDF_MARGIN, y, larghezzaEtichetta, ROW_HEIGHT).stroke();
        doc.rect(PDF_MARGIN + larghezzaEtichetta, y, larghezzaValore, ROW_HEIGHT).stroke();
        y += ROW_HEIGHT;
      });
    });
  }

  private disegnaProspetto(
    doc: PDFKit.PDFDocument,
    dati: OreDovuteAnno,
    righe: RigaProspetto[],
    anno: number
  ): void {
    const bottom = LAND_HEIGHT - PDF_MARGIN;
    const colonne = [P_COL_NOME, ...Array(12).fill(P_COL_MESE), P_COL_TOTALE] as number[];

    const griglia = (y: number, h: number) => {
      doc.lineWidth(0.5).strokeColor(GRID_COLOR);
      let x = PDF_MARGIN;
      colonne.forEach((w) => {
        doc.rect(x, y, w, h).stroke();
        x += w;
      });
    };

    // Celle numeriche di una riga, dodici mesi e totale, con il testo a `yTesto`
    const valori = (yTesto: number, testi: string[], colori?: (string | undefined)[]) => {
      let x = PDF_MARGIN + P_COL_NOME;
      testi.forEach((t, i) => {
        const w = colonne[i + 1] as number;
        doc.fillColor(colori?.[i] ?? '#000000');
        doc.text(t, x + P_PAD, yTesto, { width: w - P_PAD * 2, align: 'right', lineBreak: false });
        x += w;
      });
    };

    const intestazione = (y: number): number => {
      doc.rect(PDF_MARGIN, y, P_TABLE_WIDTH, P_MIN_ROW).fill('#333333');
      doc.font('Helvetica-Bold').fontSize(P_FONT).fillColor('#ffffff');
      doc.text('Dipendente', PDF_MARGIN + P_PAD, y + P_PAD + 1, {
        width: P_COL_NOME - P_PAD * 2,
        lineBreak: false,
      });
      valori(y + P_PAD + 1, [...MESI_BREVI.map((m) => m.charAt(0).toUpperCase() + m.slice(1)), 'Totale'], Array(13).fill('#ffffff'));
      griglia(y, P_MIN_ROW);
      return y + P_MIN_ROW;
    };

    doc.addPage({ size: 'A4', layout: 'landscape', margin: PDF_MARGIN });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000');
    doc.text(`Ore Dovute ${anno} - Prospetto per dipendente`, PDF_MARGIN, PDF_MARGIN, {
      width: LAND_WIDTH - PDF_MARGIN * 2,
      align: 'center',
    });
    doc.font('Helvetica').fontSize(8).fillColor('#666666');
    doc.text(
      'Ore a tempo pieno del mese x percentuale di lavoro in vigore nel mese. "-" = mese non impostato.',
      { width: LAND_WIDTH - PDF_MARGIN * 2, align: 'center' }
    );
    doc.moveDown(0.8);

    let y = intestazione(doc.y);

    righe.forEach((riga, index) => {
      const nota = descriviPercentuali(riga.percentuali);
      doc.font('Helvetica').fontSize(P_FONT);
      const hNome = doc.heightOfString(riga.utenteNome, { width: P_COL_NOME - P_PAD * 2 });
      doc.fontSize(P_FONT_NOTA);
      const hNota = nota ? doc.heightOfString(nota, { width: P_COL_NOME - P_PAD * 2 }) : 0;
      const h = Math.max(P_MIN_ROW, hNome + hNota + P_PAD * 2);

      if (y + h > bottom) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: PDF_MARGIN });
        y = intestazione(PDF_MARGIN);
      }

      if (index % 2 === 0) doc.rect(PDF_MARGIN, y, P_TABLE_WIDTH, h).fill('#f5f5f5');

      doc.font('Helvetica').fontSize(P_FONT).fillColor('#000000');
      doc.text(riga.utenteNome, PDF_MARGIN + P_PAD, y + P_PAD, { width: P_COL_NOME - P_PAD * 2 });
      if (nota) {
        doc.fontSize(P_FONT_NOTA).fillColor('#666666');
        doc.text(nota, PDF_MARGIN + P_PAD, y + P_PAD + hNome, { width: P_COL_NOME - P_PAD * 2 });
      }

      doc.font('Helvetica').fontSize(P_FONT);
      valori(y + P_PAD, [...riga.minuti.map((m) => (m === null ? '-' : formatOre(m))), formatOre(riga.totale)]);
      griglia(y, h);
      y += h;
    });

    if (y + P_MIN_ROW > bottom) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: PDF_MARGIN });
      y = intestazione(PDF_MARGIN);
    }

    const totali = totaliProspetto(righe, dati);
    doc.rect(PDF_MARGIN, y, P_TABLE_WIDTH, P_MIN_ROW).fill('#e5e5e5');
    doc.font('Helvetica-Bold').fontSize(P_FONT).fillColor('#000000');
    doc.text('TOTALE', PDF_MARGIN + P_PAD, y + P_PAD, { width: P_COL_NOME - P_PAD * 2, lineBreak: false });
    valori(y + P_PAD, [
      ...totali.map((m) => (m === null ? '-' : formatOre(m))),
      formatOre(righe.reduce((tot, r) => tot + r.totale, 0)),
    ]);
    griglia(y, P_MIN_ROW);
  }

  async generaExcel(
    dati: OreDovuteAnno,
    prospetto: RigaProspetto[],
    anno: number,
    riepiloghi?: RiepiloghiPeriodo
  ): Promise<Buffer> {
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

    this.foglioProspetto(workbook, dati, prospetto, anno);
    this.fogliDipendenti(workbook, dati, prospetto, anno, riepiloghi);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Secondo foglio: una riga per dipendente, ore decimali per poterle sommare. */
  private foglioProspetto(
    workbook: ExcelJS.Workbook,
    dati: OreDovuteAnno,
    righe: RigaProspetto[],
    anno: number
  ): void {
    const ws = workbook.addWorksheet('Per dipendente', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const ultimaColonna = 'O'; // Dipendente, Percentuale, 12 mesi, Totale

    ws.mergeCells(`A1:${ultimaColonna}1`);
    ws.getCell('A1').value = `ORE DOVUTE ${anno} - PER DIPENDENTE`;
    ws.getCell('A1').font = { size: 16, bold: true };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.mergeCells(`A2:${ultimaColonna}2`);
    ws.getCell('A2').value =
      'Ore decimali (172,20 = 172:12): ore a tempo pieno del mese x percentuale in vigore nel mese. Cella vuota = mese non impostato.';
    ws.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF666666' } };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    ws.addRow([]);

    const mesi = MESI_BREVI.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
    const header = ws.addRow(['Dipendente', 'Percentuale', ...mesi, 'Totale']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };

    ws.columns = [{ width: 28 }, { width: 24 }, ...Array(12).fill({ width: 9 }), { width: 11 }];

    const bordi = (row: ExcelJS.Row) => {
      for (let i = 1; i <= 15; i++) {
        row.getCell(i).border = GRID_BORDER;
        if (i >= 3) row.getCell(i).numFmt = '0.00';
      }
    };
    bordi(header);

    righe.forEach((r) => {
      const row = ws.addRow([
        r.utenteNome,
        descriviPercentuali(r.percentuali) || '100%',
        ...r.minuti.map((m) => (m === null ? null : oreDecimali(m))),
        oreDecimali(r.totale),
      ]);
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      bordi(row);
    });

    const totali = totaliProspetto(righe, dati);
    const totaliRow = ws.addRow([
      'TOTALE',
      null,
      ...totali.map((m) => (m === null ? null : oreDecimali(m))),
      oreDecimali(righe.reduce((tot, r) => tot + r.totale, 0)),
    ]);
    totaliRow.font = { bold: true };
    bordi(totaliRow);

    // Nome e intestazione restano visibili scorrendo
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: header.number }];
  }

  /**
   * Un foglio per dipendente dopo *Per dipendente*, come le pagine del PDF:
   * per ogni mese le ore a tempo pieno, la percentuale in vigore e le ore
   * dovute, in decimali per i calcoli e in ore:minuti per la lettura.
   */
  private fogliDipendenti(
    workbook: ExcelJS.Workbook,
    dati: OreDovuteAnno,
    righe: RigaProspetto[],
    anno: number,
    riepiloghi?: RiepiloghiPeriodo
  ): void {
    const usati = new Set([`ore dovute ${anno}`, 'per dipendente']);
    const colonne = 5;

    righe.forEach((r) => {
      const ws = workbook.addWorksheet(nomeFoglio(r.utenteNome, usati));

      const titolo = ws.addRow([`${r.utenteNome.toUpperCase()} - ORE DOVUTE ${anno}`]);
      ws.mergeCells(titolo.number, 1, titolo.number, colonne);
      titolo.getCell(1).font = { size: 14, bold: true };

      const nota = ws.addRow([
        'Ore a tempo pieno del mese x percentuale di lavoro in vigore nel mese. ' +
          'Ore decimali: 172,20 = 172:12. Cella vuota = mese non impostato.',
      ]);
      ws.mergeCells(nota.number, 1, nota.number, colonne);
      nota.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF666666' } };

      ws.addRow([]);

      const header = ws.addRow([
        'Mese',
        'Ore a tempo pieno',
        '% lavoro',
        'Ore dovute',
        'Ore dovute (ore:minuti)',
      ]);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };

      ws.columns = [{ width: 14 }, { width: 18 }, { width: 10 }, { width: 13 }, { width: 22 }];

      const formatta = (row: ExcelJS.Row) => {
        row.getCell(2).numFmt = '0.00';
        row.getCell(3).numFmt = '0"%"';
        row.getCell(4).numFmt = '0.00';
        row.getCell(5).alignment = { horizontal: 'right' };
        for (let i = 1; i <= colonne; i++) row.getCell(i).border = GRID_BORDER;
      };
      formatta(header);

      dati.mesi.forEach((m, i) => {
        const dovuti = r.minuti[i];
        const row = ws.addRow([
          NOMI_MESI[m.mese - 1] ?? String(m.mese),
          m.minuti === null ? null : oreDecimali(m.minuti),
          r.percentuali[i] ?? 100,
          dovuti == null ? null : oreDecimali(dovuti),
          dovuti == null ? 'non impostato' : formatOre(dovuti),
        ]);
        formatta(row);
        if (m.minuti === null) {
          row.getCell(1).font = { color: { argb: 'FFB45309' } };
          row.getCell(5).font = { color: { argb: 'FFB45309' } };
        }
      });

      const sommaMesi = riepilogo(dati).sommaMesi;
      const totale = ws.addRow([
        'TOTALE',
        oreDecimali(sommaMesi),
        null,
        oreDecimali(r.totale),
        formatOre(r.totale),
      ]);
      totale.font = { bold: true };
      formatta(totale);

      // Riepilogo del periodo trascorso, con le righe del Report Attivita'.
      // Etichetta su A-C unite, valore decimale e in ore:minuti come sopra
      const ore = riepiloghi?.perUtente.get(r.utenteId);
      if (riepiloghi && ore) {
        ws.addRow([]);
        ws.addRow([`Riepilogo ${riepiloghi.etichetta}`]).font = { bold: true };

        righeRiepilogoOre(ore, 'TOTALE ORE').forEach(({ etichetta, minuti, saldo }) => {
          const row = ws.addRow([
            etichetta,
            null,
            null,
            oreDecimali(minuti),
            saldo && minuti > 0 ? `+${formatOre(minuti)}` : formatOre(minuti),
          ]);
          ws.mergeCells(row.number, 1, row.number, 3);
          row.font = { bold: true };
          row.getCell(4).numFmt = saldo ? '[Color10]+0.00;[Red]-0.00;0.00' : '0.00';
          row.getCell(5).alignment = { horizontal: 'right' };
          for (let i = 1; i <= colonne; i++) row.getCell(i).border = GRID_BORDER;
        });
      }

      ws.views = [{ state: 'frozen', ySplit: header.number }];
    });
  }
}
