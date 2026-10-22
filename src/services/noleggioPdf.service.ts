import PDFDocument from 'pdfkit';
import type { NoleggioFull } from './noleggi.service.js';
import type { FileNoleggio } from './allegatiNoleggio.service.js';
import { sanitizeFilenamePart } from './bollettinoPdf.service.js';

const MARGIN = 40;
const PAGE_WIDTH = 595; // A4 verticale
const PAGE_HEIGHT = 842;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** pdfkit legge solo JPEG e PNG: gli altri formati restano elencati per nome. */
const MIME_STAMPABILI = ['image/jpeg', 'image/png'];

const CARBURANTE: Record<string, string> = { DIESEL: 'Diesel', BENZINA: 'Benzina' };

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('it-IT');
}

export function formatGiorni(giorni: number): string {
  if (giorni === 0.5) return 'Mezza giornata';
  return giorni === 1 ? '1 giorno' : `${giorni} giorni`;
}

/** Condiviso fra download e allegato della mail, come per i bollettini. */
export function nomeFileNoleggio(n: { id: number; data: Date; clienteNome: string }): string {
  const data = new Date(n.data).toISOString().split('T')[0];
  return `noleggio-${n.id}-${sanitizeFilenamePart(n.clienteNome)}-${data}.pdf`;
}

function labelCoppia(doc: PDFKit.PDFDocument, label: string, valore: string, x: number, y: number, width: number): void {
  doc.fontSize(8).fillColor('#666').text(label, x, y, { width });
  doc.fontSize(10).fillColor('#000').text(valore || '-', x, y + 11, { width, height: 24, ellipsis: true });
}

function nuovaPaginaSeServe(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed <= PAGE_HEIGHT - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

/** Foto di un gruppo, due per riga. Ritorna la y sotto l'ultima riga. */
function renderFoto(doc: PDFKit.PDFDocument, titolo: string, foto: FileNoleggio[], y: number): number {
  if (foto.length === 0) return y;

  const gap = 12;
  const larghezza = (CONTENT_WIDTH - gap) / 2;
  const altezza = 200;

  y = nuovaPaginaSeServe(doc, y, 20 + altezza);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(titolo, MARGIN, y, { width: CONTENT_WIDTH });
  doc.font('Helvetica');
  y += 18;

  const nonStampabili = foto.filter((f) => !MIME_STAMPABILI.includes(f.mimeType));
  const stampabili = foto.filter((f) => MIME_STAMPABILI.includes(f.mimeType));

  for (let i = 0; i < stampabili.length; i += 2) {
    y = nuovaPaginaSeServe(doc, y, altezza);

    stampabili.slice(i, i + 2).forEach((f, colonna) => {
      const x = MARGIN + colonna * (larghezza + gap);
      doc.rect(x, y, larghezza, altezza).strokeColor('#ccc').lineWidth(0.5).stroke();
      try {
        doc.image(f.buffer, x + 4, y + 4, {
          fit: [larghezza - 8, altezza - 8],
          align: 'center',
          valign: 'center',
        });
      } catch {
        // Un'immagine illeggibile non deve impedire il PDF
        doc.fontSize(8).fillColor('#999').text(f.nomeFile, x + 6, y + 6, { width: larghezza - 12 });
      }
    });

    y += altezza + gap;
  }

  if (nonStampabili.length > 0) {
    y = nuovaPaginaSeServe(doc, y, 14);
    doc.fontSize(8).fillColor('#666').text(
      `Allegati alla mail: ${nonStampabili.map((f) => f.nomeFile).join(', ')}`,
      MARGIN,
      y,
      { width: CONTENT_WIDTH }
    );
    y = doc.y + 8;
  }

  return y;
}

function renderNoleggio(doc: PDFKit.PDFDocument, n: NoleggioFull, foto: FileNoleggio[]): void {
  let y = MARGIN;

  doc.fontSize(16).fillColor('#000').text('Verbale di noleggio', MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center',
  });
  doc.fontSize(9).fillColor('#666').text(`N. ${n.id}`, MARGIN, y + 20, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  y += 44;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').lineWidth(0.5).stroke();
  y += 10;

  // Il cantiere in testa, come nel form
  labelCoppia(doc, 'Cantiere', n.cantiereNome ?? '—', MARGIN, y, CONTENT_WIDTH);
  y += 38;

  const col = CONTENT_WIDTH / 3;
  labelCoppia(doc, 'Data uscita', formatDate(n.data), MARGIN, y, col - 10);
  labelCoppia(doc, 'Data ingresso', n.dataIngresso ? formatDate(n.dataIngresso) : '—', MARGIN + col, y, col - 10);
  labelCoppia(doc, 'Cliente', n.clienteNome, MARGIN + col * 2, y, col - 10);
  y += 38;

  labelCoppia(doc, 'Veicolo', n.veicoloNome, MARGIN, y, col - 10);
  labelCoppia(doc, 'Durata', formatGiorni(n.giorni), MARGIN + col, y, col - 10);
  labelCoppia(doc, 'Operatore', `${n.utente.nome} ${n.utente.cognome}`, MARGIN + col * 2, y, col - 10);
  y += 38;

  const scontrini = foto.filter((f) => f.tipo === 'SCONTRINO');
  const fotoDanni = foto.filter((f) => f.tipo === 'DANNI');

  labelCoppia(
    doc,
    'Pieno',
    n.pieno ? `Sì — ${CARBURANTE[n.carburante ?? ''] ?? '-'}` : 'No',
    MARGIN,
    y,
    col - 10
  );
  labelCoppia(doc, 'Danni', n.danni ? 'Sì' : 'No', MARGIN + col, y, col - 10);
  labelCoppia(doc, 'Fatturazione', n.emailFatturazione ?? '—', MARGIN + col * 2, y, col - 10);
  y += 38;

  if (n.danni && n.danniNote) {
    doc.fontSize(8).fillColor('#666').text('Descrizione dei danni', MARGIN, y, { width: CONTENT_WIDTH });
    y += 12;
    doc.fontSize(10).fillColor('#000');
    const altezza = Math.min(doc.heightOfString(n.danniNote, { width: CONTENT_WIDTH - 12 }) + 12, 200);
    doc.rect(MARGIN, y, CONTENT_WIDTH, altezza).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.text(n.danniNote, MARGIN + 6, y + 6, { width: CONTENT_WIDTH - 12, height: altezza - 12, ellipsis: true });
    y += altezza + 14;
  }

  // Firma in fondo ai dati e prima delle foto, che possono occupare pagine
  y = nuovaPaginaSeServe(doc, y, 110);
  const larghezzaFirma = 240;
  const x = MARGIN + CONTENT_WIDTH - larghezzaFirma;
  doc.fontSize(8).fillColor('#666').text('Firma di chi ha effettuato il noleggio', x, y, { width: larghezzaFirma });
  doc.rect(x, y + 12, larghezzaFirma, 62).strokeColor('#ccc').lineWidth(0.5).stroke();
  try {
    doc.image(Buffer.from(n.firmaImg, 'base64'), x + 4, y + 16, {
      fit: [larghezzaFirma - 8, 54],
      align: 'center',
      valign: 'center',
    });
  } catch {
    // Una firma illeggibile non deve impedire il PDF
  }
  doc.fontSize(9).fillColor('#000').text(n.firmaNome, x, y + 80, { width: larghezzaFirma, align: 'center' });
  y += 110;

  if (n.pieno) y = renderFoto(doc, 'Scontrino del pieno', scontrini, y + 6);
  if (n.danni) y = renderFoto(doc, 'Foto dei danni', fotoDanni, y + 6);

  // Le foto oltre il limite della mail non arrivano fin qui: il verbale
  // registra comunque quante ne erano state allegate
  const mancanti = n.allegati.length - foto.length;
  if (mancanti > 0) {
    y = nuovaPaginaSeServe(doc, y, 14);
    doc.fontSize(8).fillColor('#999').text(
      `${mancanti} ${mancanti === 1 ? 'foto non riportata' : 'foto non riportate'} per limiti di dimensione.`,
      MARGIN,
      y,
      { width: CONTENT_WIDTH }
    );
  }
}

export class NoleggioPdfService {
  generate(noleggio: NoleggioFull, foto: FileNoleggio[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderNoleggio(doc, noleggio, foto);

      doc.end();
    });
  }
}
