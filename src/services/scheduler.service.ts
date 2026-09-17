import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { BackupService } from './backup.service.js';
import { AllegatiBollettinoService } from './allegatiBollettino.service.js';

const BACKUP_RETENTION_DAYS = 7;
/** Chi carica una foto e abbandona il form lascia un oggetto senza padre. */
const ALLEGATI_ORFANI_ORE = 24;

export function initScheduler(prisma: PrismaClient) {
  const backupService = new BackupService(prisma);
  const allegatiService = new AllegatiBollettinoService(prisma);

  // Daily backup at 2:00 AM + cleanup old backups
  cron.schedule('0 2 * * *', async () => {
    console.log('[Scheduler] Starting automatic backup...');
    try {
      const result = await backupService.createBackup('AUTOMATICO');
      console.log(`[Scheduler] Backup completed: ${result.filename}`);

      // Cleanup backups older than 7 days
      console.log(`[Scheduler] Cleaning up backups older than ${BACKUP_RETENTION_DAYS} days...`);
      const cleanup = await backupService.cleanupOldBackups(BACKUP_RETENTION_DAYS);
      console.log(`[Scheduler] Cleanup completed: ${cleanup.deleted} old backups deleted`);
    } catch (error) {
      console.error('[Scheduler] Backup/cleanup failed:', error instanceof Error ? error.message : error);
    }
  }, {
    timezone: 'Europe/Rome',
  });

  // Dopo il backup: la pulizia tocca solo il prefisso allegati/ del bucket,
  // ma non c'e' motivo di farle correre insieme
  cron.schedule('30 2 * * *', async () => {
    console.log('[Scheduler] Cleaning up orphaned bollettino attachments...');
    try {
      const rimossi = await allegatiService.pulisciOrfani(ALLEGATI_ORFANI_ORE);
      console.log(`[Scheduler] Orphaned attachments cleanup completed: ${rimossi} deleted`);
    } catch (error) {
      console.error('[Scheduler] Attachment cleanup failed:', error instanceof Error ? error.message : error);
    }
  }, {
    timezone: 'Europe/Rome',
  });

  console.log(`[Scheduler] Automatic backup scheduled for 2:00 AM (Europe/Rome), retention: ${BACKUP_RETENTION_DAYS} days`);
  console.log(`[Scheduler] Orphaned attachment cleanup scheduled for 2:30 AM (Europe/Rome), after ${ALLEGATI_ORFANI_ORE}h`);
}
