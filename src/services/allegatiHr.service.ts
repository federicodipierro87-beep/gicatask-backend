import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { inflateSync } from 'zlib';

/**
 * Foto dei tesserini delle formazioni HR. Stesso schema degli allegati del
 * bollettino (vedi `allegatiBollettino.service.ts`): byte su R2 nel bucket dei
 * backup, prefisso `hr/`, metadati in `allegati_hr`.
 *
 * Una foto caricata resta orfana finche' la scheda non si salva; una tolta dal
 * form o appartenente a una formazione cancellata torna orfana. In entrambi i
 * casi la cancella `pulisciOrfani`, quindi la scheda non tocca mai R2.
 */
const MIME_AMMESSI = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

const MAX_BYTES = 10 * 1024 * 1024;

const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * pdfkit decomprime i PNG con trasparenza in modo asincrono, e un errore di
 * zlib in quel punto non arriva a nessun try/catch: abbatte il processo. Qui
 * si decomprimono i dati IDAT in modo sincrono, dove l'errore si intercetta.
 */
export function pngValido(buffer: Buffer): boolean {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_FIRMA)) return false;

  const idat: Buffer[] = [];
  let pos = 8;

  while (pos + 8 <= buffer.length) {
    const lunghezza = buffer.readUInt32BE(pos);
    const tipo = buffer.toString('ascii', pos + 4, pos + 8);
    const fine = pos + 12 + lunghezza;
    if (fine > buffer.length) return false;
    if (tipo === 'IDAT') idat.push(buffer.subarray(pos + 8, pos + 8 + lunghezza));
    if (tipo === 'IEND') break;
    pos = fine;
  }

  try {
    inflateSync(Buffer.concat(idat));
    return idat.length > 0;
  } catch {
    return false;
  }
}

const ESTENSIONI: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

export class AllegatiHrService {
  private s3Client: S3Client | null = null;
  private bucketName: string;

  constructor(private prisma: PrismaClient) {
    this.bucketName = process.env.R2_BUCKET_NAME || 'gicatask-backups';

    if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ACCOUNT_ID) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
    }
  }

  isConfigured(): boolean {
    return this.s3Client !== null;
  }

  mimeAmmesso(mimeType: string): boolean {
    return MIME_AMMESSI.includes(mimeType);
  }

  get maxBytes(): number {
    return MAX_BYTES;
  }

  /** Prima R2, poi la riga: mai metadati che puntano al vuoto. */
  async carica(utenteId: number, nomeFile: string, mimeType: string, buffer: Buffer) {
    if (!this.isConfigured()) {
      throw new Error('Allegati non configurati: credenziali R2 mancanti');
    }

    const chiave = `hr/${randomUUID()}${ESTENSIONI[mimeType] ?? ''}`;

    await this.s3Client!.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: chiave,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    return this.prisma.allegatoHr.create({
      data: {
        formazioneId: null,
        caricatoDaId: utenteId,
        chiave,
        nomeFile: nomeFile.slice(0, 200),
        mimeType,
        dimensione: buffer.length,
      },
      select: { id: true, nomeFile: true, mimeType: true, dimensione: true },
    });
  }

  async leggi(id: number): Promise<{ buffer: Buffer; mimeType: string; nomeFile: string } | null> {
    if (!this.isConfigured()) {
      throw new Error('Allegati non configurati: credenziali R2 mancanti');
    }

    const allegato = await this.prisma.allegatoHr.findUnique({
      where: { id },
      select: { chiave: true, mimeType: true, nomeFile: true },
    });
    if (!allegato) return null;

    return { buffer: await this.leggiChiave(allegato.chiave), mimeType: allegato.mimeType, nomeFile: allegato.nomeFile };
  }

  /**
   * I byte delle sole immagini che pdfkit sa disegnare (JPEG e PNG), per la
   * stampa della scheda. Una foto illeggibile si salta: la scheda si stampa
   * lo stesso.
   */
  async immaginiPerPdf(ids: number[]): Promise<Map<number, Buffer>> {
    const risultato = new Map<number, Buffer>();
    if (!this.isConfigured() || ids.length === 0) return risultato;

    const allegati = await this.prisma.allegatoHr.findMany({
      where: { id: { in: ids }, mimeType: { in: ['image/jpeg', 'image/png'] } },
      select: { id: true, chiave: true, mimeType: true },
    });

    for (const allegato of allegati) {
      try {
        const buffer = await this.leggiChiave(allegato.chiave);
        if (allegato.mimeType === 'image/png' && !pngValido(buffer)) continue;
        risultato.set(allegato.id, buffer);
      } catch (error) {
        console.error(`[Allegati HR] Lettura ${allegato.chiave} per il PDF fallita:`, error);
      }
    }

    return risultato;
  }

  private async leggiChiave(chiave: string): Promise<Buffer> {
    const response = await this.s3Client!.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: chiave })
    );

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as Readable) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  /** Prima l'oggetto, poi la riga: se R2 fallisce il giro successivo riprova. */
  async pulisciOrfani(oreMax = 24): Promise<number> {
    const limite = new Date(Date.now() - oreMax * 60 * 60 * 1000);

    const orfani = await this.prisma.allegatoHr.findMany({
      where: { formazioneId: null, createdAt: { lt: limite } },
      select: { id: true, chiave: true },
    });

    let rimossi = 0;

    for (const orfano of orfani) {
      try {
        if (this.isConfigured()) {
          await this.s3Client!.send(
            new DeleteObjectCommand({ Bucket: this.bucketName, Key: orfano.chiave })
          );
        }
        await this.prisma.allegatoHr.delete({ where: { id: orfano.id } });
        rimossi++;
      } catch (error) {
        console.error(`[Allegati HR] Pulizia orfano ${orfano.id} fallita:`, error);
      }
    }

    return rimossi;
  }
}
