import { PrismaClient } from '@prisma/client';
import { nomeUtente } from '../utils/nomeUtente.js';

const MESE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface RigaSaldoOre {
  utenteId: number;
  utenteNome: string;
  oreDovuteMinuti: number;
  oreEffettuateMinuti: number;
  /** Effettuate meno dovute: positiva se il dipendente ha lavorato di piu'. */
  differenzaMinuti: number;
  /** Somma delle differenze da gennaio al mese richiesto compreso. */
  saldoCumulativoMinuti: number;
}

/**
 * Minuti dovuti da un dipendente in un mese.
 *
 * Segnaposto: le ore dovute arriveranno da una tabella dedicata, finche' non
 * esiste valgono zero. Il saldo le somma gia' mese per mese, quindi quando la
 * tabella arriva va riscritta solo questa funzione.
 */
function minutiDovuti(_utenteId: number, _anno: number, _mese: number): number {
  return 0;
}

/** Primo giorno del mese a mezzanotte UTC, come Prisma rilegge le @db.Date. */
function inizioMese(anno: number, mese: number): Date {
  return new Date(Date.UTC(anno, mese - 1, 1));
}

export class SaldiOreService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Saldi ore del mese `YYYY-MM`, una riga per dipendente.
   *
   * Le ore effettuate sono le sole attivita' di lavoro: le assenze restano
   * fuori, comprese quelle che valgono una giornata piena (Vacanza, Malattia),
   * che andranno scalate dalle ore dovute. Il "Recupero ore" non ha bisogno di
   * un caso a parte: il giorno recuperato non ha ore di lavoro e il saldo cala
   * da solo. Il cumulativo riparte da zero a gennaio.
   */
  async getMese(meseKey: string): Promise<RigaSaldoOre[]> {
    const match = MESE.exec(meseKey);
    if (!match) {
      throw new Error(`Mese non valido: ${meseKey}`);
    }

    const anno = Number(match[1]);
    const mese = Number(match[2]);
    const lavoro = { assenzaId: null };

    const [delMese, dallInizioAnno] = await Promise.all([
      this.prisma.attivita.groupBy({
        by: ['utenteId'],
        where: {
          ...lavoro,
          dataRiferimento: { gte: inizioMese(anno, mese), lt: inizioMese(anno, mese + 1) },
        },
        _sum: { durataMinuti: true },
      }),
      this.prisma.attivita.groupBy({
        by: ['utenteId'],
        where: {
          ...lavoro,
          dataRiferimento: { gte: inizioMese(anno, 1), lt: inizioMese(anno, mese + 1) },
        },
        _sum: { durataMinuti: true },
      }),
    ]);

    const minutiMese = new Map(delMese.map((r) => [r.utenteId, r._sum.durataMinuti ?? 0]));
    const minutiAnno = new Map(dallInizioAnno.map((r) => [r.utenteId, r._sum.durataMinuti ?? 0]));

    // I dipendenti attivi compaiono anche a zero ore, perche' con le ore dovute
    // un mese vuoto e' un saldo negativo. Chiunque altro (responsabili,
    // dipendenti disattivati) solo se ha lavorato nell'anno: il suo saldo
    // esiste comunque
    const utenti = await this.prisma.utente.findMany({
      where: {
        OR: [
          { attivo: true, ruolo: 'DIPENDENTE' },
          { id: { in: [...minutiAnno.keys()] } },
        ],
      },
      select: { id: true, nome: true, cognome: true },
      orderBy: [{ ruolo: 'asc' }, { cognome: 'asc' }, { nome: 'asc' }],
    });

    return utenti.map((u) => {
      const oreDovuteMinuti = minutiDovuti(u.id, anno, mese);
      const oreEffettuateMinuti = minutiMese.get(u.id) ?? 0;

      let dovuteAnno = 0;
      for (let m = 1; m <= mese; m++) {
        dovuteAnno += minutiDovuti(u.id, anno, m);
      }

      return {
        utenteId: u.id,
        utenteNome: nomeUtente(u),
        oreDovuteMinuti,
        oreEffettuateMinuti,
        differenzaMinuti: oreEffettuateMinuti - oreDovuteMinuti,
        saldoCumulativoMinuti: (minutiAnno.get(u.id) ?? 0) - dovuteAnno,
      };
    });
  }
}
