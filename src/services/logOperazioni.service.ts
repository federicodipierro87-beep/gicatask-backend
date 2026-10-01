import { Prisma, PrismaClient } from '@prisma/client';
import { nomeUtente } from '../utils/nomeUtente.js';
import { numeroBollettino } from './bollettinoPdf.service.js';

export type AzioneLog =
  | 'ACCESSO'
  | 'USCITA'
  | 'CREAZIONE'
  | 'MODIFICA'
  | 'ELIMINAZIONE'
  | 'DISATTIVAZIONE'
  | 'RIATTIVAZIONE'
  | 'DOWNLOAD'
  | 'ALTRO';

type Modello =
  | 'utente'
  | 'cliente'
  | 'cantiere'
  | 'tipoAttivita'
  | 'tipoAssenza'
  | 'attivita'
  | 'bollettino'
  | 'voceBollettino'
  | 'calendarioEvento'
  | 'dreamVeicolo'
  | 'dreamCliente'
  | 'dreamNoleggio'
  | 'gicaNoleggio'
  | 'schedaHr'
  | 'backupLog';

export interface VoceCatalogo {
  area: string;
  azione: AzioneLog;
  testo: string;
  /** Record a cui si riferisce l'operazione, letto da `params.id`. */
  modello?: Modello;
  /** Registra anche i dati inviati: servono quando il record non mostra il cambiamento. */
  corpo?: boolean;
}

/**
 * Le operazioni registrate, per "METODO rotta". Le scritture che mancano qui
 * finiscono comunque nel registro come ALTRO, con metodo e percorso: una rotta
 * nuova non sparisce dal log solo perche' nessuno l'ha aggiunta al catalogo.
 * Le letture invece entrano solo se elencate (export, PDF e file scaricati).
 */
const CATALOGO: Record<string, VoceCatalogo> = {
  'POST /api/auth/login': { area: 'Accesso', azione: 'ACCESSO', testo: 'Accesso' },
  'POST /api/auth/logout': { area: 'Accesso', azione: 'USCITA', testo: 'Uscita' },

  'POST /api/attivita': { area: 'Attività', azione: 'CREAZIONE', testo: 'Nuova attività', modello: 'attivita' },
  'PUT /api/attivita/:id': { area: 'Attività', azione: 'MODIFICA', testo: 'Modifica attività', modello: 'attivita' },
  'DELETE /api/attivita/:id': { area: 'Attività', azione: 'ELIMINAZIONE', testo: 'Eliminazione attività', modello: 'attivita' },
  'GET /api/attivita/export/pdf': { area: 'Report', azione: 'DOWNLOAD', testo: 'Export PDF report attività' },
  'GET /api/attivita/export/excel': { area: 'Report', azione: 'DOWNLOAD', testo: 'Export Excel report attività' },
  'GET /api/attivita/saldi-ore/export/pdf': { area: 'Report', azione: 'DOWNLOAD', testo: 'Export PDF saldi ore' },
  'GET /api/attivita/saldi-ore/export/excel': { area: 'Report', azione: 'DOWNLOAD', testo: 'Export Excel saldi ore' },

  'POST /api/clienti': { area: 'Clienti', azione: 'CREAZIONE', testo: 'Nuovo cliente', modello: 'cliente' },
  'PUT /api/clienti/:id': { area: 'Clienti', azione: 'MODIFICA', testo: 'Modifica cliente', modello: 'cliente' },
  'DELETE /api/clienti/:id': { area: 'Clienti', azione: 'DISATTIVAZIONE', testo: 'Disattivazione cliente', modello: 'cliente' },
  'POST /api/clienti/:id/activate': { area: 'Clienti', azione: 'RIATTIVAZIONE', testo: 'Riattivazione cliente', modello: 'cliente' },

  'POST /api/cantieri': { area: 'Cantieri', azione: 'CREAZIONE', testo: 'Nuovo cantiere', modello: 'cantiere' },
  'PUT /api/cantieri/:id': { area: 'Cantieri', azione: 'MODIFICA', testo: 'Modifica cantiere', modello: 'cantiere' },
  'DELETE /api/cantieri/:id': { area: 'Cantieri', azione: 'DISATTIVAZIONE', testo: 'Disattivazione cantiere', modello: 'cantiere' },
  'POST /api/cantieri/:id/activate': { area: 'Cantieri', azione: 'RIATTIVAZIONE', testo: 'Riattivazione cantiere', modello: 'cantiere' },

  'POST /api/tipi-attivita': { area: 'Tipi attività', azione: 'CREAZIONE', testo: 'Nuovo tipo attività', modello: 'tipoAttivita' },
  'PUT /api/tipi-attivita/:id': { area: 'Tipi attività', azione: 'MODIFICA', testo: 'Modifica tipo attività', modello: 'tipoAttivita' },
  'DELETE /api/tipi-attivita/:id': { area: 'Tipi attività', azione: 'DISATTIVAZIONE', testo: 'Disattivazione tipo attività', modello: 'tipoAttivita' },
  'POST /api/tipi-attivita/:id/activate': { area: 'Tipi attività', azione: 'RIATTIVAZIONE', testo: 'Riattivazione tipo attività', modello: 'tipoAttivita' },

  'POST /api/tipi-assenza': { area: 'Assenze', azione: 'CREAZIONE', testo: 'Nuovo tipo assenza', modello: 'tipoAssenza' },
  'PUT /api/tipi-assenza/:id': { area: 'Assenze', azione: 'MODIFICA', testo: 'Modifica tipo assenza', modello: 'tipoAssenza' },
  'DELETE /api/tipi-assenza/:id': { area: 'Assenze', azione: 'DISATTIVAZIONE', testo: 'Disattivazione tipo assenza', modello: 'tipoAssenza' },
  'POST /api/tipi-assenza/:id/activate': { area: 'Assenze', azione: 'RIATTIVAZIONE', testo: 'Riattivazione tipo assenza', modello: 'tipoAssenza' },

  'POST /api/utenti': { area: 'Utenti', azione: 'CREAZIONE', testo: 'Nuovo utente', modello: 'utente' },
  'PUT /api/utenti/:id': { area: 'Utenti', azione: 'MODIFICA', testo: 'Modifica utente', modello: 'utente' },
  'POST /api/utenti/:id/percentuali': { area: 'Utenti', azione: 'MODIFICA', testo: 'Variazione percentuale di lavoro', modello: 'utente', corpo: true },
  'DELETE /api/utenti/:id/percentuali/:variazioneId': { area: 'Utenti', azione: 'MODIFICA', testo: 'Rimozione variazione percentuale di lavoro', modello: 'utente', corpo: true },
  'POST /api/utenti/:id/password': { area: 'Utenti', azione: 'MODIFICA', testo: 'Cambio password', modello: 'utente' },
  'DELETE /api/utenti/:id': { area: 'Utenti', azione: 'DISATTIVAZIONE', testo: 'Disattivazione utente', modello: 'utente' },
  'POST /api/utenti/:id/activate': { area: 'Utenti', azione: 'RIATTIVAZIONE', testo: 'Riattivazione utente', modello: 'utente' },

  'POST /api/backup': { area: 'Backup', azione: 'ALTRO', testo: 'Backup manuale' },
  'POST /api/backup/:id/restore': { area: 'Backup', azione: 'ALTRO', testo: 'Ripristino backup', modello: 'backupLog' },
  'DELETE /api/backup/:id': { area: 'Backup', azione: 'ELIMINAZIONE', testo: 'Eliminazione backup', modello: 'backupLog' },
  'GET /api/backup/test': { area: 'Backup', azione: 'ALTRO', testo: 'Test connessione backup' },

  'POST /api/import/excel': { area: 'Import', azione: 'ALTRO', testo: 'Import da Excel' },
  'POST /api/import/vecchi-lavori/analisi': { area: 'Import', azione: 'ALTRO', testo: 'Analisi import vecchi lavori' },
  'POST /api/import/vecchi-lavori/importa': { area: 'Import', azione: 'ALTRO', testo: 'Import vecchi lavori' },
  'GET /api/import/template': { area: 'Import', azione: 'DOWNLOAD', testo: 'Download modello import' },

  'POST /api/voci-bollettino/:tipo': { area: 'Banca dati bollettini', azione: 'CREAZIONE', testo: 'Nuova voce bollettino', modello: 'voceBollettino' },
  'PUT /api/voci-bollettino/:id': { area: 'Banca dati bollettini', azione: 'MODIFICA', testo: 'Modifica voce bollettino', modello: 'voceBollettino' },
  'DELETE /api/voci-bollettino/:id': { area: 'Banca dati bollettini', azione: 'DISATTIVAZIONE', testo: 'Disattivazione voce bollettino', modello: 'voceBollettino' },
  'POST /api/voci-bollettino/:id/activate': { area: 'Banca dati bollettini', azione: 'RIATTIVAZIONE', testo: 'Riattivazione voce bollettino', modello: 'voceBollettino' },

  'POST /api/bollettini': { area: 'Bollettini', azione: 'CREAZIONE', testo: 'Nuovo bollettino', modello: 'bollettino' },
  'POST /api/bollettini/allegati': { area: 'Bollettini', azione: 'ALTRO', testo: 'Caricamento allegato bollettino' },
  'DELETE /api/bollettini/allegati/:id': { area: 'Bollettini', azione: 'ELIMINAZIONE', testo: 'Eliminazione allegato bollettino' },
  'POST /api/bollettini/:id/invia-mail': { area: 'Bollettini', azione: 'ALTRO', testo: 'Invio bollettino per e-mail', modello: 'bollettino' },
  'PATCH /api/bollettini/:id/fatturato': { area: 'Bollettini', azione: 'MODIFICA', testo: 'Cambio stato fatturato', modello: 'bollettino' },
  'DELETE /api/bollettini/:id': { area: 'Bollettini', azione: 'ELIMINAZIONE', testo: 'Eliminazione bollettino', modello: 'bollettino' },
  'GET /api/bollettini/:id/pdf': { area: 'Bollettini', azione: 'DOWNLOAD', testo: 'Download PDF bollettino', modello: 'bollettino' },
  'GET /api/bollettini/cantiere/:cantiereId/pdf': { area: 'Bollettini', azione: 'DOWNLOAD', testo: 'Download PDF cumulativo cantiere' },
  'GET /api/bollettini/cliente/:clienteId/pdf': { area: 'Bollettini', azione: 'DOWNLOAD', testo: 'Download PDF cumulativo cliente' },
  'GET /api/bollettini/allegati/:id/file': { area: 'Bollettini', azione: 'DOWNLOAD', testo: 'Apertura allegato bollettino' },

  'POST /api/calendario-eventi': { area: 'Calendari eventi', azione: 'CREAZIONE', testo: 'Nuovo evento', modello: 'calendarioEvento' },
  'PUT /api/calendario-eventi/:id': { area: 'Calendari eventi', azione: 'MODIFICA', testo: 'Modifica evento', modello: 'calendarioEvento' },
  'DELETE /api/calendario-eventi/:id': { area: 'Calendari eventi', azione: 'ELIMINAZIONE', testo: 'Eliminazione evento', modello: 'calendarioEvento' },
  'GET /api/calendario-eventi/export/excel': { area: 'Calendari eventi', azione: 'DOWNLOAD', testo: 'Export Excel calendario eventi' },

  'POST /api/dream-veicoli': { area: 'Banca dati veicoli', azione: 'CREAZIONE', testo: 'Nuovo veicolo', modello: 'dreamVeicolo' },
  'PUT /api/dream-veicoli/:id': { area: 'Banca dati veicoli', azione: 'MODIFICA', testo: 'Modifica veicolo', modello: 'dreamVeicolo' },
  'DELETE /api/dream-veicoli/:id': { area: 'Banca dati veicoli', azione: 'DISATTIVAZIONE', testo: 'Disattivazione veicolo', modello: 'dreamVeicolo' },
  'POST /api/dream-veicoli/:id/activate': { area: 'Banca dati veicoli', azione: 'RIATTIVAZIONE', testo: 'Riattivazione veicolo', modello: 'dreamVeicolo' },

  'POST /api/dream-clienti': { area: 'Banca dati clienti', azione: 'CREAZIONE', testo: 'Nuovo cliente noleggio', modello: 'dreamCliente' },
  'PUT /api/dream-clienti/:id': { area: 'Banca dati clienti', azione: 'MODIFICA', testo: 'Modifica cliente noleggio', modello: 'dreamCliente' },
  'DELETE /api/dream-clienti/:id': { area: 'Banca dati clienti', azione: 'DISATTIVAZIONE', testo: 'Disattivazione cliente noleggio', modello: 'dreamCliente' },
  'POST /api/dream-clienti/:id/activate': { area: 'Banca dati clienti', azione: 'RIATTIVAZIONE', testo: 'Riattivazione cliente noleggio', modello: 'dreamCliente' },

  'POST /api/dream-noleggi': { area: 'Dream', azione: 'CREAZIONE', testo: 'Nuovo noleggio Dream', modello: 'dreamNoleggio' },
  'PUT /api/dream-noleggi/:id': { area: 'Dream', azione: 'MODIFICA', testo: 'Modifica noleggio Dream', modello: 'dreamNoleggio' },
  'DELETE /api/dream-noleggi/:id': { area: 'Dream', azione: 'ELIMINAZIONE', testo: 'Eliminazione noleggio Dream', modello: 'dreamNoleggio' },
  'GET /api/dream-noleggi/export/pdf': { area: 'Dream', azione: 'DOWNLOAD', testo: 'Export PDF noleggi Dream' },

  'POST /api/gica-noleggi': { area: 'Gica', azione: 'CREAZIONE', testo: 'Nuovo noleggio Gica', modello: 'gicaNoleggio' },
  'PUT /api/gica-noleggi/:id': { area: 'Gica', azione: 'MODIFICA', testo: 'Modifica noleggio Gica', modello: 'gicaNoleggio' },
  'DELETE /api/gica-noleggi/:id': { area: 'Gica', azione: 'ELIMINAZIONE', testo: 'Eliminazione noleggio Gica', modello: 'gicaNoleggio' },
  'GET /api/gica-noleggi/export/pdf': { area: 'Gica', azione: 'DOWNLOAD', testo: 'Export PDF noleggi Gica' },
  'GET /api/gica-noleggi/export/excel': { area: 'Gica', azione: 'DOWNLOAD', testo: 'Export Excel noleggi Gica' },

  'PUT /api/ore-dovute/:anno': { area: 'Ore dovute', azione: 'MODIFICA', testo: 'Modifica ore dovute' },
  'GET /api/ore-dovute/:anno/export/:formato': { area: 'Ore dovute', azione: 'DOWNLOAD', testo: 'Export ore dovute' },

  'POST /api/hr': { area: 'HR', azione: 'CREAZIONE', testo: 'Nuova scheda HR', modello: 'schedaHr' },
  'PUT /api/hr/:id': { area: 'HR', azione: 'MODIFICA', testo: 'Modifica scheda HR', modello: 'schedaHr' },
  'DELETE /api/hr/:id': { area: 'HR', azione: 'ELIMINAZIONE', testo: 'Eliminazione scheda HR', modello: 'schedaHr' },
  'POST /api/hr/allegati': { area: 'HR', azione: 'ALTRO', testo: 'Caricamento allegato HR' },
  'GET /api/hr/allegati/:id/file': { area: 'HR', azione: 'DOWNLOAD', testo: 'Apertura allegato HR' },
  'GET /api/hr/stampa/schede': { area: 'HR', azione: 'DOWNLOAD', testo: 'Stampa schede HR' },
  'GET /api/hr/stampa/riepilogo': { area: 'HR', azione: 'DOWNLOAD', testo: 'Stampa riepilogo HR' },
};

const METODI_SCRITTURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** La voce di catalogo di una richiesta, o null se non va registrata. */
export function voceCatalogo(metodo: string, rotta: string): VoceCatalogo | null {
  const voce = CATALOGO[`${metodo} ${rotta}`];
  if (voce) return voce;
  if (!METODI_SCRITTURA.has(metodo) || !rotta.startsWith('/api/')) return null;
  return { area: 'Altro', azione: 'ALTRO', testo: `${metodo} ${rotta}` };
}

type Record_ = Record<string, unknown>;

const dataIt = (d: unknown) =>
  d instanceof Date ? d.toISOString().slice(0, 10).split('-').reverse().join('.') : '';

interface DefinizioneModello {
  include?: Record<string, unknown>;
  etichetta: (r: any) => string;
  /** Modello a cui puntano i campi `...Id`, quando non e' quello predefinito. */
  riferimenti?: Record<string, Modello>;
}

const MODELLI: Record<Modello, DefinizioneModello> = {
  utente: { etichetta: (r) => nomeUtente(r) },
  cliente: { etichetta: (r) => r.nome },
  cantiere: { include: { cliente: true }, etichetta: (r) => `${r.nome} (${r.cliente?.nome ?? '-'})` },
  tipoAttivita: { etichetta: (r) => r.nome },
  tipoAssenza: { etichetta: (r) => r.nome },
  attivita: {
    include: { utente: true },
    etichetta: (r) => `${r.utente ? nomeUtente(r.utente) : '-'}, ${dataIt(r.dataRiferimento)}`,
  },
  bollettino: {
    include: { cliente: true },
    etichetta: (r) => `n. ${numeroBollettino(r)}${r.cliente ? `, ${r.cliente.nome}` : ''}`,
  },
  voceBollettino: { etichetta: (r) => r.nome },
  calendarioEvento: {
    include: { cliente: true },
    etichetta: (r) => `${r.nome || r.cliente?.nome || '-'}, ${dataIt(r.dataInizio)} – ${dataIt(r.dataFine)}`,
  },
  dreamVeicolo: { etichetta: (r) => r.nome },
  dreamCliente: { etichetta: (r) => r.nome },
  dreamNoleggio: {
    include: { veicolo: true, cliente: true },
    etichetta: (r) => `${r.veicolo?.nome ?? '-'}, ${r.cliente?.nome ?? 'senza cliente'}, ${dataIt(r.data)}`,
    riferimenti: { clienteId: 'dreamCliente' },
  },
  gicaNoleggio: {
    include: { veicolo: true, cliente: true },
    etichetta: (r) => `${r.veicolo?.nome ?? '-'}, ${r.cliente?.nome ?? 'senza cliente'}, ${dataIt(r.data)}`,
    riferimenti: { clienteId: 'dreamCliente' },
  },
  schedaHr: { etichetta: (r) => r.cognomeNome },
  backupLog: { etichetta: (r) => r.filename },
};

/** A che modello punta un campo `...Id`, salvo override del modello. */
const RIFERIMENTI: Record<string, Modello> = {
  utenteId: 'utente',
  clienteId: 'cliente',
  cantiereId: 'cantiere',
  tipoAttivitaId: 'tipoAttivita',
  assenzaId: 'tipoAssenza',
  veicoloId: 'dreamVeicolo',
};

/** Campi mai copiati nel registro: segreti, immagini base64, timestamp tecnici. */
const CAMPI_ESCLUSI = new Set([
  'id',
  'passwordHash',
  'password',
  'firmaOperatoreImg',
  'firmaCommittenteImg',
  'createdAt',
  'updatedAt',
  'createdById',
]);

const MAX_TESTO = 300;

/** Un valore scalare in forma leggibile e di dimensione limitata. */
function valoreLog(v: unknown): unknown {
  if (v instanceof Date) {
    const iso = v.toISOString();
    // Le colonne @db.Date arrivano a mezzanotte UTC: sono giorni, non istanti
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof v === 'string' && v.length > MAX_TESTO) {
    return `${v.slice(0, MAX_TESTO)}… (${v.length} caratteri)`;
  }
  return v;
}

/** I soli campi scalari di un record, senza relazioni ne' campi esclusi. */
function istantanea(r: Record_): Record_ {
  const out: Record_ = {};
  for (const [k, v] of Object.entries(r)) {
    if (CAMPI_ESCLUSI.has(k)) continue;
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) continue;
    out[k] = valoreLog(v);
  }
  return out;
}

/** Un corpo di richiesta ripulito da segreti e testi lunghi, per le operazioni senza record. */
export function corpoPulito(body: unknown, profondita = 0): unknown {
  if (body === null || body === undefined) return undefined;
  if (Array.isArray(body)) {
    const righe = body.slice(0, 20).map((x) => corpoPulito(x, profondita + 1));
    return body.length > 20 ? [...righe, `… altri ${body.length - 20}`] : righe;
  }
  if (typeof body === 'object') {
    if (profondita > 3) return '…';
    const out: Record_ = {};
    for (const [k, v] of Object.entries(body as Record_)) {
      if (CAMPI_ESCLUSI.has(k) || k === '_t') continue;
      out[k] = corpoPulito(v, profondita + 1);
    }
    return out;
  }
  return valoreLog(body);
}

export interface RecordLetto {
  etichetta: string;
  valori: Record_;
}

export interface VoceLog {
  utenteId: number | null;
  area: string;
  azione: AzioneLog;
  descrizione: string;
  metodo: string;
  percorso: string;
  stato: number;
  esito: boolean;
  errore?: string | null;
  dettaglio?: unknown;
  ip?: string | null;
}

export interface FiltriLog {
  dal?: Date;
  al?: Date;
  utentiIds?: number[];
  aree?: string[];
  azioni?: string[];
  esito?: boolean;
  testo?: string;
  pagina: number;
  perPagina: number;
}

export class LogOperazioniService {
  constructor(private prisma: PrismaClient) {}

  private delegato(modello: Modello): any {
    return (this.prisma as any)[modello];
  }

  /** Etichetta e campi scalari di un record, o null se non c'e' (piu'). */
  async leggi(modello: Modello, id: number): Promise<RecordLetto | null> {
    const def = MODELLI[modello];
    const r = await this.delegato(modello).findUnique({
      where: { id },
      ...(def.include ? { include: def.include } : {}),
    });
    if (!r) return null;
    return { etichetta: def.etichetta(r) || `#${id}`, valori: istantanea(r) };
  }

  /** Sostituisce i valori dei campi `...Id` col nome del record a cui puntano. */
  async risolviRiferimenti(modello: Modello, valori: Record_): Promise<Record_> {
    const out = { ...valori };
    for (const [campo, v] of Object.entries(valori)) {
      const destinazione = MODELLI[modello].riferimenti?.[campo] ?? RIFERIMENTI[campo];
      if (!destinazione || typeof v !== 'number') continue;
      const letto = await this.leggi(destinazione, v).catch(() => null);
      if (letto) out[campo] = letto.etichetta;
    }
    return out;
  }

  /** I campi cambiati fra due letture dello stesso record. */
  async differenze(modello: Modello, prima: Record_, dopo: Record_) {
    const cambiati: Record_ = {};
    const precedenti: Record_ = {};
    for (const campo of new Set([...Object.keys(prima), ...Object.keys(dopo)])) {
      const a = prima[campo] ?? null;
      const b = dopo[campo] ?? null;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      precedenti[campo] = a;
      cambiati[campo] = b;
    }
    const [primaRisolti, dopoRisolti] = await Promise.all([
      this.risolviRiferimenti(modello, precedenti),
      this.risolviRiferimenti(modello, cambiati),
    ]);
    return Object.keys(cambiati).map((campo) => ({
      campo,
      prima: primaRisolti[campo],
      dopo: dopoRisolti[campo],
    }));
  }

  async scrivi(voce: VoceLog): Promise<void> {
    let utenteNome: string | null = null;
    let ruolo: string | null = null;
    if (voce.utenteId) {
      const u = await this.prisma.utente.findUnique({
        where: { id: voce.utenteId },
        select: { nome: true, cognome: true, ruolo: true },
      });
      if (u) {
        utenteNome = nomeUtente(u);
        ruolo = u.ruolo;
      }
    }

    await this.prisma.logOperazione.create({
      data: {
        utenteId: voce.utenteId,
        utenteNome,
        ruolo,
        area: voce.area,
        azione: voce.azione,
        descrizione: voce.descrizione.slice(0, 500),
        metodo: voce.metodo,
        percorso: voce.percorso.slice(0, 500),
        stato: voce.stato,
        esito: voce.esito,
        errore: voce.errore ? voce.errore.slice(0, 1000) : null,
        dettaglio:
          voce.dettaglio === undefined ? Prisma.JsonNull : (voce.dettaglio as Prisma.InputJsonValue),
        ip: voce.ip ?? null,
      },
    });
  }

  private where(f: FiltriLog): Prisma.LogOperazioneWhereInput {
    const where: Prisma.LogOperazioneWhereInput = {};
    if (f.dal || f.al) {
      where.createdAt = { ...(f.dal ? { gte: f.dal } : {}), ...(f.al ? { lt: f.al } : {}) };
    }
    if (f.utentiIds?.length) where.utenteId = { in: f.utentiIds };
    if (f.aree?.length) where.area = { in: f.aree };
    if (f.azioni?.length) where.azione = { in: f.azioni };
    if (f.esito !== undefined) where.esito = f.esito;
    if (f.testo) {
      const contains = { contains: f.testo, mode: 'insensitive' as const };
      where.OR = [{ descrizione: contains }, { utenteNome: contains }, { errore: contains }, { area: contains }];
    }
    return where;
  }

  async elenco(f: FiltriLog) {
    const where = this.where(f);
    const [totale, righe] = await Promise.all([
      this.prisma.logOperazione.count({ where }),
      this.prisma.logOperazione.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (f.pagina - 1) * f.perPagina,
        take: f.perPagina,
      }),
    ]);
    return { totale, righe };
  }

  /** Utenti e aree presenti nel registro, per le tendine dei filtri. */
  async filtri() {
    const [utenti, aree] = await Promise.all([
      this.prisma.logOperazione.groupBy({
        by: ['utenteId', 'utenteNome'],
        where: { utenteId: { not: null } },
      }),
      this.prisma.logOperazione.groupBy({ by: ['area'] }),
    ]);

    // Un utente rinominato compare con piu' nomi: nella tendina ne basta uno
    const perId = new Map<number, string>();
    for (const u of utenti) {
      if (u.utenteId !== null && !perId.has(u.utenteId)) perId.set(u.utenteId, u.utenteNome ?? `#${u.utenteId}`);
    }

    return {
      utenti: [...perId.entries()]
        .map(([id, nome]) => ({ id, nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
      aree: aree.map((a) => a.area).sort((a, b) => a.localeCompare(b, 'it')),
    };
  }

  async pulisci(giorni: number): Promise<number> {
    const limite = new Date(Date.now() - giorni * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.logOperazione.deleteMany({ where: { createdAt: { lt: limite } } });
    return count;
  }
}
