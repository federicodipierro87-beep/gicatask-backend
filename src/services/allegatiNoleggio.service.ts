import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';

/**
 * Foto del verbale di noleggio: scontrino del pieno e danni.
 *
 * Stesso schema degli allegati del bollettino (vedi
 * `allegatiBollettino.service.ts`): i byte su R2 nel bucket dei backup, col
 * prefisso `noleggi/`, in tabella i soli metadati. Il file si carica mentre
 * l'operatore compila, prima della firma; al salvataggio il verbale lo
 * collega e gli assegna il tipo.
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

export type TipoAllegatoNoleggio = 'SCONTRINO' | 'DANNI_PRECEDENTI' | 'DANNI';

export interface FileNoleggio {
  tipo: string | null;
  nomeFile: string;
  mimeType: string;
  buffer: Buffer;
}

export class AllegatiNoleggioService {
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

  /** Prima l'oggetto su R2, poi la riga: mai metadati che puntano al vuoto. */
  async carica(utenteId: number, nomeFile: string, mimeType: string, buffer: Buffer) {
    if (!this.isConfigured()) {
      throw new Error('Allegati non configurati: credenziali R2 mancanti');
    }

    const chiave = `noleggi/${utenteId}/${randomUUID()}${ESTENSIONI[mimeType] ?? ''}`;

    await this.s3Client!.send(
      new PutObjectCommand({ Bucket: this.bucketName, Key: chiave, Body: buffer, ContentType: mimeType })
    );

    return this.prisma.allegatoNoleggio.create({
      data: {
        caricatoDaId: utenteId,
        chiave,
        nomeFile: nomeFile.slice(0, 200),
        mimeType,
        dimensione: buffer.length,
      },
      select: { id: true, nomeFile: true, mimeType: true, dimensione: true },
    });
  }

  async getById(id: number) {
    return this.prisma.allegatoNoleggio.findUnique({
      where: { id },
      select: {
        id: true,
        noleggioId: true,
        caricatoDaId: true,
        chiave: true,
        nomeFile: true,
        mimeType: true,
      },
    });
  }

  async leggi(id: number): Promise<{ buffer: Buffer; mimeType: string; nomeFile: string } | null> {
    if (!this.isConfigured()) {
      throw new Error('Allegati non configurati: credenziali R2 mancanti');
    }

    const allegato = await this.getById(id);
    if (!allegato) return null;

    return {
      buffer: await this.leggiChiave(allegato.chiave),
      mimeType: allegato.mimeType,
      nomeFile: allegato.nomeFile,
    };
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

  /**
   * I byte delle foto di un verbale, per il PDF e la mail. Si ferma prima di
   * superare `maxTotaleBytes`: oltre, la mail rimbalzerebbe.
   */
  async fileDiNoleggio(noleggioId: number, maxTotaleBytes: number): Promise<FileNoleggio[]> {
    if (!this.isConfigured()) return [];

    const allegati = await this.prisma.allegatoNoleggio.findMany({
      where: { noleggioId },
      select: { tipo: true, chiave: true, nomeFile: true, mimeType: true, dimensione: true },
      orderBy: { id: 'asc' },
    });

    const risultato: FileNoleggio[] = [];
    let totale = 0;

    for (const allegato of allegati) {
      if (totale + allegato.dimensione > maxTotaleBytes) break;
      risultato.push({
        tipo: allegato.tipo,
        nomeFile: allegato.nomeFile,
        mimeType: allegato.mimeType,
        buffer: await this.leggiChiave(allegato.chiave),
      });
      totale += allegato.dimensione;
    }

    return risultato;
  }

  /** Solo un orfano proprio: dopo la firma il verbale non si tocca piu'. */
  async rimuoviOrfano(id: number, utenteId: number): Promise<boolean> {
    const allegato = await this.prisma.allegatoNoleggio.findFirst({
      where: { id, noleggioId: null, caricatoDaId: utenteId },
      select: { id: true, chiave: true },
    });

    if (!allegato) return false;

    await this.rimuoviChiavi([allegato.chiave]);
    await this.prisma.allegatoNoleggio.delete({ where: { id: allegato.id } });

    return true;
  }

  async chiaviDiNoleggio(noleggioId: number): Promise<string[]> {
    const allegati = await this.prisma.allegatoNoleggio.findMany({
      where: { noleggioId },
      select: { chiave: true },
    });

    return allegati.map((a) => a.chiave);
  }

  /** Un oggetto che resta su R2 non costa nulla: gli errori non propagano. */
  async rimuoviChiavi(chiavi: string[]): Promise<void> {
    if (!this.isConfigured() || chiavi.length === 0) return;

    for (const chiave of chiavi) {
      try {
        await this.s3Client!.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: chiave }));
      } catch (error) {
        console.error(`[AllegatiNoleggio] Impossibile cancellare ${chiave}:`, error);
      }
    }
  }

  /** Foto caricate e mai collegate a un verbale: form abbandonati. */
  async pulisciOrfani(oreMax = 24): Promise<number> {
    const limite = new Date(Date.now() - oreMax * 60 * 60 * 1000);

    const orfani = await this.prisma.allegatoNoleggio.findMany({
      where: { noleggioId: null, createdAt: { lt: limite } },
      select: { id: true, chiave: true },
    });

    let rimossi = 0;

    for (const orfano of orfani) {
      try {
        if (this.isConfigured()) {
          await this.s3Client!.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: orfano.chiave }));
        }
        await this.prisma.allegatoNoleggio.delete({ where: { id: orfano.id } });
        rimossi++;
      } catch (error) {
        console.error(`[AllegatiNoleggio] Pulizia orfano ${orfano.id} fallita:`, error);
      }
    }

    return rimossi;
  }
}
