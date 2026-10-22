import type { LuogoAttivita } from '@prisma/client';

/** Come si legge il luogo di un'attivita' di "Nuova Attivita 2" nei report. */
export const NOMI_LUOGO: Record<LuogoAttivita, string> = {
  MAGAZZINO: 'Magazzino',
  CANTIERE: 'Cantiere',
};
