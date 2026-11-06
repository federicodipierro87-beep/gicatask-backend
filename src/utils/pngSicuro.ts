import { inflateSync } from 'zlib';

/**
 * Dice se un'immagine si puo' passare a `doc.image()` di pdfkit senza
 * rischiare il processo.
 *
 * pdfkit decodifica i PNG con trasparenza (canale alfa o palette con tRNS) e
 * quelli interlacciati con png-js, che decomprime in modo asincrono e lancia
 * l'errore dentro la callback di zlib: un byte di filtro sbagliato o un IDAT
 * corrotto non arrivano a nessun try/catch e abbattono il server. Un chunk con
 * lunghezza >= 2^31 manda invece il parser di png-js in un ciclo infinito,
 * sincrono, che blocca il processo senza farlo cadere.
 *
 * Qui si ripete la lettura di png-js in modo sincrono e si rifiuta tutto cio'
 * che la farebbe fallire. Gli altri formati passano: pdfkit li legge (o li
 * rifiuta) in modo sincrono, e l'errore lo prende il try/catch del chiamante.
 * Va chiamata prima di *ogni* `doc.image()`: le firme gia' salvate nel
 * database non sono mai passate di qui.
 */
export function immagineSicuraPerPdf(buffer: Buffer): boolean {
  // Lo stesso riconoscimento di pdfkit (PDFImage.open): 0x89 + "PNG"
  const png = buffer.length >= 4 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG';
  if (!png) return true;

  try {
    return pngSicuro(buffer);
  } catch {
    return false;
  }
}

/** Limite dei pixel decodificati in memoria (25 megapixel RGBA a 8 bit). */
const MAX_BYTE_PIXEL = 100 * 1024 * 1024;

/** Lunghezza massima di un chunk secondo la specifica PNG. */
const MAX_CHUNK = 0x7fffffff;

function pngSicuro(buffer: Buffer): boolean {
  // Struttura dei chunk, letta come png-js: dall'ottavo byte, fino al primo IEND
  let pos = 8;
  let ihdr: Buffer | null = null;
  let haTrns = false;
  let fine = false;
  const idat: Buffer[] = [];

  while (pos + 12 <= buffer.length) {
    const lunghezza = buffer.readUInt32BE(pos);
    if (lunghezza > MAX_CHUNK) return false;
    const tipo = buffer.toString('latin1', pos + 4, pos + 8);
    const dati = pos + 8;
    if (dati + lunghezza + 4 > buffer.length) return false;

    // png-js legge l'IHDR ovunque si trovi: lo si vuole primo e unico
    if ((tipo === 'IHDR') !== (ihdr === null)) return false;

    if (tipo === 'IHDR') {
      if (lunghezza !== 13) return false;
      ihdr = buffer.subarray(dati, dati + 13);
    } else if (tipo === 'IDAT') {
      idat.push(buffer.subarray(dati, dati + lunghezza));
    } else if (tipo === 'tRNS') {
      haTrns = true;
    } else if (tipo === 'IEND') {
      fine = true;
      break;
    }

    pos = dati + lunghezza + 4;
  }

  if (!ihdr || !fine || idat.length === 0) return false;

  const larghezza = ihdr.readUInt32BE(0);
  const altezza = ihdr.readUInt32BE(4);
  const bit = ihdr.readUInt8(8);
  const tipoColore = ihdr.readUInt8(9);
  const interlacciato = ihdr.readUInt8(12);

  if (larghezza < 1 || altezza < 1 || larghezza > MAX_CHUNK || altezza > MAX_CHUNK) return false;
  if (interlacciato !== 0 && interlacciato !== 1) return false;

  const bitAmmessi: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!bitAmmessi[tipoColore]?.includes(bit)) return false;

  // Le stesse condizioni per cui pdfkit (PNGImage.embed) chiama decodePixels
  const alfa = tipoColore === 4 || tipoColore === 6;
  const decodifica = alfa || interlacciato === 1 || (tipoColore === 3 && haTrns);
  if (!decodifica) return true;

  // Sotto gli 8 bit png-js calcola righe di byte frazionari e legge i byte di
  // filtro nel punto sbagliato: si rinuncia all'immagine
  if (bit < 8) return false;

  const colori = tipoColore === 2 || tipoColore === 6 ? 3 : 1;
  const bytePixel = (bit * (colori + (alfa ? 1 : 0))) / 8;
  if (larghezza * altezza * bytePixel > MAX_BYTE_PIXEL) return false;

  // Un'immagine valida si decomprime in poco piu' di altezza * (1 + riga);
  // il margine copre le sette passate dell'interlacciamento
  const attesi = altezza * (1 + larghezza * bytePixel) + 8 * altezza + 1024;
  const dati = inflateSync(Buffer.concat(idat), { maxOutputLength: attesi });

  // Il giro di png-js (decodePixels/pass) ridotto ai soli byte di filtro
  let p = 0;
  const passata = (x0: number, y0: number, dx: number, dy: number): boolean => {
    const w = Math.ceil((larghezza - x0) / dx);
    const h = Math.ceil((altezza - y0) / dy);
    const riga = Math.max(0, bytePixel * w);
    for (let r = 0; r < h && p < dati.length; r++) {
      if (dati.readUInt8(p++) > 4) return false;
      p += riga;
    }
    return true;
  };

  if (interlacciato === 1) {
    return (
      passata(0, 0, 8, 8) &&
      passata(4, 0, 8, 8) &&
      passata(0, 4, 4, 8) &&
      passata(2, 0, 4, 4) &&
      passata(0, 2, 2, 4) &&
      passata(1, 0, 2, 2) &&
      passata(0, 1, 1, 2)
    );
  }
  return passata(0, 0, 1, 1);
}
