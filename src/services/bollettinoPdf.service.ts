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
  // NULL nei bollettini senza ore per collaboratore
  oreTotali: number | null;
  oraInizioMattino: string | null;
  oraFineMattino: string | null;
  oraInizioPomeriggio: string | null;
  oraFinePomeriggio: string | null;
  // NULL nei bollettini con i materiali a righe
  materialiTesto: string | null;
  squadre: {
    numeroOperai: number;
    oraInizioMattino: string | null;
    oraFineMattino: string | null;
    oraInizioPomeriggio: string | null;
    oraFinePomeriggio: string | null;
    ore: number;
  }[];
  clienteNome: string;
  cantiereNome: string | null;
  firmaOperatoreNome: string;
  firmaOperatoreImg: string;
  firmaCommittenteNome: string;
  firmaCommittenteImg: string;
  utente: { nome: string; cognome: string };
  // Vuoto per i bollettini precedenti alla selezione dei collaboratori
  collaboratori: { nome: string; ore: number | null }[];
  righe: RigaPdf[];
  // Solo i nomi: i file non vengono impaginati, servirebbe una lettura da R2
  // per ogni immagine e nel cumulativo di cliente sarebbero centinaia di GET
  // dentro una sola richiesta
  allegati: { nomeFile: string }[];
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
  { tipo: 'MEZZO', titolo: 'Mezzi', labelQuantita: 'Valore' },
  { tipo: 'MATERIALE', titolo: 'Materiali', labelQuantita: 'Quantità' },
  { tipo: 'TRASPORTO', titolo: 'Trasporti', labelQuantita: 'Viaggi' },
];

/**
 * Ore complessive del bollettino: la somma per collaboratore quando c'e',
 * altrimenti operai per ore come nei bollettini precedenti.
 */
function oreComplessive(b: BollettinoPdf): number {
  return b.oreTotali ?? b.ore * b.numeroOperai;
}

function fascia(inizio: string | null, fine: string | null): string | null {
  return inizio && fine ? `${inizio}–${fine}` : null;
}

/** "07:00–12:00 / 13:00–17:00", oppure la sola fascia presente. */
function fasceTesto(f: {
  oraInizioMattino: string | null;
  oraFineMattino: string | null;
  oraInizioPomeriggio: string | null;
  oraFinePomeriggio: string | null;
}): string {
  return [
    fascia(f.oraInizioMattino, f.oraFineMattino),
    fascia(f.oraInizioPomeriggio, f.oraFinePomeriggio),
  ].filter(Boolean).join(' / ');
}

/**
 * Riquadro di testo libero con titolo, dimensionato sul testo e limitato in
 * altezza: attivita' e materiali sono campi da 5000 caratteri.
 */
function renderTestoLibero(
  doc: PDFKit.PDFDocument,
  titolo: string,
  testo: string,
  y: number,
  altezzaMax: number
): number {
  let cursor = ensureSpace(doc, y, 60);
  doc.fontSize(8).fillColor('#666').text(titolo, MARGIN, cursor, { width: CONTENT_WIDTH });
  cursor += 12;

  const contenuto = testo || '-';
  doc.fontSize(10).fillColor('#000');
  const altezzaTesto = doc.heightOfString(contenuto, { width: CONTENT_WIDTH - 12 });
  const altezzaBox = Math.min(Math.max(altezzaTesto + 12, 36), Math.max(altezzaMax, 36));

  doc.rect(MARGIN, cursor, CONTENT_WIDTH, altezzaBox).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.text(contenuto, MARGIN + 6, cursor + 6, {
    width: CONTENT_WIDTH - 12,
    height: altezzaBox - 12,
    ellipsis: true,
  });

  return cursor + altezzaBox + 14;
}

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

/**
 * Nome del file PDF, condiviso fra il download e l'allegato della mail: se
 * divergessero, lo stesso documento arriverebbe al committente con un nome e
 * al responsabile con un altro.
 */
export function nomeFilePdf(bollettino: {
  id: number;
  dataRiferimento: Date;
  clienteNome: string;
  cantiereNome: string | null;
}): string {
  const data = new Date(bollettino.dataRiferimento).toISOString().split('T')[0];
  // Senza cantiere il nome ripiega sul cliente: un file che porta solo id e
  // data sarebbe irriconoscibile in una cartella di download
  const riferimento = sanitizeFilenamePart(bollettino.cantiereNome ?? bollettino.clienteNome);
  return `bollettino-${bollettino.id}-${riferimento}-${data}.pdf`;
}

// Al massimo due righe: con piu' cantieri il valore andrebbe a capo sopra la
// riga successiva dell'intestazione
function labelCoppia(doc: PDFKit.PDFDocument, label: string, valore: string, x: number, y: number, width: number): void {
  doc.fontSize(8).fillColor('#666').text(label, x, y, { width });
  doc.fontSize(10).fillColor('#000').text(valore || '-', x, y + 11, { width, height: 24, ellipsis: true });
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
  righe: { descrizione: string; quantita: number }[],
  y: number,
  totale?: { label: string; valore: number }
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

  if (totale) {
    cursor = ensureSpace(doc, cursor, 16);
    doc.moveTo(MARGIN, cursor).lineTo(MARGIN + CONTENT_WIDTH, cursor).strokeColor('#333').lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor('#000').font('Helvetica-Bold');
    doc.text(totale.label, MARGIN + 5, cursor + 4, { width: CONTENT_WIDTH - 95 });
    doc.text(formatNumero(totale.valore), MARGIN + CONTENT_WIDTH - 85, cursor + 4, {
      width: 80,
      align: 'right',
    });
    doc.font('Helvetica');
    cursor += 16;
  }

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
  labelCoppia(doc, 'Cantiere', b.cantiereNome ?? '—', MARGIN + colWidth * 2, y, colWidth - 10);
  y += 40;

  labelCoppia(doc, 'Operatore', `${b.utente.nome} ${b.utente.cognome}`, MARGIN, y, colWidth - 10);
  labelCoppia(doc, 'N. Operai', String(b.numeroOperai), MARGIN + colWidth, y, colWidth - 10);
  if (b.oreTotali !== null) {
    labelCoppia(doc, 'Totale ore', formatNumero(b.oreTotali), MARGIN + colWidth * 2, y, colWidth - 10);
  } else {
    labelCoppia(doc, 'Ore (per operaio)', formatNumero(b.ore), MARGIN + colWidth * 2, y, colWidth - 10);
  }
  y += 36;

  const mattino = fascia(b.oraInizioMattino, b.oraFineMattino);
  const pomeriggio = fascia(b.oraInizioPomeriggio, b.oraFinePomeriggio);
  if (mattino || pomeriggio) {
    labelCoppia(doc, 'Mattino', mattino ?? '—', MARGIN, y, colWidth - 10);
    labelCoppia(doc, 'Pomeriggio', pomeriggio ?? '—', MARGIN + colWidth, y, colWidth - 10);
    y += 36;
  }

  // Con le ore per collaboratore l'elenco diventa una tabella, stampata dopo
  // le attivita'; qui resta la riga di soli nomi dei bollettini precedenti
  if (b.oreTotali === null && b.collaboratori.length > 0) {
    labelCoppia(
      doc,
      'Collaboratori',
      b.collaboratori.map((c) => c.nome).join(', '),
      MARGIN,
      y,
      CONTENT_WIDTH
    );
    y += 40;
  }

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

  if (b.squadre.length > 0 && b.oreTotali !== null) {
    y = renderSezioneVoci(
      doc,
      'Operai',
      'Ore',
      b.squadre.map((s) => ({
        descrizione: `${s.numeroOperai} ${s.numeroOperai === 1 ? 'operaio' : 'operai'} · ${fasceTesto(s)}`,
        quantita: s.ore,
      })),
      y,
      { label: 'Totale ore', valore: b.oreTotali }
    ) + 6;
  } else if (b.oreTotali !== null && b.collaboratori.length > 0) {
    y = renderSezioneVoci(
      doc,
      'Collaboratori',
      'Ore',
      b.collaboratori.map((c) => ({ descrizione: c.nome, quantita: c.ore ?? 0 })),
      y,
      { label: 'Totale ore', valore: b.oreTotali }
    ) + 6;
  }

  for (const sezione of SEZIONI) {
    // Materiali come testo libero nei bollettini nuovi, a righe nei precedenti
    if (sezione.tipo === 'MATERIALE' && b.materialiTesto !== null) {
      y = renderTestoLibero(doc, 'Materiali', b.materialiTesto, y, 120);
      continue;
    }
    const righe = b.righe.filter((r) => r.tipo === sezione.tipo);
    y = renderSezioneVoci(doc, sezione.titolo, sezione.labelQuantita, righe, y) + 6;
  }

  // I file stanno su R2, ma il documento firmato deve registrare cosa era
  // allegato al momento della firma
  if (b.allegati.length > 0) {
    y = ensureSpace(doc, y, 14);
    doc.fontSize(8).fillColor('#666').text(
      `Allegati: ${b.allegati.map((a) => a.nomeFile).join(', ')}`,
      MARGIN,
      y,
      { width: CONTENT_WIDTH, ellipsis: true, lineBreak: false }
    );
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
  cantiereNome: string | null,
  clienteNome: string,
  bollettini: BollettinoPdf[]
): void {
  // Un solo totale: "ore per operaio" non esiste nei bollettini con le ore
  // per collaboratore, e sommarlo con quelli vecchi darebbe un numero senza senso
  const totaleOre = bollettini.reduce((s, b) => s + oreComplessive(b), 0);

  const date = bollettini.map((b) => new Date(b.dataRiferimento).getTime());
  const periodo = date.length
    ? `${formatDate(new Date(Math.min(...date)))} — ${formatDate(new Date(Math.max(...date)))}`
    : '-';

  doc.fontSize(22).fillColor('#000').text('Riepilogo Giornale Lavori', MARGIN, 160, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  // Senza cantiere e' il cumulativo di cliente: il cliente prende da solo la
  // riga in evidenza, altrimenti resterebbe uno spazio vuoto sopra di lui
  doc.fontSize(14).fillColor('#333').text(cantiereNome ?? clienteNome, MARGIN, 200, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  if (cantiereNome) {
    doc.fontSize(11).fillColor('#666').text(clienteNome, MARGIN, 222, {
      width: CONTENT_WIDTH,
      align: 'center',
    });
  }

  let y = 280;
  const voci: [string, string][] = [
    ['Periodo', periodo],
    ['Bollettini', String(bollettini.length)],
    ['Totale ore (tutti gli operai)', formatNumero(totaleOre)],
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
    cantiereNome: string | null,
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
