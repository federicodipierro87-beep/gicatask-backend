/**
 * Gira prima di `prisma db push`, nello start.
 *
 * Il campo Cliente del noleggio Dream puntava all'anagrafica generale
 * `clienti`, ora punta a `dream_clienti`. I riferimenti salvati prima del
 * cambio non trovano corrispondenza nella tabella nuova, e finche' restano
 * dove sono il vincolo di chiave esterna non si lascia creare: `prisma db
 * push` fallisce e, stando nello start, il container non parte affatto.
 *
 * Azzera i soli riferimenti orfani, quindi a vincolo creato non ha piu' nulla
 * da fare ed e' innocuo a ogni deploy successivo.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function tabellaEsiste(nome: string): Promise<boolean> {
  const righe = await prisma.$queryRaw<{ presente: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${nome}
    ) AS presente
  `;

  return righe[0]?.presente ?? false;
}

async function main(): Promise<void> {
  // Su un database vuoto non c'e' niente da riparare: le tabelle le crea il
  // push subito dopo
  if (!(await tabellaEsiste('dream_noleggi'))) return;

  // Il push fallito puo' aver lasciato la tabella nuova gia' creata, o no:
  // vale il caso in cui l'anagrafica non c'e' ancora e nessun riferimento
  // puo' essere valido
  const azzerati = (await tabellaEsiste('dream_clienti'))
    ? await prisma.$executeRaw`
        UPDATE dream_noleggi SET cliente_id = NULL
        WHERE cliente_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM dream_clienti d WHERE d.id = dream_noleggi.cliente_id
          )
      `
    : await prisma.$executeRaw`
        UPDATE dream_noleggi SET cliente_id = NULL WHERE cliente_id IS NOT NULL
      `;

  if (azzerati > 0) {
    console.log(`[prepara-db] Azzerati ${azzerati} riferimenti cliente orfani sui noleggi Dream`);
  }
}

/**
 * La foto del dipendente ha aggiunto `schede_hr.foto_id` con un vincolo di
 * unicita'. Su una tabella gia' popolata `prisma db push` rifiuta di creare il
 * vincolo senza `--accept-data-loss`, anche se la colonna e' nuova e tutta
 * NULL: il push fallirebbe e il container non partirebbe. Creando qui colonna
 * e indice, col nome che userebbe Prisma, al push resta solo la chiave esterna,
 * che non chiede conferme. Ai deploy successivi e' innocuo.
 */
async function preparaFotoSchedeHr(): Promise<void> {
  if (!(await tabellaEsiste('schede_hr'))) return;

  await prisma.$executeRaw`ALTER TABLE schede_hr ADD COLUMN IF NOT EXISTS foto_id INTEGER`;
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX IF NOT EXISTS schede_hr_foto_id_key ON schede_hr (foto_id)
  `;
}

try {
  await main();
  await preparaFotoSchedeHr();
} catch (errore) {
  console.error('[prepara-db] Errore:', errore);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
