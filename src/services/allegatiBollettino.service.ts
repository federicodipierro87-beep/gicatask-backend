import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';

/**
 * Allegati del bollettino: foto scattate in cantiere e PDF.
 *
 * I byte stanno su R2 e non in Postgres. Le firme sono base64 in colonna Text
 * da 5-30 KB; una foto da telefono e' 2-8 MB, due ordini di grandezza in piu',
 * e il dump notturno del backup legge `bollettino.findMany()` senza `select`:
 * ogni colonna finirebbe nel JSON. In tabella resta la sola riga di metadati.
 *
 * Si riusa il bucket dei backup con prefisso `allegati/`: nessuna env nuova.
 * E' sicuro perche' `cleanupOldBackups` non spazza il bucket con una
 * ListObjectsV2, ma itera le righe di `backup_log` e cancella per nome esatto.
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

const ESTENSIONI: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

export interface AllegatoCaricato {
  id: number;
  nomeFile: string;
  mimeType: string;
  dimensione: number;
}

export class AllegatiBollettinoService {
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

  /**
   * Carica un file e registra i metadati. L'ordine non e' invertibile: se il
   * PutObject fallisce la riga non si scrive, altrimenti resterebbero metadati
   * che puntano al vuoto.
   */
  async carica(
    utenteId: number,
    nomeFile: string,
    mimeType: string,
    buffer: Buffer
  ): Promise<AllegatoCaricato> {
    if (!this.isConfigured()) {
      throw new Error('Allegati non configurati: credenziali R2 mancanti');
    }

    const estensione = ESTENSIONI[mimeType] ?? '';
    const chiave = `allegati/${utenteId}/${randomUUID()}${estensione}`;

    await this.s3Client!.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: chiave,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    const allegato = await this.prisma.allegatoBollettino.create({
      data: {
        bollettinoId: null,
        caricatoDaId: utenteId,
        chiave,
        nomeFile: nomeFile.slice(0, 200),
        mimeType,
        dimensione: buffer.length,
      },
      select: { id: true, nomeFile: true, mimeType: true, dimensione: true },
    });

    return allegato;
  }

  /** Metadati dell'allegato, comprensivi del bollettino di appartenenza. */
  async getById(id: number) {
    return this.prisma.allegatoBollettino.findUnique({
      where: { id },
      select: {
        id: true,
        bollettinoId: true,
        caricatoDaId: true,
        chiave: true,
        nomeFile: true,
        mimeType: true,
        dimensione: true,
      },
    });
  }

  async leggi(id: number): Promise<{ buffer: Buffer; mimeType: string; nomeFile: string } | null> {
    if (!this.isConfigured()) {
      throw new Error('Allegati non configurati: credenziali R2 mancanti');
    }

    const allegato = await this.getById(id);
    if (!allegato) return null;

    const buffer = await this.leggiChiave(allegato.chiave);

    return { buffer, mimeType: allegato.mimeType, nomeFile: allegato.nomeFile };
  }

  private async leggiChiave(chiave: string): Promise<Buffer> {
    const response = await this.s3Client!.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: chiave })
    );

    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  /** I byte degli allegati di un bollettino: serve alla mail. */
  async fileDiBollettino(
    bollettinoId: number,
    maxTotaleBytes: number
  ): Promise<{ nomeFile: string; buffer: Buffer }[]> {
    if (!this.isConfigured()) return [];

    const allegati = await this.prisma.allegatoBollettino.findMany({
      where: { bollettinoId },
      select: { chiave: true, nomeFile: true, dimensione: true },
      orderBy: { id: 'asc' },
    });

    const risultato: { nomeFile: string; buffer: Buffer }[] = [];
    let totale = 0;

    for (const allegato of allegati) {
      if (totale + allegato.dimensione > maxTotaleBytes) break;
      risultato.push({ nomeFile: allegato.nomeFile, buffer: await this.leggiChiave(allegato.chiave) });
      totale += allegato.dimensione;
    }

    return risultato;
  }

  /**
   * Cancella un allegato non ancora collegato a un bollettino. Solo chi lo ha
   * caricato: un orfano non ha padre da cui dedurre i permessi.
   */
  async rimuoviOrfano(id: number, utenteId: number): Promise<boolean> {
    const allegato = await this.prisma.allegatoBollettino.findFirst({
      where: { id, bollettinoId: null, caricatoDaId: utenteId },
      select: { id: true, chiave: true },
    });

    if (!allegato) return false;

    await this.rimuoviChiavi([allegato.chiave]);
    await this.prisma.allegatoBollettino.delete({ where: { id: allegato.id } });

    return true;
  }

  async chiaviDiBollettino(bollettinoId: number): Promise<string[]> {
    const allegati = await this.prisma.allegatoBollettino.findMany({
      where: { bollettinoId },
      select: { chiave: true },
    });

    return allegati.map((a) => a.chiave);
  }

  /** Un oggetto che resta su R2 non costa nulla: gli errori non propagano. */
  async rimuoviChiavi(chiavi: string[]): Promise<void> {
    if (!this.isConfigured() || chiavi.length === 0) return;

    for (const chiave of chiavi) {
      try {
        await this.s3Client!.send(
          new DeleteObjectCommand({ Bucket: this.bucketName, Key: chiave })
        );
      } catch (error) {
        console.error(`[Allegati] Impossibile cancellare ${chiave}:`, error);
      }
    }
  }

  /**
   * Chi carica una foto e poi abbandona il form lascia su R2 un oggetto che
   * nessuno collegherà mai. Prima l'oggetto, poi la riga: se R2 fallisce la
   * riga resta e il giro successivo riprova.
   */
  async pulisciOrfani(oreMax = 24): Promise<number> {
    const limite = new Date(Date.now() - oreMax * 60 * 60 * 1000);

    const orfani = await this.prisma.allegatoBollettino.findMany({
      where: { bollettinoId: null, createdAt: { lt: limite } },
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
        await this.prisma.allegatoBollettino.delete({ where: { id: orfano.id } });
        rimossi++;
      } catch (error) {
        console.error(`[Allegati] Pulizia orfano ${orfano.id} fallita:`, error);
      }
    }

    return rimossi;
  }
}
