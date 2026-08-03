import { PrismaClient } from '@prisma/client';

const TIPI_ASSENZA_DEFAULT = ['Vacanza', 'Infortunio', 'Malattia', 'Congedo'];

export async function seedTipiAssenza(prisma: PrismaClient): Promise<void> {
  try {
    const count = await prisma.tipoAssenza.count();
    if (count > 0) return;

    const result = await prisma.tipoAssenza.createMany({
      data: TIPI_ASSENZA_DEFAULT.map((nome) => ({ nome })),
      skipDuplicates: true,
    });
    console.log(`[Seed] tipi_assenza: creati ${result.count} valori di default`);
  } catch (error) {
    console.error('[Seed] Impossibile inizializzare tipi_assenza:', error);
  }
}
