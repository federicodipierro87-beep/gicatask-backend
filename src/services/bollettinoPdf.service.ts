import PDFDocument from 'pdfkit';
import type { TipoVoce } from '@prisma/client';

interface RigaPdf {
  tipo: TipoVoce;
  descrizione: string;
  quantita: number;
}

export interface BollettinoPdf {
  id: number;
  dataRiferimento: Date;
  attivita: string;
  numeroOperai: number;
  ore: number;
  clienteNome: string;
  cantiereNome: string;
  firmaOperatoreNome: string;
  firmaOperatoreImg: string;
  firmaCommittenteNome: string;
  firmaCommittenteImg: string;
  utente: { nome: string; cognome: string };
  righe: RigaPdf[];
}

const MARGIN = 40;
const PAGE_WIDTH = 595; // A4 verticale
const PAGE_HEIGHT = 842;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Le firme sono ancorate al fondo pagina: agganciarle a doc.y farebbe finire
// il riquadro a mezza pagina nei bollettini corti e fuori pagina in quelli lunghi
const FIRME_ALTEZZA = 110;
const FIRME_TOP = PAGE_HEIGHT - MARGIN - FIRME_ALTEZZA;

const SEZIONI: { tipo: TipoVoce; titolo: string; labelQuantita: string }[] = [
  { tipo: 'MEZZO', titolo: 'Mezzi', labelQuantita: 'Ore' },
  { tipo: 'MATERIALE', titolo: 'Materiali', labelQuantita: 'Quantità' },
  { tipo: 'TRASPORTO', titolo: 'Trasporti', labelQuantita: 'Viaggi' },
];

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('it-IT');
}

function formatNumero(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
}

/**
 * Il nome del cantiere finisce nell'header Content-Disposition: tutto ciò che
 * non è alfanumerico viene sostituito, altrimenti un nome con virgolette o
 * a capo permetterebbe di iniettare header nella risposta.
 */
export function sanitizeFilenamePart(value: string): string {
  const pulito = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return pulito || 'bollettino';
}

function labelCoppia(doc: PDFKit.PDFDocument, label: string, valore: string, x: number, y: number, width: number): void {
  doc.fontSize(8).fillColor('#666').text(label, x, y, { width });
  doc.fontSize(10).fillColor('#000').text(valore || '-', x, y + 11, { width });
}

/**
 * Il contenuto è disegnato a coordinate assolute, quindi lo spazio residuo va
 * controllato a mano: senza questo, un bollettino con molte voci scriverebbe
 * sopra le firme e oltre il bordo della pagina.
 */
function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed <= FIRME_TOP - 16) return y;

  doc.addPage();
  return MARGIN;
}

function renderSezioneVoci(
  doc: PDFKit.PDFDocument,
  titolo: string,
  labelQuantita: string,
  righe: RigaPdf[],
  y: number
): number {
  let cursor = ensureSpace(doc, y, 34);

  doc.fontSize(10).fillColor('#fff');
  doc.rect(MARGIN, cursor, CONTENT_WIDTH, 16).fill('#333');
  doc.fillColor('#fff').text(titolo, MARGIN + 5, cursor + 4, { width: CONTENT_WIDTH - 90 });
  doc.text(labelQuantita, MARGIN + CONTENT_WIDTH - 85, cursor + 4, { width: 80, align: 'right' });
  cursor += 16;

  if (righe.length === 0) {
    doc.fontSize(9).fillColor('#999').text('—', MARGIN + 5, cursor + 4, { width: CONTENT_WIDTH - 10 });
    return cursor + 18;
  }

  righe.forEach((riga, index) => {
    cursor = ensureSpace(doc, cursor, 16);

    if (index % 2 === 0) {
      doc.rect(MARGIN, cursor, CONTENT_WIDTH, 16).fill('#f5f5f5');
    }
    doc.fontSize(9).fillColor('#000');
    doc.text(riga.descrizione, MARGIN + 5, cursor + 4, {
      width: CONTENT_WIDTH - 95,
      ellipsis: true,
      lineBreak: false,
    });
    doc.text(formatNumero(riga.quantita), MARGIN + CONTENT_WIDTH - 85, cursor + 4, {
      width: 80,
      align: 'right',
    });
    cursor += 16;
  });

  return cursor + 2;
}

function renderFirma(
  doc: PDFKit.PDFDocument,
  titolo: string,
  nome: string,
  immagineB64: string,
  x: number,
  y: number,
  width: number
): void {
  doc.fontSize(8).fillColor('#666').text(titolo, x, y, { width });
  doc.rect(x, y + 12, width, 62).strokeColor('#ccc').lineWidth(0.5).stroke();

  if (immagineB64) {
    try {
      doc.image(Buffer.from(immagineB64, 'base64'), x + 4, y + 16, {
        fit: [width - 8, 54],
        align: 'center',
        valign: 'center',
      });
    } catch {
      // Una firma illeggibile non deve impedire il download del documento
    }
  }

  doc.fontSize(9).fillColor('#000').text(nome || '-', x, y + 80, { width, align: 'center' });
}

/** Disegna un bollettino completo sulla pagina corrente. */
function renderBollettino(doc: PDFKit.PDFDocument, b: BollettinoPdf): void {
  doc.fontSize(16).fillColor('#000').text('Giornale Lavori', MARGIN, MARGIN, {
    width: CONTENT_WIDTH,
    align: 'center',
  });
  doc.fontSize(9).fillColor('#666').text(`Bollettino n. ${b.id}`, MARGIN, MARGIN + 20, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  let y = MARGIN + 44;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').lineWidth(0.5).stroke();
  y += 10;

  const colWidth = CONTENT_WIDTH / 3;
  labelCoppia(doc, 'Data', formatDate(b.dataRiferimento), MARGIN, y, colWidth - 10);
  labelCoppia(doc, 'Cliente', b.clienteNome, MARGIN + colWidth, y, colWidth - 10);
  labelCoppia(doc, 'Cantiere', b.cantiereNome, MARGIN + colWidth * 2, y, colWidth - 10);
  y += 34;

  labelCoppia(doc, 'Operatore', `${b.utente.nome} ${b.utente.cognome}`, MARGIN, y, colWidth - 10);
  labelCoppia(doc, 'N. Operai', String(b.numeroOperai), MARGIN + colWidth, y, colWidth - 10);
  labelCoppia(doc, 'Ore (per operaio)', formatNumero(b.ore), MARGIN + colWidth * 2, y, colWidth - 10);
  y += 36;

  // Attività: riquadro dimensionato sul testo effettivo
  doc.fontSize(8).fillColor('#666').text('Attività svolte', MARGIN, y, { width: CONTENT_WIDTH });
  y += 12;

  const testo = b.attivita || '-';
  doc.fontSize(10).fillColor('#000');
  const altezzaTesto = doc.heightOfString(testo, { width: CONTENT_WIDTH - 12 });
  // Il riquadro non deve mai invadere la zona delle firme: quel che resta
  // sotto è riservato alle tre sezioni delle voci
  const spazioTesto = Math.max(FIRME_TOP - y - 200, 60);
  const altezzaBox = Math.min(Math.max(altezzaTesto + 12, 60), spazioTesto);

  doc.rect(MARGIN, y, CONTENT_WIDTH, altezzaBox).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.text(testo, MARGIN + 6, y + 6, {
    width: CONTENT_WIDTH - 12,
    height: altezzaBox - 12,
    ellipsis: true,
  });
  y += altezzaBox + 14;

  for (const sezione of SEZIONI) {
    const righe = b.righe.filter((r) => r.tipo === sezione.tipo);
    y = renderSezioneVoci(doc, sezione.titolo, sezione.labelQuantita, righe, y) + 6;
  }

  const firmaWidth = (CONTENT_WIDTH - 30) / 2;
  renderFirma(doc, 'Firma operatore', b.firmaOperatoreNome, b.firmaOperatoreImg, MARGIN, FIRME_TOP, firmaWidth);
  renderFirma(
    doc,
    'Firma committente',
    b.firmaCommittenteNome,
    b.firmaCommittenteImg,
    MARGIN + firmaWidth + 30,
    FIRME_TOP,
    firmaWidth
  );
}

function renderCopertina(
  doc: PDFKit.PDFDocument,
  cantiereNome: string,
  clienteNome: string,
  bollettini: BollettinoPdf[]
): void {
  const totaleOre = bollettini.reduce((s, b) => s + b.ore, 0);
  const totaleOreUomo = bollettini.reduce((s, b) => s + b.ore * b.numeroOperai, 0);

  const date = bollettini.map((b) => new Date(b.dataRiferimento).getTime());
  const periodo = date.length
    ? `${formatDate(new Date(Math.min(...date)))} — ${formatDate(new Date(Math.max(...date)))}`
    : '-';

  doc.fontSize(22).fillColor('#000').text('Riepilogo Giornale Lavori', MARGIN, 160, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  doc.fontSize(14).fillColor('#333').text(cantiereNome, MARGIN, 200, {
    width: CONTENT_WIDTH,
    align: 'center',
  });
  doc.fontSize(11).fillColor('#666').text(clienteNome, MARGIN, 222, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  let y = 280;
  const voci: [string, string][] = [
    ['Periodo', periodo],
    ['Bollettini', String(bollettini.length)],
    ['Totale ore (per operaio)', formatNumero(totaleOre)],
    ['Totale ore-uomo', formatNumero(totaleOreUomo)],
  ];

  for (const [label, valore] of voci) {
    doc.fontSize(10).fillColor('#666').text(label, MARGIN + 80, y, { width: 220 });
    doc.fontSize(11).fillColor('#000').text(valore, MARGIN + 300, y, { width: 175, align: 'right' });
    y += 24;
  }

  doc.fontSize(8).fillColor('#999').text(
    `Documento generato il ${new Date().toLocaleString('it-IT')}`,
    MARGIN,
    PAGE_HEIGHT - MARGIN - 20,
    { width: CONTENT_WIDTH, align: 'center' }
  );
}

function buildDocument(render: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    render(doc);

    doc.end();
  });
}

export class BollettinoPdfService {
  async generateSingolo(bollettino: BollettinoPdf): Promise<Buffer> {
    return buildDocument((doc) => renderBollettino(doc, bollettino));
  }

  /**
   * Il cumulativo non è un file archiviato ma il risultato di una query: si
   * rigenera a ogni download, quindi include sempre anche l'ultimo bollettino
   * inserito e non resta mai disallineato dopo una cancellazione.
   */
  async generateCumulativo(
    cantiereNome: string,
    clienteNome: string,
    bollettini: BollettinoPdf[]
  ): Promise<Buffer> {
    return buildDocument((doc) => {
      renderCopertina(doc, cantiereNome, clienteNome, bollettini);

      for (const bollettino of bollettini) {
        doc.addPage();
        renderBollettino(doc, bollettino);
      }
    });
  }
}
