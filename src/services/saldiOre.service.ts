import { PrismaClient } from '@prisma/client';
import { nomeUtente } from '../utils/nomeUtente.js';
import { minutiPerPercentuale } from './oreDovute.service.js';

const MESE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface RigaSaldoOre {
  utenteId: number;
  utenteNome: string;
  percentualeLavoro: number;
  oreDovuteMinuti: number;
  oreEffettuateMinuti: number;
  /** Effettuate meno dovute: positiva se il dipendente ha lavorato di piu'. */
  differenzaMinuti: number;
  /** Somma delle differenze da gennaio al mese richiesto compreso. */
  saldoCumulativoMinuti: number;
}

export interface SaldiOreMese {
  righe: RigaSaldoOre[];
  /**
   * Mesi da gennaio a quello richiesto senza ore dovute impostate: valgono
   * zero, quindi differenza e saldo di quei mesi sono gonfiati.
   */
  mesiSenzaOreDovute: number[];
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
   * e non riducono le ore dovute: e' una scelta, un giorno di assenza fa
   * scendere il saldo. Il cumulativo riparte da zero a gennaio.
   */
  async getMese(meseKey: string): Promise<SaldiOreMese> {
    const match = MESE.exec(meseKey);
    if (!match) {
      throw new Error(`Mese non valido: ${meseKey}`);
    }

    const anno = Number(match[1]);
    const mese = Number(match[2]);
    const lavoro = { assenzaId: null };

    const [delMese, dallInizioAnno, oreDovute] = await Promise.all([
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
      this.prisma.oreDovuteMese.findMany({ where: { anno, mese: { lte: mese } } }),
    ]);

    // Minuti dovuti a tempo pieno, da gennaio al mese richiesto
    const tempoPieno = new Map(oreDovute.map((r) => [r.mese, r.minuti]));
    const mesiDelPeriodo = Array.from({ length: mese }, (_, i) => i + 1);

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
      select: { id: true, nome: true, cognome: true, percentualeLavoro: true },
      orderBy: [{ ruolo: 'asc' }, { cognome: 'asc' }, { nome: 'asc' }],
    });

    const righe = utenti.map((u) => {
      // La percentuale e' quella di oggi e vale per tutti i mesi: cambiarla
      // ricalcola anche i saldi dei mesi passati
      const dovuti = (m: number) =>
        minutiPerPercentuale(tempoPieno.get(m) ?? 0, u.percentualeLavoro);

      const oreDovuteMinuti = dovuti(mese);
      const oreEffettuateMinuti = minutiMese.get(u.id) ?? 0;
      const dovuteAnno = mesiDelPeriodo.reduce((tot, m) => tot + dovuti(m), 0);

      return {
        utenteId: u.id,
        utenteNome: nomeUtente(u),
        percentualeLavoro: u.percentualeLavoro,
        oreDovuteMinuti,
        oreEffettuateMinuti,
        differenzaMinuti: oreEffettuateMinuti - oreDovuteMinuti,
        saldoCumulativoMinuti: (minutiAnno.get(u.id) ?? 0) - dovuteAnno,
      };
    });

    return {
      righe,
      mesiSenzaOreDovute: mesiDelPeriodo.filter((m) => !tempoPieno.has(m)),
    };
  }
}
