import PDFDocument from 'pdfkit';
import type { SchedaHrCompleta } from './hr.service.js';
import { CAMPI_HR, ETICHETTE_STATO_CIVILE, formatDataHr } from '../utils/hrCampi.js';

const MARGIN = 40;
const GRID_COLOR = '#bbbbbb';

function oggi(): string {
  return formatDataHr(new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`));
}

function inBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Scheda anagrafica: A4 verticale, ogni dipendente parte da un foglio nuovo
// ---------------------------------------------------------------------------

const A4_W = 595;
const A4_H = 842;
const SCHEDA_W = A4_W - MARGIN * 2;
const SCHEDA_BOTTOM = A4_H - MARGIN;
// Due colonne di coppie etichetta/valore: cosi' la scheda sta in un foglio
const COL_W = SCHEDA_W / 2;
const COL_LABEL_W = 118;
const COL_VALUE_W = COL_W - COL_LABEL_W;
const ROW_PAD = 3.5;
const FONT = 8.5;
const SEZ_H = 14;

const THUMB_W = 150;
const THUMB_H = 95;
const THUMB_GAP = 8;

// Foto del dipendente, proporzioni da fototessera
const FOTO_W = 64;
const FOTO_H = 80;

interface Cella {
  etichetta: string;
  valore: string;
}

export class HrPdfService {
  /**
   * `immagini` sono i byte delle foto (dipendente e tesserini) gia' letti da R2, per id
   * dell'allegato. Una foto che manca (PDF, HEIC, lettura fallita) finisce
   * nella scheda solo col nome del file.
   */
  async generaSchede(schede: SchedaHrCompleta[], immagini: Map<number, Buffer>): Promise<Buffer> {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4', autoFirstPage: false });
    const risultato = inBuffer(doc);

    for (const scheda of schede) {
      this.disegnaScheda(doc, scheda, immagini);
    }

    if (schede.length === 0) doc.addPage();
    doc.end();

    return risultato;
  }

  private disegnaScheda(
    doc: PDFKit.PDFDocument,
    scheda: SchedaHrCompleta,
    immagini: Map<number, Buffer>
  ): void {
    const stampata = `Stampata il ${oggi()}`;

    // In fondo a sinistra su ogni foglio della scheda. Sotto il margine
    // inferiore pdfkit aprirebbe una pagina nuova: il margine si toglie solo
    // per il tempo della scritta
    const nuovaPagina = () => {
      doc.addPage();
      const margine = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor('#777777');
      doc.text(stampata, MARGIN, SCHEDA_BOTTOM + 14, { width: SCHEDA_W, lineBreak: false });
      doc.page.margins.bottom = margine;
    };

    nuovaPagina();
    let y = MARGIN;

    // Foto del dipendente in alto a destra, formato tessera. Il testo
    // dell'intestazione le lascia spazio
    const foto = scheda.fotoId ? immagini.get(scheda.fotoId) : undefined;
    const testoW = foto ? SCHEDA_W - FOTO_W - 12 : SCHEDA_W;

    if (foto) {
      try {
        doc.image(foto, MARGIN + SCHEDA_W - FOTO_W, y, {
          fit: [FOTO_W, FOTO_H],
          align: 'center',
          valign: 'center',
        });
      } catch {
        // Byte che pdfkit non sa decodificare: resta il riquadro vuoto
      }
      doc.lineWidth(0.5).strokeColor(GRID_COLOR).rect(MARGIN + SCHEDA_W - FOTO_W, y, FOTO_W, FOTO_H).stroke();
    }

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000');
    doc.text('Scheda anagrafica dipendente', MARGIN, y, { width: testoW });
    y = doc.y + 1;
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text(
      scheda.numeroPersonale ? `${scheda.cognomeNome}  -  N. ${scheda.numeroPersonale}` : scheda.cognomeNome,
      MARGIN,
      y,
      { width: testoW }
    );
    y = Math.max(doc.y, foto ? MARGIN + FOTO_H : 0) + 8;

    // Ripiego per le schede con molti figli o formazioni: nei casi normali
    // la scheda sta in un foglio
    const spazio = (altezza: number) => {
      if (y + altezza <= SCHEDA_BOTTOM) return;
      nuovaPagina();
      y = MARGIN;
      doc.font('Helvetica').fontSize(7.5).fillColor('#777777');
      doc.text(`${scheda.cognomeNome} (continua)`, MARGIN, y, { width: SCHEDA_W });
      y = doc.y + 6;
    };

    const altezzaCella = (c: Cella, valueW: number) => {
      doc.font('Helvetica').fontSize(FONT);
      const hLabel = doc.heightOfString(c.etichetta, { width: COL_LABEL_W - ROW_PAD * 2 });
      doc.font('Helvetica-Bold');
      const hValore = doc.heightOfString(c.valore || ' ', { width: valueW - ROW_PAD * 2 });
      return Math.max(hLabel, hValore) + ROW_PAD * 2;
    };

    const disegnaCella = (c: Cella, x: number, h: number, valueW: number) => {
      doc.rect(x, y, COL_LABEL_W, h).fill('#f3f3f3');
      doc.font('Helvetica').fontSize(FONT).fillColor('#555555');
      doc.text(c.etichetta, x + ROW_PAD, y + ROW_PAD, { width: COL_LABEL_W - ROW_PAD * 2 });
      doc.font('Helvetica-Bold').fillColor('#000000');
      doc.text(c.valore, x + COL_LABEL_W + ROW_PAD, y + ROW_PAD, { width: valueW - ROW_PAD * 2 });
      doc.lineWidth(0.5).strokeColor(GRID_COLOR).rect(x, y, COL_LABEL_W + valueW, h).stroke();
    };

    // L'intestazione non resta mai da sola in fondo alla pagina: si porta
    // dietro almeno la prima riga
    const titoloSezione = (titolo: string, primaRiga: number) => {
      spazio(6 + SEZ_H + primaRiga);
      y += 6;
      doc.rect(MARGIN, y, SCHEDA_W, SEZ_H).fill('#333333');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      doc.text(titolo, MARGIN + 6, y + 3, { width: SCHEDA_W - 12 });
      y += SEZ_H;
    };

    // Due campi per riga
    const griglia = (titolo: string, celle: Cella[]) => {
      const righe: Cella[][] = [];
      for (let i = 0; i < celle.length; i += 2) righe.push(celle.slice(i, i + 2));

      const altezze = righe.map((r) => Math.max(...r.map((c) => altezzaCella(c, COL_VALUE_W))));

      titoloSezione(titolo, altezze[0] ?? 0);
      righe.forEach((riga, i) => {
        const h = altezze[i]!;
        spazio(h);
        riga.forEach((c, j) => disegnaCella(c, MARGIN + j * COL_W, h, COL_VALUE_W));
        if (riga.length === 1) {
          doc.lineWidth(0.5).strokeColor(GRID_COLOR).rect(MARGIN + COL_W, y, COL_W, h).stroke();
        }
        y += h;
      });
    };

    const sezioni = new Map<string, Cella[]>();
    for (const campo of CAMPI_HR) {
      if (campo.chiave === 'formazioni') continue;

      let celle: Cella[];
      if (campo.chiave === 'statoCivile') {
        // Ogni stato civile occupa una riga: lo stato a sinistra, la data a destra
        const stati = scheda.statiCivili.length > 0 ? scheda.statiCivili : [null];
        celle = stati.flatMap((c) => [
          { etichetta: 'Stato civile', valore: c ? ETICHETTE_STATO_CIVILE[c.stato] : '' },
          { etichetta: 'Dal', valore: c ? formatDataHr(c.dal) : '' },
        ]);
      } else if (campo.chiave !== 'figli') {
        celle = [{ etichetta: campo.etichetta, valore: campo.valore(scheda) }];
      } else if (scheda.figli.length === 0) {
        celle = [{ etichetta: 'Figli', valore: '' }];
      } else {
        celle = scheda.figli.map((f, i) => ({
          etichetta: `Figlio/a ${i + 1}`,
          valore: f.dataNascita ? `${f.cognomeNome}\nnato/a il ${formatDataHr(f.dataNascita)}` : f.cognomeNome,
        }));
      }

      sezioni.set(campo.sezione, [...(sezioni.get(campo.sezione) ?? []), ...celle]);
    }

    // Le formazioni, la parte di altezza variabile, vanno in fondo
    for (const [nome, celle] of sezioni) griglia(nome, celle);

    // Formazioni a tutta larghezza, con le foto dei tesserini nella riga sotto
    const LARGA_W = SCHEDA_W - COL_LABEL_W;

    if (scheda.formazioni.length === 0) {
      const vuota = { etichetta: 'Formazioni', valore: '' };
      const h = altezzaCella(vuota, LARGA_W);
      titoloSezione('Formazioni', h);
      disegnaCella(vuota, MARGIN, h, LARGA_W);
      y += h;
    }

    scheda.formazioni.forEach((formazione, i) => {
      const senzaAnteprima = formazione.foto.filter((f) => !immagini.has(f.id));
      const cella: Cella = {
        etichetta: `Formazione ${i + 1}`,
        valore: senzaAnteprima.length > 0
          ? `${formazione.nome}\nAllegati: ${senzaAnteprima.map((f) => f.nomeFile).join(', ')}`
          : formazione.nome,
      };
      const foto = formazione.foto.filter((f) => immagini.has(f.id));
      const h = altezzaCella(cella, LARGA_W);
      const hFoto = foto.length > 0 ? THUMB_H + ROW_PAD * 2 : 0;

      if (i === 0) titoloSezione('Formazioni', h + hFoto);
      spazio(h + hFoto);
      disegnaCella(cella, MARGIN, h, LARGA_W);
      y += h;

      if (foto.length === 0) return;

      const rigaFoto = () =>
        doc.lineWidth(0.5).strokeColor(GRID_COLOR).rect(MARGIN, y, SCHEDA_W, hFoto).stroke();

      rigaFoto();
      let x = MARGIN + COL_LABEL_W + ROW_PAD;
      for (const f of foto) {
        if (x + THUMB_W > MARGIN + SCHEDA_W) {
          y += hFoto;
          spazio(hFoto);
          rigaFoto();
          x = MARGIN + COL_LABEL_W + ROW_PAD;
        }
        try {
          doc.image(immagini.get(f.id)!, x, y + ROW_PAD, {
            fit: [THUMB_W, THUMB_H],
            align: 'center',
            valign: 'center',
          });
        } catch {
          // Byte che pdfkit non sa decodificare: resta il riquadro vuoto
        }
        x += THUMB_W + THUMB_GAP;
      }
      y += hFoto;
    });
  }

  // -------------------------------------------------------------------------
  // Riepilogo: una riga per dipendente, le colonne scelte dall'utente
  // -------------------------------------------------------------------------

  async generaRiepilogo(schede: SchedaHrCompleta[], chiavi: string[], titolo: string): Promise<Buffer> {
    const colonneScelte = CAMPI_HR.filter((c) => chiavi.includes(c.chiave));
    if (colonneScelte.length === 0) throw new Error('Nessun campo selezionato');

    // Oltre le otto colonne l'A4 orizzontale diventa illeggibile: si passa all'A3
    const formato = colonneScelte.length > 8 ? 'A3' : 'A4';
    const [pageW, pageH] = formato === 'A3' ? [1191, 842] : [842, 595];
    const tabellaW = pageW - MARGIN * 2;
    const bottom = pageH - MARGIN;

    const pesoTotale = colonneScelte.reduce((sum, c) => sum + c.peso, 0);
    const colonne = colonneScelte.map((c) => ({ ...c, width: (c.peso / pesoTotale) * tabellaW }));

    const doc = new PDFDocument({ margin: MARGIN, size: formato, layout: 'landscape' });
    const risultato = inBuffer(doc);

    const PAD = 3;
    const FONT_BODY = 8;

    const griglia = (y: number, h: number) => {
      doc.lineWidth(0.5).strokeColor('#999999');
      let x = MARGIN;
      for (const col of colonne) {
        doc.rect(x, y, col.width, h).stroke();
        x += col.width;
      }
    };

    const intestazioneTabella = (y: number): number => {
      doc.font('Helvetica-Bold').fontSize(FONT_BODY);
      const h =
        Math.max(...colonne.map((c) => doc.heightOfString(c.etichetta, { width: c.width - PAD * 2 }))) + PAD * 2;

      doc.rect(MARGIN, y, tabellaW, h).fill('#333333');
      doc.fillColor('#ffffff');
      let x = MARGIN;
      for (const col of colonne) {
        doc.text(col.etichetta, x + PAD, y + PAD, { width: col.width - PAD * 2 });
        x += col.width;
      }
      griglia(y, h);
      return y + h;
    };

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000');
    doc.text(titolo, MARGIN, MARGIN, { width: tabellaW });
    doc.font('Helvetica').fontSize(9).fillColor('#666666');
    doc.text(`${schede.length} dipendenti  -  stampato il ${oggi()}`, { width: tabellaW });

    let y = intestazioneTabella(doc.y + 8);

    schede.forEach((scheda, index) => {
      doc.font('Helvetica').fontSize(FONT_BODY);
      const celle = colonne.map((c) => ({ col: c, testo: c.valore(scheda) }));
      const h = Math.min(
        Math.max(...celle.map(({ col, testo }) => doc.heightOfString(testo || ' ', { width: col.width - PAD * 2 }))) +
          PAD * 2,
        bottom - MARGIN - 40
      );

      if (y + h > bottom) {
        doc.addPage();
        y = intestazioneTabella(MARGIN);
        doc.font('Helvetica').fontSize(FONT_BODY);
      }

      if (index % 2 === 0) doc.rect(MARGIN, y, tabellaW, h).fill('#f5f5f5');

      doc.fillColor('#000000');
      let x = MARGIN;
      for (const { col, testo } of celle) {
        doc.text(testo, x + PAD, y + PAD, { width: col.width - PAD * 2, height: h - PAD });
        x += col.width;
      }
      griglia(y, h);
      y += h;
    });

    doc.end();
    return risultato;
  }
}
