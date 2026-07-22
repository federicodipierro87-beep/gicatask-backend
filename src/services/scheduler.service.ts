import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { BackupService } from './backup.service.js';

export function initScheduler(prisma: PrismaClient) {
  const backupService = new BackupService(prisma);

  // Daily backup at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('[Scheduler] Starting automatic backup...');
    try {
      const result = await backupService.createBackup('AUTOMATICO');
      console.log(`[Scheduler] Backup completed: ${result.filename}`);
    } catch (error) {
      console.error('[Scheduler] Backup failed:', error instanceof Error ? error.message : error);
    }
  }, {
    timezone: 'Europe/Rome',
  });

  console.log('[Scheduler] Automatic backup scheduled for 2:00 AM (Europe/Rome)');
}
