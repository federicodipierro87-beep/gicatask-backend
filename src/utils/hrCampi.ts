import type { StatoCivile } from '@prisma/client';
import type { SchedaHrCompleta } from '../services/hr.service.js';

/**
 * Catalogo dei campi della scheda HR. E' l'unica fonte per la stampa della
 * scheda (sezioni e ordine), per le colonne del riepilogo (`peso` = larghezza
 * relativa) e per le caselle di scelta del frontend, che lo riceve da
 * `GET /api/hr/campi`.
 */
export interface CampoHr {
  chiave: string;
  etichetta: string;
  sezione: string;
  peso: number;
  valore: (s: SchedaHrCompleta) => string;
}

export const ETICHETTE_STATO_CIVILE: Record<StatoCivile, string> = {
  CELIBE: 'Celibe',
  NUBILE: 'Nubile',
  CONIUGATO: 'Coniugato',
  SEPARATO: 'Separato',
  DIVORZIATO: 'Divorziato',
};

export function formatDataHr(data: Date | null | undefined): string {
  return data ? new Date(data).toLocaleDateString('it-IT', { timeZone: 'UTC' }) : '';
}

const t = (v: string | null | undefined) => v ?? '';

export const CAMPI_HR: CampoHr[] = [
  // Dati personali
  { chiave: 'cognomeNome', etichetta: 'Cognome e nome', sezione: 'Dati personali', peso: 1.6, valore: (s) => s.cognomeNome },
  { chiave: 'numeroPersonale', etichetta: 'Numero personale', sezione: 'Dati personali', peso: 0.8, valore: (s) => t(s.numeroPersonale) },
  { chiave: 'indirizzo', etichetta: 'Indirizzo', sezione: 'Dati personali', peso: 1.6, valore: (s) => t(s.indirizzo) },
  { chiave: 'luogo', etichetta: 'Luogo', sezione: 'Dati personali', peso: 1.1, valore: (s) => t(s.luogo) },
  { chiave: 'dataNascita', etichetta: 'Data di nascita', sezione: 'Dati personali', peso: 0.9, valore: (s) => formatDataHr(s.dataNascita) },
  { chiave: 'luogoNascita', etichetta: 'Luogo di nascita', sezione: 'Dati personali', peso: 1.1, valore: (s) => t(s.luogoNascita) },
  { chiave: 'nazionalita', etichetta: 'Nazionalità', sezione: 'Dati personali', peso: 1, valore: (s) => t(s.nazionalita) },
  { chiave: 'telefono', etichetta: 'Numero di telefono', sezione: 'Dati personali', peso: 1.1, valore: (s) => t(s.telefono) },
  { chiave: 'email', etichetta: 'E-mail', sezione: 'Dati personali', peso: 1.6, valore: (s) => t(s.email) },

  // Documenti e assicurazioni. La scheda stampata ha due campi per riga:
  // in quest'ordine a sinistra AVS, permesso, scadenza e codice fiscale, a
  // destra imposte alla fonte, data di entrata, SIMIC e cassa malati
  { chiave: 'numeroAvs', etichetta: 'Numero AVS', sezione: 'Documenti e assicurazioni', peso: 1.2, valore: (s) => t(s.numeroAvs) },
  {
    chiave: 'impostaFonte',
    etichetta: 'Imposte alla fonte',
    sezione: 'Documenti e assicurazioni',
    peso: 0.7,
    valore: (s) => (s.impostaFonte === null ? '' : s.impostaFonte ? 'SI' : 'NO'),
  },
  { chiave: 'tipoPermesso', etichetta: 'Tipo permesso', sezione: 'Documenti e assicurazioni', peso: 0.8, valore: (s) => t(s.tipoPermesso) },
  { chiave: 'dataEntrata', etichetta: 'Data di entrata', sezione: 'Documenti e assicurazioni', peso: 0.9, valore: (s) => formatDataHr(s.dataEntrata) },
  { chiave: 'scadenzaPermesso', etichetta: 'Scadenza permesso', sezione: 'Documenti e assicurazioni', peso: 0.9, valore: (s) => formatDataHr(s.scadenzaPermesso) },
  { chiave: 'numeroSimic', etichetta: 'Numero SIMIC', sezione: 'Documenti e assicurazioni', peso: 1, valore: (s) => t(s.numeroSimic) },
  { chiave: 'codiceFiscale', etichetta: 'Codice fiscale', sezione: 'Documenti e assicurazioni', peso: 1.3, valore: (s) => t(s.codiceFiscale) },
  { chiave: 'cassaMalati', etichetta: 'Cassa malati', sezione: 'Documenti e assicurazioni', peso: 1.1, valore: (s) => t(s.cassaMalati) },

  // Famiglia
  {
    chiave: 'statoCivile',
    etichetta: 'Stato civile',
    sezione: 'Famiglia',
    peso: 1.1,
    valore: (s) =>
      s.statiCivili
        .map((c) => (c.dal ? `${ETICHETTE_STATO_CIVILE[c.stato]} dal ${formatDataHr(c.dal)}` : ETICHETTE_STATO_CIVILE[c.stato]))
        .join('; '),
  },
  { chiave: 'coniugeCognomeNome', etichetta: 'Cognome e nome coniuge', sezione: 'Famiglia', peso: 1.4, valore: (s) => t(s.coniugeCognomeNome) },
  { chiave: 'coniugeDataNascita', etichetta: 'Data di nascita coniuge', sezione: 'Famiglia', peso: 0.9, valore: (s) => formatDataHr(s.coniugeDataNascita) },
  { chiave: 'assegnoFigli', etichetta: 'Assegno figli', sezione: 'Famiglia', peso: 0.9, valore: (s) => t(s.assegnoFigli) },
  {
    chiave: 'figli',
    etichetta: 'Figli',
    sezione: 'Famiglia',
    peso: 2,
    valore: (s) =>
      s.figli
        .map((f) => (f.dataNascita ? `${f.cognomeNome} (${formatDataHr(f.dataNascita)})` : f.cognomeNome))
        .join('; '),
  },
  { chiave: 'padreCognomeNome', etichetta: 'Cognome e nome del padre', sezione: 'Famiglia', peso: 1.4, valore: (s) => t(s.padreCognomeNome) },
  { chiave: 'madreCognomeNome', etichetta: 'Cognome e nome (da nubile) della madre', sezione: 'Famiglia', peso: 1.4, valore: (s) => t(s.madreCognomeNome) },

  // Impiego
  { chiave: 'dataAssunzione', etichetta: 'Data di assunzione', sezione: 'Impiego', peso: 0.9, valore: (s) => formatDataHr(s.dataAssunzione) },
  { chiave: 'tipoSalario', etichetta: 'Tipo di salario', sezione: 'Impiego', peso: 0.9, valore: (s) => t(s.tipoSalario) },
  { chiave: 'salario', etichetta: 'Salario', sezione: 'Impiego', peso: 0.8, valore: (s) => t(s.salario) },
  { chiave: 'gradoOccupazione', etichetta: 'Grado occupazione', sezione: 'Impiego', peso: 0.8, valore: (s) => t(s.gradoOccupazione) },
  { chiave: 'iban', etichetta: 'Numero IBAN', sezione: 'Impiego', peso: 1.8, valore: (s) => t(s.iban) },
  { chiave: 'dataCessazione', etichetta: 'Data di cessazione', sezione: 'Impiego', peso: 0.9, valore: (s) => formatDataHr(s.dataCessazione) },

  // Formazioni: nella scheda hanno una sezione propria con le foto, qui
  // servono al riepilogo
  {
    chiave: 'formazioni',
    etichetta: 'Formazioni',
    sezione: 'Formazioni',
    peso: 2,
    valore: (s) => s.formazioni.map((f) => f.nome).join(', '),
  },

  // Emergenza
  { chiave: 'emergenzaNome', etichetta: 'Nome contatto emergenza', sezione: 'Contatto di emergenza', peso: 1.3, valore: (s) => t(s.emergenzaNome) },
  { chiave: 'emergenzaTelefono', etichetta: 'Telefono contatto emergenza', sezione: 'Contatto di emergenza', peso: 1.1, valore: (s) => t(s.emergenzaTelefono) },
];
