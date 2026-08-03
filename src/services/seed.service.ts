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

export async function removeCantieriGenerici(prisma: PrismaClient): Promise<void> {
  try {
    const generici = await prisma.cantiere.findMany({
      where: { isGenerico: true },
      select: { id: true },
    });
    if (generici.length === 0) return;

    const ids = generici.map((c) => c.id);

    const [detached, deleted] = await prisma.$transaction([
      prisma.attivita.updateMany({
        where: { cantiereId: { in: ids } },
        data: { cantiereId: null },
      }),
      prisma.cantiere.deleteMany({ where: { id: { in: ids } } }),
    ]);

    console.log(
      `[Cleanup] cantieri generici: ${deleted.count} eliminati, ${detached.count} attività scollegate`
    );
  } catch (error) {
    console.error('[Cleanup] Impossibile rimuovere i cantieri generici:', error);
  }
}
