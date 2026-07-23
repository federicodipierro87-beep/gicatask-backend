import { PrismaClient, TipoBackup, StatoBackup } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

interface BackupData {
  version: string;
  createdAt: string;
  tables: {
    utenti: any[];
    clienti: any[];
    cantieri: any[];
    tipiAttivita: any[];
    attivita: any[];
    configurazioni: any[];
  };
}

export class BackupService {
  private s3Client: S3Client | null = null;
  private bucketName: string;

  constructor(private prisma: PrismaClient) {
    this.bucketName = process.env.R2_BUCKET_NAME || 'gicatask-backups';

    // Only initialize S3 client if credentials are provided
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

  private isConfigured(): boolean {
    return this.s3Client !== null;
  }

  async createBackup(tipo: TipoBackup = 'MANUALE'): Promise<{ id: number; filename: string }> {
    if (!this.isConfigured()) {
      throw new Error('Backup non configurato: credenziali R2 mancanti');
    }

    // Create log entry
    const backupLog = await this.prisma.backupLog.create({
      data: {
        filename: '',
        tipo,
        dimensione: 0,
        stato: 'IN_CORSO',
      },
    });

    try {
      // Export all data
      const backupData: BackupData = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        tables: {
          utenti: await this.prisma.utente.findMany(),
          clienti: await this.prisma.cliente.findMany(),
          cantieri: await this.prisma.cantiere.findMany(),
          tipiAttivita: await this.prisma.tipoAttivita.findMany(),
          attivita: await this.prisma.attivita.findMany(),
          configurazioni: await this.prisma.configurazione.findMany(),
        },
      };

      const jsonData = JSON.stringify(backupData, null, 2);
      const buffer = Buffer.from(jsonData, 'utf-8');
      const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

      // Upload to R2
      try {
        await this.s3Client!.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: filename,
            Body: buffer,
            ContentType: 'application/json',
          })
        );
      } catch (uploadError: any) {
        console.error('[Backup] R2 upload error:', {
          message: uploadError.message,
          code: uploadError.Code || uploadError.code,
          bucket: this.bucketName,
        });
        throw new Error(`Errore upload R2: ${uploadError.message || 'Access denied - verifica credenziali e permessi'}`);
      }

      // Update log entry
      await this.prisma.backupLog.update({
        where: { id: backupLog.id },
        data: {
          filename,
          dimensione: buffer.length,
          stato: 'COMPLETATO',
        },
      });

      return { id: backupLog.id, filename };
    } catch (error) {
      // Update log with error
      await this.prisma.backupLog.update({
        where: { id: backupLog.id },
        data: {
          stato: 'ERRORE',
          filename: `error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });
      throw error;
    }
  }

  async listBackups() {
    const logs = await this.prisma.backupLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return logs.map((log) => ({
      id: log.id,
      filename: log.filename,
      tipo: log.tipo,
      dimensione: log.dimensione,
      stato: log.stato,
      createdAt: log.createdAt,
      dimensioneFormatted: this.formatBytes(log.dimensione),
    }));
  }

  async getBackupById(id: number) {
    return this.prisma.backupLog.findUnique({
      where: { id },
    });
  }

  async downloadBackup(filename: string): Promise<BackupData> {
    if (!this.isConfigured()) {
      throw new Error('Backup non configurato: credenziali R2 mancanti');
    }

    const response = await this.s3Client!.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: filename,
      })
    );

    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const jsonString = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(jsonString) as BackupData;
  }

  async restoreBackup(id: number): Promise<{ restored: boolean; stats: Record<string, number> }> {
    const backupLog = await this.prisma.backupLog.findUnique({
      where: { id },
    });

    if (!backupLog) {
      throw new Error('Backup non trovato');
    }

    if (backupLog.stato !== 'COMPLETATO') {
      throw new Error('Impossibile ripristinare un backup non completato');
    }

    const backupData = await this.downloadBackup(backupLog.filename);

    // Restore in transaction
    const stats: Record<string, number> = {};

    await this.prisma.$transaction(async (tx) => {
      // Delete existing data (in reverse order of dependencies)
      await tx.attivita.deleteMany();
      await tx.tipoAttivita.deleteMany();
      await tx.cantiere.deleteMany();
      await tx.cliente.deleteMany();
      await tx.utente.deleteMany();
      await tx.configurazione.deleteMany();

      // Restore data (in order of dependencies)
      if (backupData.tables.utenti.length > 0) {
        await tx.utente.createMany({ data: backupData.tables.utenti });
        stats.utenti = backupData.tables.utenti.length;
      }

      if (backupData.tables.clienti.length > 0) {
        await tx.cliente.createMany({ data: backupData.tables.clienti });
        stats.clienti = backupData.tables.clienti.length;
      }

      if (backupData.tables.cantieri.length > 0) {
        await tx.cantiere.createMany({ data: backupData.tables.cantieri });
        stats.cantieri = backupData.tables.cantieri.length;
      }

      if (backupData.tables.tipiAttivita.length > 0) {
        await tx.tipoAttivita.createMany({ data: backupData.tables.tipiAttivita });
        stats.tipiAttivita = backupData.tables.tipiAttivita.length;
      }

      if (backupData.tables.attivita.length > 0) {
        await tx.attivita.createMany({ data: backupData.tables.attivita });
        stats.attivita = backupData.tables.attivita.length;
      }

      if (backupData.tables.configurazioni.length > 0) {
        await tx.configurazione.createMany({ data: backupData.tables.configurazioni });
        stats.configurazioni = backupData.tables.configurazioni.length;
      }

      // Reset sequences for PostgreSQL
      const tables = ['utenti', 'clienti', 'cantieri', 'tipi_attivita', 'attivita', 'configurazioni'];
      for (const table of tables) {
        try {
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`
          );
        } catch {
          // Ignore if table doesn't exist or has no sequence
        }
      }
    });

    return { restored: true, stats };
  }

  async deleteBackup(id: number): Promise<void> {
    const backupLog = await this.prisma.backupLog.findUnique({
      where: { id },
    });

    if (!backupLog) {
      throw new Error('Backup non trovato');
    }

    // Delete from R2 if configured and file exists
    if (this.isConfigured() && backupLog.stato === 'COMPLETATO') {
      try {
        await this.s3Client!.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: backupLog.filename,
          })
        );
      } catch {
        // Ignore errors deleting from R2
      }
    }

    // Delete log entry
    await this.prisma.backupLog.delete({
      where: { id },
    });
  }

  async getStatus(): Promise<{
    configured: boolean;
    lastBackup: { date: string; stato: string } | null;
    totalBackups: number;
    config?: { accountId: string; bucket: string };
  }> {
    const lastBackup = await this.prisma.backupLog.findFirst({
      where: { stato: 'COMPLETATO' },
      orderBy: { createdAt: 'desc' },
    });

    const totalBackups = await this.prisma.backupLog.count({
      where: { stato: 'COMPLETATO' },
    });

    return {
      configured: this.isConfigured(),
      lastBackup: lastBackup
        ? { date: lastBackup.createdAt.toISOString(), stato: lastBackup.stato }
        : null,
      totalBackups,
      // Show partial config for debugging (not secrets)
      config: this.isConfigured() ? {
        accountId: process.env.R2_ACCOUNT_ID?.substring(0, 8) + '...',
        bucket: this.bucketName,
      } : undefined,
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) {
      return { success: false, message: 'R2 non configurato' };
    }

    try {
      // Try to list objects (even if empty) to test connection
      await this.s3Client!.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          MaxKeys: 1,
        })
      );
      return { success: true, message: 'Connessione R2 OK' };
    } catch (error: any) {
      return {
        success: false,
        message: `Errore R2: ${error.message || error.Code || 'Unknown'}`
      };
    }
  }

  async cleanupOldBackups(daysToKeep: number = 7): Promise<{ deleted: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // Find old completed backups
    const oldBackups = await this.prisma.backupLog.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        stato: 'COMPLETATO',
      },
    });

    let deleted = 0;

    for (const backup of oldBackups) {
      try {
        // Delete from R2
        if (this.isConfigured()) {
          await this.s3Client!.send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: backup.filename,
            })
          );
        }

        // Delete log entry
        await this.prisma.backupLog.delete({
          where: { id: backup.id },
        });

        deleted++;
        console.log(`[Backup] Deleted old backup: ${backup.filename}`);
      } catch (error) {
        console.error(`[Backup] Failed to delete backup ${backup.id}:`, error);
      }
    }

    // Also delete old error logs (older than 30 days)
    await this.prisma.backupLog.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        stato: 'ERRORE',
      },
    });

    return { deleted };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
