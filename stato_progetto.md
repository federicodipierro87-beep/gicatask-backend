# GicaTask - Stato del Progetto

**Ultimo aggiornamento:** 6 Settembre 2026 - **PROGETTO COMPLETATO + MIGLIORAMENTI**

## Panoramica

GicaTask è un portale per la gestione delle attività di una ditta di logistica. Permette ai dipendenti di registrare le proprie attività lavorative e ai responsabili di gestire clienti, utenti e visualizzare report.

Attorno al nucleo iniziale si sono aggiunti nel tempo quattro moduli, ognuno con la sua anagrafica e il suo export:

| Modulo | A cosa serve | Export |
|---|---|---|
| **Attività** | Registrazione ore, assenze, assegnazione | PDF A3 orizzontale, Excel |
| **Bollettini** | Giornale lavori con firme e cumulativo per cantiere | PDF |
| **Calendario eventi** | Griglia annuale con i festivi del Ticino | Excel |
| **Dream** | Noleggi veicoli con quota 70/30 o 100 | PDF A4 verticale |

I moduli *Bollettini* e *Dream* non sono visibili a tutti: i primi dipendono dal flag `abilitatoBollettini` sull'utente, il secondo è riservato al ruolo `RESPONSABILE` — **tutti e diciassette gli endpoint** delle tre route Dream, letture comprese.

## Repository

- **Backend:** https://github.com/federicodipierro87-beep/gicatask-backend
- **Frontend:** https://github.com/federicodipierro87-beep/gicatask-frontend

## URL di Produzione

- **Backend (Railway):** https://web-production-fde54.up.railway.app
- **Frontend (Netlify):** https://gicatask.netlify.app

**Come si ritrovano i due progetti.** I nomi su Railway sono generati a caso e nessuno dice
"GicaTask", quindi vanno annotati qui o si ricercano a tentoni:

| | Identificativo |
|---|---|
| Railway | progetto **`sweet-truth`** (workspace *Feedspace*), servizio `web` + `Postgres`, ambiente `production` |
| Netlify | sito **`gicatask`**, id `d47d83b8-a58e-48af-babf-a4f892e92a96` |

Entrambe le CLI sono installate e autenticate, ma **nessuna delle due cartelle è collegata**. Per un
controllo al volo conviene non collegarle: `netlify api getSite --data '{"site_id":"..."}'` funziona
senza link, mentre `railway status --json` il link lo pretende (e scrive in
`~/.railway/config.json`, non nel repo).

## Stack Tecnologico

### Backend
- Node.js + Fastify + TypeScript
- Prisma ORM
- PostgreSQL (Railway)
- JWT: header `Authorization: Bearer`, con il cookie httpOnly come ripiego
- pdfkit (generazione PDF)
- exceljs (generazione Excel)
- node-cron (scheduler)
- @aws-sdk/client-s3 (Cloudflare R2)

### Frontend
- React + Vite + TypeScript
- React Router v6
- TailwindCSS
- Axios

---

## Fasi Completate

### Fase 1: Setup e Autenticazione ✅

**Backend:**
- Struttura progetto con Fastify e TypeScript
- Schema Prisma completo con modelli:
  - `Utente` (dipendenti e responsabili)
  - `Cliente`
  - `Cantiere` (con flag `isGenerico`)
  - `TipoAttivita`
  - `Attivita`
  - `BackupLog`, `Configurazione` (per uso futuro)
- Sistema autenticazione JWT con cookies httpOnly
- Plugin Prisma per Fastify
- Middleware autenticazione
- Endpoint `/api/auth/*`:
  - `GET /users` - lista utenti attivi
  - `GET /check-password/:id` - verifica se utente ha password
  - `POST /login` - login con o senza password
  - `POST /logout` - logout
  - `GET /me` - utente corrente

**Frontend:**
- Struttura progetto con Vite e React
- Configurazione TailwindCSS
- Context AuthContext per gestione stato autenticazione
- Pagina Login con:
  - Select ricercabile utenti
  - Campo password condizionale
  - Redirect automatico in base al ruolo
- Componente ProtectedRoute per protezione rotte
- Layout separati per Dipendente e Responsabile

**Configurazione Deploy:**
- `netlify.toml` per SPA redirect
- Script start backend con `prisma db push`
- Variabili ambiente configurate su Railway e Netlify

---

### Fase 2: CRUD Anagrafiche ✅

**Backend - Servizi e Route:**

1. **Clienti** (`/api/clienti`):
   - `GET /` - lista clienti (con filtro `includeInactive`)
   - `GET /:id` - dettaglio cliente con cantieri
   - `POST /` - crea cliente (auto-crea cantiere "Generico")
   - `PUT /:id` - modifica nome
   - `DELETE /:id` - soft delete (attivo=false)
   - `POST /:id/activate` - riattiva cliente

2. **Cantieri** (`/api/cantieri`):
   - `GET /` - tutti i cantieri con info cliente (ottimizzato)
   - `GET /cliente/:clienteId` - cantieri per cliente
   - `GET /:id` - dettaglio con tipi attività
   - `POST /` - crea cantiere
   - `PUT /:id` - modifica nome
   - `DELETE /:id` - soft delete
   - `POST /:id/activate` - riattiva

3. **Tipi Attività** (`/api/tipi-attivita`):
   - `GET /` - tutti i tipi attività (indipendenti da cantiere)
   - `GET /:id` - dettaglio
   - `POST /` - crea tipo (solo nome, senza legame a cantiere)
   - `PUT /:id` - modifica nome
   - `DELETE /:id` - soft delete
   - `POST /:id/activate` - riattiva

4. **Utenti** (`/api/utenti`):
   - `GET /` - lista utenti
   - `GET /:id` - dettaglio
   - `POST /` - crea utente
   - `PUT /:id` - modifica dati
   - `POST /:id/password` - imposta/rimuove password
   - `DELETE /:id` - soft delete
   - `POST /:id/activate` - riattiva

**Frontend - Pagine Responsabile:**

1. **ClientiPage** (`/responsabile/clienti`):
   - Lista clienti con toggle mostra inattivi
   - Modal creazione cliente
   - Link a dettaglio

2. **ClienteDetailPage** (`/responsabile/clienti/:id`):
   - Modifica nome cliente
   - Gestione cantieri (aggiungi, modifica, elimina)
   - Per ogni cantiere: gestione tipi attività
   - Protezione cantiere "Generico" (non eliminabile)

3. **UtentiPage** (`/responsabile/utenti`):
   - Lista utenti con ruolo e stato password
   - Modal creazione utente
   - Modifica inline nome/cognome/ruolo
   - Gestione password (imposta/rimuovi)
   - Elimina/riattiva utenti

---

### Fase 3: Area Dipendente ✅

**Backend:**
- Servizio `AttivitaService` con:
  - `getByUtente()` - attività dell'utente
  - `getAll()` - tutte le attività (con filtri)
  - `getById()` - singola attività
  - `create()` - crea attività
  - `update()` - modifica (con controllo di proprietà per i dipendenti)
  - `delete()` - elimina (con controllo di proprietà per i dipendenti)
- Utility `calculateDurationMinutes()` per calcolo durata

**Route** (`/api/attivita`):
- `GET /` - tutte le attività (responsabile) o proprie (dipendente)
- `GET /me` - attività utente corrente
- `GET /:id` - singola attività
- `POST /` - crea attività
- `PUT /:id` - modifica attività
- `DELETE /:id` - elimina attività

**Regole Business:**
- Dipendente può modificare/eliminare le proprie attività, senza limiti di data
- Responsabile può modificare/eliminare qualsiasi attività e riassegnarla a un altro dipendente
  (campo `utenteId` in `PUT /:id`, accettato solo se il richiedente è RESPONSABILE)

**Frontend:**

1. **DipendenteLayout**:
   - Header con nome utente e logout
   - Navigazione: "Le Mie Attività" | "Nuova Attività"

2. **AttivitaListPage** (`/dipendente`):
   - Lista attività raggruppate per data
   - Totale ore per giorno e complessivo
   - Pulsanti Modifica/Elimina su tutte le attività
   - Modal conferma eliminazione

3. **AttivitaFormPage** (`/dipendente/nuova` e `/dipendente/modifica/:id`):
   - Campi: data, ora inizio, ora fine
   - Select a cascata: Cliente → Cantiere → Tipo Attività
   - Campo note opzionale
   - Validazione orari
   - Auto-selezione se unica opzione

---

### Fase 4: Area Responsabile - Report e Assegnazione ✅

**Backend:**

1. **ExportService** (`src/services/export.service.ts`):
   - `generatePDF()` - genera PDF con:
     - Titolo e filtri applicati
     - Riepilogo totale
     - Tabella attività con righe alternate
     - Layout compatto per più righe per pagina
     - Ordine colonne: Data, Dipendente, Cliente, Cantiere, Tipo, Note, Inizio, Fine, Durata
   - `generateExcel()` - genera Excel con:
     - Foglio "Attività" con dettaglio completo, righe per giorno e poi per dipendente
     - Foglio "Riepilogo" con aggregazioni per cliente e dipendente
     - Durata in ore (non minuti)
     - Ordine colonne: Data, Dipendente, Cliente, Cantiere, Tipo Attività, Note, Ora Inizio, Ora Fine, Durata (ore)

2. **Nuovi Endpoint** (`/api/attivita`):
   - `GET /export/pdf` - download PDF (solo responsabile)
   - `GET /export/excel` - download Excel (solo responsabile)
   - `GET /stats` - statistiche aggregate (solo responsabile)

**Frontend:**

1. **ReportPage** (`/responsabile/report`):
   - Filtri:
     - Data inizio/fine (default: mese corrente)
     - Cliente (select)
     - Cantiere (select, si attiva dopo selezione cliente)
     - Dipendente (select)
   - Card riepilogative:
     - Totale attività
     - Ore totali
     - Clienti attivi nel periodo
   - Tabelle riepilogo:
     - Per cliente (attività e ore)
     - Per dipendente (attività e ore)
   - Tabella dettaglio attività
   - Pulsanti export:
     - "Esporta Excel" (primario)
     - "Esporta PDF" (secondario)

2. **AssegnaAttivitaPage** (`/responsabile/assegna`):
   - Select dipendente
   - Campi data e orari
   - Select a cascata: Cliente → Cantiere → Tipo
   - Campo note
   - Feedback successo con nome dipendente
   - Reset form dopo salvataggio

3. **ResponsabileLayout** aggiornato:
   - Navigazione: Dashboard | Clienti | Utenti | Assegna | Report | Backup

4. **ResponsabileDashboard** aggiornato:
   - Card "Report Attività" ora cliccabile
   - Card "Assegna Attività" ora cliccabile

---

### Fase 5: Backup e Ripristino ✅

**Backend:**
- `BackupService` con integrazione Cloudflare R2 (S3-compatibile)
  - Export di tutte le tabelle in formato JSON
  - Upload/download da R2
  - Ripristino con transazione e reset sequenze PostgreSQL
  - Pulizia automatica backup più vecchi di 7 giorni
  - Pulizia log errori più vecchi di 30 giorni
- Route `/api/backup`:
  - `GET /status` - stato configurazione e ultimo backup
  - `GET /test` - test connessione R2
  - `GET /` - lista backup
  - `POST /` - crea backup manuale
  - `POST /:id/restore` - ripristina da backup
  - `DELETE /:id` - elimina backup
- `SchedulerService` con node-cron:
  - Backup automatico giornaliero alle 2:00 (Europe/Rome)
  - Cleanup automatico backup > 7 giorni dopo ogni backup
- Log operazioni in tabella `BackupLog`

**Frontend:**
- `BackupPage` (`/responsabile/backup`):
  - Card stato sistema (configurato/non configurato)
  - Visualizzazione config parziale (Account ID, Bucket)
  - Istruzioni per configurare R2 se mancano credenziali
  - Statistiche (ultimo backup, totale backup)
  - Pulsante "Testa connessione R2" per verificare configurazione
  - Pulsante "Crea backup manuale"
  - Tabella storico backup con tipo, stato, dimensione
  - Azioni: Ripristina, Elimina
  - Modal di conferma per ripristino (con warning)
  - Modal di conferma per eliminazione
  - **Modal di successo dopo ripristino** con elenco record ripristinati
- Aggiunta voce "Backup" nella navigazione

**Variabili ambiente richieste su Railway:**
```
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_BUCKET_NAME=gicatask-backups
```

**Retention Policy:**
- I backup completati vengono eliminati automaticamente dopo 7 giorni
- I log di errore vengono eliminati dopo 30 giorni

---

### Fase 6: Configurazione Finale ✅

**Completato:**
- Rimosso endpoint temporaneo `/api/seed`
- Eliminato file `seed.service.ts` non più necessario
- README backend aggiornato con:
  - Documentazione completa API endpoints
  - Istruzioni installazione e deploy
  - Configurazione variabili ambiente
  - Documentazione backup R2
- README frontend aggiornato con:
  - Struttura progetto completa
  - Tutte le funzionalità documentate
  - Istruzioni deploy Netlify
  - Configurazione ambiente

---

### Miglioramenti Post-Rilascio (23 Luglio 2026)

**Export Excel:**
- Colonna durata ora mostra **ore** invece di minuti (es. 2.5 invece di 150)
- Nuovo ordine colonne: Data, Dipendente, Cliente, Cantiere, Tipo Attività, Note, Ora Inizio, Ora Fine, Durata (ore)

**Export PDF:**
- Stesso ordine colonne dell'Excel
- Layout più compatto (margini ridotti, font più piccoli, righe più compatte)
- Più righe per pagina

**Report Page:**
- Aggiunto filtro **Cantiere** (si attiva dopo aver selezionato un cliente)
- I filtri vengono applicati anche all'export PDF/Excel

**UX Migliorata - Campi Data/Ora:**
- Nuovo componente `DateTimeInput` per tutti i campi data e ora
- Cliccando sul campo si apre automaticamente il picker
- Icona calendario/orologio visibile sulla destra
- Icona nativa del browser nascosta (niente doppia icona)
- Applicato a: AttivitaFormPage, AssegnaAttivitaPage, ReportPage

---

### Miglioramenti Post-Rilascio (28 Luglio 2026)

**Gestione Cache:**
- Headers anti-cache su tutte le chiamate API (`Cache-Control: no-cache, no-store, must-revalidate`)
- Timestamp `_t` aggiunto a ogni richiesta per forzare bypass cache browser
- Pulizia sessione precedente prima di ogni nuovo login
- Backend: hook `onSend` per aggiungere headers anti-cache alle risposte `/api/*`

**Indicatori Visivi Data Attività (Area Dipendente):**
- Attività **passate**: sfondo rosso sfumato (`bg-red-50/70`)
- Attività di **oggi**: sfondo verde chiaro (`bg-green-50`) con etichetta "(oggi)"
- Attività **future**: sfondo bianco (default)
- Applicato alle card giornaliere nella lista attività

**Modal Dettaglio Attività:**
- Click su qualsiasi riga attività apre un modal con tutti i dettagli
- Informazioni mostrate: Data, Orario (mattino/pomeriggio), Cliente, Cantiere, Tipo, Note
- Pulsanti Modifica/Elimina nel modal (se attività modificabile)
- Implementato in:
  - `AttivitaListPage` (area dipendente)
  - `ReportPage` (area responsabile)
  - `ResponsabileDashboard` (tabella dettaglio)

**Layout Mobile Responsabile:**
- Riorganizzazione navigazione per mobile:
  - Tab sempre visibili: Dashboard, Assegna, Report
  - Menu Impostazioni (icona rotellina): Clienti, Utenti, Import, Backup
- Icona rotellina accanto al pulsante "Esci" su mobile
- Dropdown menu per accesso rapido alle impostazioni
- Icona si illumina quando si è in una pagina impostazioni
- Su desktop: tutti i tab visibili come prima

**Blocco Scroll Orizzontale:**
- Aggiunto `overflow-x: hidden` su html e body
- Previene lo scroll laterale indesiderato su mobile

**Importazione Massiva da Excel:**

*Backend:*
- Nuovo servizio `ImportService` (`src/services/import.service.ts`)
- Endpoint `/api/import/excel` - upload e processamento file Excel
- Endpoint `/api/import/template` - download template Excel
- Logica di importazione:
  - Se cliente non esiste → lo crea (con cantiere "Generico" automatico)
  - Se cantiere non esiste per quel cliente → lo crea
  - Se tipo attività non esiste per quel cantiere → lo crea
  - Nessun duplicato viene creato (controllo case-insensitive)
- Gestione errori dettagliata per ogni riga

*Frontend:*
- Nuova pagina `ImportPage` (`/responsabile/import`)
- Pulsante "Scarica Template" per ottenere file Excel di esempio
- Area drag-drop per caricare file Excel
- Formato Excel (foglio unico):
  - Colonna A: Cliente (obbligatorio)
  - Colonna B: Cantiere (opzionale, default "Generico")
  - Colonna C: Tipo Attività (opzionale)
- Risultati importazione:
  - Righe processate
  - Clienti creati
  - Cantieri creati
  - Tipi attività creati
  - Lista errori/avvisi
- Accessibile da: Impostazioni → Import

---

### Miglioramenti Post-Rilascio (29 Luglio 2026)

**TipoAttivita Indipendente:**
- **TipoAttivita non è più figlio di Cantiere** - ora è un'entità completamente indipendente
- Schema Prisma aggiornato: rimosso `cantiereId` da TipoAttivita
- Backend aggiornato: `tipiAttivitaApi.getAll()` invece di `getByCantiere()`
- Frontend aggiornato: niente più select a cascata Cliente → Cantiere per i tipi attività
- I tipi attività sono ora globali e condivisi tra tutti i clienti/cantieri

**Nuove Pagine Gestione:**

1. **CantieriPage** (`/responsabile/cantieri`):
   - Lista tutti i cantieri con relativo cliente
   - Filtro "Mostra inattivi"
   - Creazione nuovo cantiere (seleziona cliente + nome)
   - **Modifica nome cantiere** (pulsante "Modifica" per cantieri attivi non generici)
   - Elimina/Riattiva cantieri (tranne quelli generici)
   - Accessibile da: Impostazioni → Cantieri

2. **TipiAttivitaPage** (`/responsabile/tipi-attivita`):
   - Lista tutti i tipi attività (indipendenti da cantiere)
   - Filtro "Mostra inattivi"
   - Creazione nuovo tipo (solo nome)
   - **Modifica nome tipo attività** (pulsante "Modifica" per tipi attivi)
   - Elimina/Riattiva tipi
   - Accessibile da: Impostazioni → Tipi Attività

**Menu Impostazioni Aggiornato:**
- Clienti
- Cantieri (nuovo)
- Tipi Attività (nuovo)
- Utenti
- Import
- Backup

**ClienteDetailPage Semplificata:**
- Rimossa la gestione tipi attività da questa pagina
- Ora mostra solo i cantieri del cliente
- I tipi attività si gestiscono dalla pagina dedicata TipiAttivitaPage

**Gestione Sessione:**
- Timeout inattività automatico:
  - **Dipendente**: logout dopo 10 minuti di inattività
  - **Responsabile**: logout dopo 1 ora di inattività
- Warning 1 minuto prima del logout con opzioni "Continua" o "Esci"
- Logout automatico alla chiusura del browser (usando sessionStorage marker)
- Nuovo componente `InactivityWarning` per il modal di avviso
- Activity tracking su: mousedown, mousemove, keydown, scroll, touchstart, click

**Creazione Inline in AssegnaAttivitaPage:**
- Possibilità di creare nuovi elementi direttamente dai dropdown:
  - "+ Aggiungi nuovo cliente..." → apre modal per creare cliente
  - "+ Aggiungi nuovo cantiere..." → apre modal per creare cantiere (richiede cliente selezionato)
  - "+ Aggiungi nuovo tipo..." → apre modal per creare tipo attività
- Dopo la creazione, l'elemento viene selezionato automaticamente

**Uniformità Visiva Form Attività:**
- `AttivitaFormPage` (dipendente) ora ha lo stesso layout di `AssegnaAttivitaPage` (responsabile)
- Header con titolo e sottotitolo fuori dalla card
- Card con `max-w-2xl` per larghezza contenuta
- Stile compatto e coerente

**UX Migliorata - Campi Data/Ora:**
- Data centrata nel suo box di input
- Orari con default intelligenti:
  - Campi **Mattino** (inizio/fine): default **06:00**
  - Campi **Pomeriggio** (inizio/fine): default **13:00**
- Il picker si apre già posizionato sull'orario di default

**Dashboard Responsabile Semplificata:**
- Rimossi tutti i pulsanti/card di navigazione
- Mostra solo la tabella "Dettaglio Attività" con tutte le attività
- Link "Vai ai Report" per accesso rapido
- Navigazione tramite menu laterale/header

---

### Miglioramenti Post-Rilascio (30 Luglio 2026)

**Ottimizzazione Performance CantieriPage:**
- Risolto problema di caricamento lento della pagina Cantieri
- **Causa**: N+1 query problem - il frontend faceva una chiamata API sequenziale per ogni cliente per recuperare i suoi cantieri
- **Soluzione**:
  - Backend: nuovo endpoint `GET /api/cantieri` che restituisce tutti i cantieri con info cliente in una singola query
  - Backend: nuovo metodo `getAll()` in `CantieriService` con join su Cliente
  - Frontend: `cantieriApi.getAll()` aggiunto al client API
  - Frontend: `CantieriPage` ora usa una singola chiamata parallela invece del ciclo for-await
- **Risultato**: da N+1 chiamate sequenziali a 2 chiamate parallele (clienti + cantieri)

**Pulizia Dati:**
- Eliminati clienti di test dal database di produzione:
  - "Express Delivery" (2 cantieri)
  - "Logistica Nord Srl" (3 cantieri)
  - "prova" (2 cantieri)

---

### Miglioramenti Post-Rilascio (3 Agosto 2026)

**Tipo Attività reso facoltativo:**
- Nelle schede di inserimento attività (dipendente e responsabile) il campo Tipo Attività non è più
  obbligatorio: è possibile creare un'attività senza tipo e rimuovere il tipo da una già esistente
- **Backend**:
  - `schema.prisma`: `tipoAttivitaId` e la relazione `tipoAttivita` diventano nullable (allargamento
    applicato automaticamente da `prisma db push` al deploy)
  - `attivita.service.ts`: input e tipo di ritorno nullable; in `update()` il check su
    `tipoAttivitaId` passa da truthy a `!== undefined`, altrimenti sarebbe impossibile azzerare il campo
  - `attivita.routes.ts`: `tipoAttivitaId` rimosso dai `required` e schema JSON `['number','null']`
  - `export.service.ts`: PDF ed Excel stampano cella vuota quando il tipo manca
- **Frontend**:
  - etichetta "Tipo Attività (opzionale)", `required` rimosso dalla select e dal `disabled` del submit
  - tabelle e liste mostrano cella vuota; nei modali di dettaglio la riga "Tipo" viene nascosta
- **Ordine di deploy**: backend prima del frontend (il backend nuovo è retrocompatibile col frontend
  vecchio, non viceversa)

**Campo Assenza sulle attività:**
- Nuovo campo facoltativo **Assenza** nelle schede di inserimento attività (dipendente e
  responsabile), sotto Cliente / Cantiere / Tipo Attività
- Le assenze sono un'anagrafica gestibile dal responsabile (stesso pattern dei Tipi Attività:
  CRUD completo, soft-delete via `attivo`, creazione al volo dalla tendina in "Assegna Attività")
- Le 4 voci iniziali (Vacanza, Infortunio, Malattia, Congedo) vengono create automaticamente
  all'avvio del backend se la tabella è vuota
- Selezionando un'assenza, **cliente, cantiere e fasce orarie diventano facoltativi**; senza
  assenza restano le regole precedenti (cliente + cantiere + almeno una fascia oraria)
- Non è imposta esclusività fra Tipo Attività e Assenza: si possono valorizzare entrambi
- **Backend**:
  - `schema.prisma`: nuovo modello `TipoAssenza` (tabella `tipi_assenza`); in `Attivita`
    `clienteId` e `cantiereId` diventano nullable e si aggiunge `assenzaId` nullable
  - nuovi `seed.service.ts` (seed idempotente, gate su `count() === 0`, non lancia mai),
    `tipiAssenza.service.ts` e `tipiAssenza.routes.ts` (`/api/tipi-assenza`)
  - `attivita.service.ts`: validazione condizionale in `create()` e `update()`; in `update()`
    anche `clienteId`/`cantiereId` passano da check truthy a `!== undefined`, altrimenti
    convertire un'attività esistente in assenza lascerebbe il vecchio cliente
  - `attivita.routes.ts`: `clienteId`/`cantiereId` rimossi dai `required`, schema
    `['number','null']`; endpoint stats raggruppa le attività senza cliente sotto "Assenze"
  - `export.service.ts`: nuova colonna "Assenza" in PDF (10 colonne) ed Excel; il foglio
    Riepilogo usa `att.cliente?.nome ?? 'Assenze'` (prima sarebbe andato in crash)
  - `backup.service.ts`: `tipiAssenza` incluso in backup e restore (campo opzionale, i backup
    precedenti non ce l'hanno); dopo un restore vecchio viene richiamato il seed
- **Frontend**:
  - nuova pagina `TipiAssenzaPage` su `/responsabile/tipi-assenza`, voce di menu "Assenze"
  - form attività: select Assenza con nota esplicativa, `required` condizionale su
    cliente/cantiere, guardia sul null nel prefill in modifica
  - Dashboard, Report e lista attività: nuova colonna "Assenza", celle vuote dove manca il
    dato, riga Assenza nei modali; nel riepilogo "Per Cliente" le assenze formano il gruppo
    "Assenze", escluso dal conteggio "Clienti Attivi"
- **Nota operativa**: filtrando il Report per Cliente le assenze non compaiono (hanno
  `clienteId` NULL). In caso di rollback va revertato solo il commit frontend: lo schema non
  va riportato indietro, `db push` proverebbe a rimettere NOT NULL su colonne con valori NULL

**Eliminazione dei cantieri generici:**
- Il cantiere smette di essere un campo sempre presente. Prima ogni cliente riceveva alla
  creazione un cantiere automatico `Generico` (`isGenerico: true`), protetto da modifica e
  disattivazione, che nella scheda attività veniva auto-selezionato senza aggiungere informazione
- Ora un cliente **nasce senza cantieri**; il box Cantiere nella scheda di inserimento attività
  **compare solo se il cliente selezionato ha almeno un cantiere**, e in quel caso è obbligatorio
- I cantieri generici esistenti sono stati **eliminati**: le attività che li referenziavano
  hanno `cantiereId` NULL e mostrano cella Cantiere vuota in report ed export
- Il nome "Generico" non è più riservato: senza creazione automatica non c'è niente da proteggere
- **Frontend**:
  - `isGenerico` rimosso dal tipo `Cantiere` e dalle interfacce locali delle pagine
  - `AttivitaFormPage` / `AssegnaAttivitaPage`: box Cantiere avvolto in `{cantieri.length > 0 && …}`,
    `setCantieri([])` in testa a `loadCantieri` (senza, cambiando cliente la lista precedente
    resterebbe a schermo e il box sfarfallerebbe), validazione e `disabled` del submit condizionali
  - `CantieriPage`: via la colonna "Tipo" (senza generici mostrerebbe "Specifico" ovunque) e i
    guard `!isGenerico` su Modifica/Elimina/Riattiva; `ClienteDetailPage`: via badge e guard
  - `ImportPage`: colonna Cantiere vuota ⇒ cliente creato senza cantieri
- **Backend**:
  - `clienti.service.ts`: `create()` crea il solo cliente
  - `cantieri.service.ts`: via i check sul nome riservato, il blocco su `isGenerico` in
    `update`/`deactivate` e `isGenerico` dagli `orderBy`
  - `seed.service.ts`: nuova `removeCantieriGenerici()` (pulizia una tantum idempotente, stesso
    stile del seed); `updateMany` + `deleteMany` in un'unica `$transaction`, altrimenti un delete
    fallito lascerebbe attività scollegate coi generici ancora vivi. Chiamata da `index.ts`
  - `attivita.service.ts`: nuovo `assertCantiereWhenRequired()` — il cantiere è obbligatorio solo
    se il cliente ne ha almeno uno attivo; la query parte solo quando il cantiere manca
  - `import.service.ts`: get-or-create del cantiere solo se la colonna è valorizzata; template
    con cella Cantiere vuota nell'esempio
- **Ordine di deploy: frontend PRIMA del backend** (invertito rispetto alle modifiche precedenti).
  Il backend nuovo cancella i generici: col frontend vecchio i clienti che avevano solo il generico
  si ritroverebbero la tendina Cantiere vuota e `required`, bloccando l'inserimento attività. Il
  frontend nuovo col backend vecchio funziona (i generici esistono, `cantieri.length ≥ 1`)
- **Nota operativa**: la colonna `is_generico` **resta nello schema**. Rimuoverla significherebbe
  un `DROP COLUMN` su colonna NOT NULL popolata, e `prisma db push` su Railway gira senza
  `--accept-data-loss`: il deploy si fermerebbe. Il punto di non ritorno è il deploy backend —
  da lì i generici sono cancellati e il legame con le attività storiche è perso, quindi tornare
  indietro richiede un ripristino da backup e non un revert di codice

**Turni notturni oltre la mezzanotte:**
- Una fascia oraria può ora scavallare la mezzanotte: quando **l'ora di fine è minore dell'ora di
  inizio si assume il giorno successivo** e la durata è calcolata di conseguenza
  (`17:00 → 05:00` = 12h). Prima sia il frontend sia il backend rifiutavano `fine <= inizio`
- Lo scavallamento vale per **entrambe le fasce**, mattino e pomeriggio
- Le ore restano interamente attribuite al **giorno di inizio** (il `dataRiferimento`
  dell'attività): report, filtri e raggruppamenti per data non cambiano
- **`fine == inizio` resta un errore**: è ambiguo (zero minuti o 24 ore). Cambia solo il messaggio,
  da "deve essere successiva" a "deve essere diversa"
- Ovunque compare il suffisso **`(+1)`**: nota sotto il box nel form, e `17:00-05:00 (+1)` in liste,
  modali, dashboard, report ed export PDF/Excel. È anche la protezione contro l'errore di battitura:
  senza indicatore un `05:00` digitato al posto di `15:00` diventerebbe un turno di 12 ore
  indistinguibile da uno vero
- **Nessuna modifica allo schema**: gli orari sono già `String?` in `HH:mm` e `durataMinuti` è
  persistito sulla riga, lo scavallamento si deduce dal confronto fra le due stringhe. Nessuna
  colonna `dataFine` né flag `turnoNotturno`
- **Dati esistenti intatti**: tutte le righe attuali hanno fine > inizio, la nuova logica restituisce
  gli stessi minuti. `durataMinuti` non viene ricalcolato in lettura: nessuna migrazione
- **Backend**:
  - `utils/duration.ts`: `calculateDurationMinutes` somma 24h all'orario di fine quando è minore
    dell'inizio; è l'unica modifica sostanziale. I due soli chiamanti sono in `calculateTotalDuration`
    e ammettono entrambi lo scavallamento, quindi nessun parametro `allowOvernight` da propagare
  - `export.service.ts`: `formatTimeSlot` aggiunge ` (+1)`; definizione unica, copre PDF ed Excel
  - non toccati: `schema.prisma`, `attivita.routes.ts` (il pattern `HH:mm` accetta già `05:00`) e gli
    endpoint stats, che sommano `durataMinuti` senza sapere come è stato ottenuto
- **Frontend**:
  - `AttivitaFormPage` / `AssegnaAttivitaPage`: validazioni da `<=` a `===`, helper locale
    `isOvernight` e nota "Il turno termina il giorno successivo" sotto la fascia interessata. Il
    `disabled` del submit non cambia (verifica la presenza degli orari, non il loro ordine)
  - `formatTimeSlot` aggiornata nelle tre copie locali (`AttivitaListPage`, `ResponsabileDashboard`,
    `ReportPage`), ciascuna col proprio fallback. Non centralizzata: la funzione è già triplicata
    come `formatDuration`, un refactor toccherebbe più file di quanti ne serva la funzionalità
- **Ordine di deploy: backend PRIMA del frontend**. Col backend nuovo e il frontend vecchio la
  funzionalità semplicemente non è disponibile (il client vecchio blocca `fine <= inizio`), nessuna
  regressione. Al contrario il frontend nuovo su backend vecchio invierebbe `17:00 → 05:00` e
  riceverebbe `End time must be after start time`, con l'attività non salvata
- **Limiti noti, fuori ambito**: non esiste alcun controllo di sovrapposizione fra mattino e
  pomeriggio né un tetto massimo di ore giornaliere; con entrambe le fasce che scavallano si può
  teoricamente arrivare a quasi 48 ore in un giorno. Il suffisso `(+1)` è la segnalazione prevista
- **Rollback**: revert dei commit su entrambi i lati, backend per ultimo. Nessun dato perso —
  un'attività notturna già creata conserva il suo `durataMinuti`, ma dopo il rollback non sarà più
  modificabile finché gli orari non rientrano nella stessa giornata

**Assenze con durata fissa di 8h 12m:**
- Un'attività con un'assenza selezionata vale ora **492 minuti (8h 12m)**, sempre e a prescindere
  dagli orari. Prima le fasce erano facoltative e, se non compilate, `calculateTotalDuration`
  restituiva zero: una giornata di Vacanza o Malattia risultava di 0 ore in liste, dashboard,
  report ed export
- **Costante fissa nel backend**, non configurabile: `DURATA_ASSENZA_MINUTI` in
  `attivita.service.ts`. Nessuna nuova tabella, nessuna UI. La tabella `Configurazione` esiste
  nello schema ma resta inutilizzata (compare solo in backup e restore): usarla avrebbe richiesto
  di costruire service, route e pagina, fuori proporzione rispetto a una costante
- **Nessuna modifica allo schema**: `durataMinuti` è già un `Int` calcolato dal backend e salvato
  sulla riga, cambia solo come viene calcolato
- **Backend**: due soli punti di scrittura, `create()` e `update()`, dove `isAssenza` era già
  calcolato per rendere facoltativi cliente, cantiere e orari. In `update()` `isAssenza` guarda il
  valore risultante dal merge, quindi copre entrambe le conversioni: aggiungere un'assenza porta la
  durata a 492, rimuoverla la fa tornare al calcolo dagli orari. Non toccati gli endpoint stats e
  `export.service.ts`, che sommano il valore letto dal database e si adeguano da soli
- **Frontend**: `AttivitaFormPage` / `AssegnaAttivitaPage` nascondono i box Mattino e Pomeriggio
  quando c'è un'assenza, così l'utente non inserisce orari che verrebbero ignorati. Le due guardie
  su `fine === inizio` stanno fuori dal blocco `if (!isAssenza)` e sono state condizionate: con i
  box nascosti un errore su un campo invisibile sarebbe incomprensibile. Aggiornata la nota sotto
  la select Assenza, che parlava di fasce orarie facoltative
- **Gli orari restano nel database**: nascondere i box è sola UI, le assenze già salvate che hanno
  degli orari li conservano e continuano a mostrarli in liste ed export. Il form non li azzera, per
  non distruggere dati se un'assenza viene selezionata per errore
- **Nessun aggiornamento retroattivo**: le assenze già registrate restano a 0 ore. Chi vuole può
  riaprire la singola attività e risalvarla
- **Ordine di deploy: backend PRIMA del frontend**. Col backend nuovo e il frontend vecchio le
  assenze valgono già 8h 12m e gli orari eventualmente inseriti vengono ignorati: solo un
  disallineamento informativo. Al contrario il frontend nuovo su backend vecchio nasconderebbe i
  box e il backend calcolerebbe **0 minuti**, salvando una durata sbagliata in silenzio
- **Rollback**: revert dei commit su entrambi i lati, backend per ultimo. Le assenze create nel
  frattempo conservano i loro 492 minuti finché non vengono risalvate

**Tab "Assenze" separato per il dipendente:**
- Il dipendente registra le assenze da un **tab dedicato** (`/dipendente/assenze`), fra "Nuova
  Attività" e "Le Mie Attività". La select Assenza è sparita dal form attività, che torna a fare
  una cosa sola: cliente e cantiere sono di nuovo obbligatori e i box Mattino e Pomeriggio sono
  sempre visibili
- **Nessuna modifica al backend**: `POST /attivita` e `PUT /attivita/:id` accettano già `assenzaId`
  con `clienteId`/`cantiereId` nullable. Il nuovo form manda lo stesso payload di prima, quindi
  l'assenza resta un'attività con `assenzaId` valorizzato, vale 8h 12m e continua a comparire in
  "Le Mie Attività", nei totali, nei report e negli export. Deploy del solo frontend
- **Solo il form nel nuovo tab, nessun elenco**: le assenze restano in "Le Mie Attività" insieme
  alle altre attività. Tre campi soltanto — Data, Tipo assenza, Note — un giorno alla volta
- **Modifica su rotta dedicata** `/dipendente/assenze/modifica/:id`, gestita dalla stessa pagina.
  In "Le Mie Attività" il link Modifica sceglie la destinazione in base a `att.assenza`
- **In update non si azzerano i campi non mostrati**: il service fa il merge con
  `input.X !== undefined`, quindi omettendo cliente, cantiere e orari dal payload di modifica
  un'assenza storica che li aveva se li tiene. In creazione invece si mandano espliciti a `null`
- **Guardie sulle rotte incrociate**: `/dipendente/modifica/:id` di un'assenza (segnalibro o tasto
  indietro) reindirizza al form Assenze, e viceversa. Senza, si salverebbero dati incoerenti
- **Limite accettato: niente conversione fra attività e assenza.** Tolta la select dal form
  attività, per cambiare tipo si elimina e si reinserisce. È il prezzo della separazione
- **Solo lato dipendente**: `AssegnaAttivitaPage` del responsabile resta invariata, con la sua
  select Assenza dentro il form di assegnazione

---

### Miglioramenti Post-Rilascio (18 Agosto 2026)

**Liste attività divise per mese:**
- Le liste crescevano senza limiti: dashboard responsabile, Report e "Le Mie Attività" del
  dipendente mostrano ora **un mese alla volta**, con navigazione `‹ Agosto 2026 ›` e un pulsante
  di ritorno al mese corrente. Il contatore accanto al titolo si riferisce al **solo mese
  visualizzato** ("(N nel mese)" in dashboard)
- **Deploy del solo frontend**: il backend filtra già per `startDate`/`endDate` su
  `GET /attivita` e `GET /attivita/me`, nessun endpoint toccato
- **La navigazione nel futuro è consentita**: le attività future esistono (funzione Assegna del
  responsabile), quindi le frecce non hanno un limite superiore
- **Nuovo componente** `components/MonthNavigator.tsx`, che esporta sia il componente sia le
  utility sul mese. Non è stata creata una cartella `utils/`: il progetto non ne ha una e le
  funzioni servono solo qui
  - Il mese è la **stringa `"YYYY-MM"`**, non un oggetto `{year, month}`: è un primitivo, quindi
    è sicuro nelle dipendenze di `useEffect` e confrontabile con `===`. Un oggetto sarebbe un
    nuovo riferimento a ogni render e farebbe ri-scattare l'effect all'infinito
  - Le date sono costruite con `getFullYear()`/`getMonth()`/`getDate()`, **mai con
    `toISOString()`**: in fuso UTC+N quest'ultimo sfasa di un giorno
  - `slice()` e non `split('-')[0]`: con `noUncheckedIndexedAccess` l'indicizzazione di un array
    restituisce `string | undefined` e non compila
  - La maiuscola del nome del mese è messa in JS e non con la classe Tailwind `capitalize`, che
    maiuscolizza **ogni parola** e produrrebbe "Periodo Personalizzato"
- **Correzione di un bug di fuso orario**: `getDefaultDateRange` in `ReportPage` è stata eliminata.
  Usava `toISOString()`, quindi in ora legale italiana il periodo di default del Report era
  `31/07 → 30/08` invece di `01/08 → 31/08`: includeva l'ultimo giorno del mese precedente ed
  **escludeva l'ultimo giorno del mese corrente**. Gli export di default cambiano quindi contenuto
  di un giorno rispetto a prima — è una correzione, ma chi confrontasse un export nuovo con uno
  vecchio troverebbe differenze legittime
- **Report: i campi Dal/Al restano** e restano modificabili a mano, servono per gli export su
  periodo libero. Le frecce sono una scorciatoia che li imposta ai confini del mese
  - `startDate`/`endDate` restano l'**unica fonte di verità**: il mese è un valore derivato, non
    uno stato in più che potrebbe divergere dalle date
  - Se il periodo non coincide con un mese intero l'etichetta dice "Periodo personalizzato" e le
    frecce si ancorano al mese del campo "Dal", normalizzando sempre a mese intero
  - Il navigatore sta **nella card Filtri, non sopra la tabella**: le date pilotano anche le
    summary card, i riepiloghi Per Cliente/Per Dipendente e gli export. Metterlo sopra "Dettaglio
    Attività" comunicherebbe la bugia "questo naviga solo la tabella"
  - `buildExportUrl` non è stata toccata: legge `startDate`/`endDate` di stato, che le frecce
    aggiornano, quindi PDF ed Excel seguono da soli il periodo mostrato
- **Il fetch è stato spostato dentro l'effect** nelle tre pagine, con una guardia `cancelled` nel
  cleanup. La race esisteva già su ReportPage (cinque filtri che possono cambiare mentre una
  richiesta è in volo), le frecce la rendono solo facile da innescare cliccando in fretta. La
  guardia serve **anche nel `finally`**: senza, una risposta obsoleta spegnerebbe lo spinner
  mentre la richiesta corrente è ancora in corso. Disabilitare le frecce durante il caricamento
  sarebbe stata UX peggiore e non avrebbe comunque coperto le select
- **`refreshToken`**: contatore di stato che rimpiazza le chiamate a `fetchAttivita()` dopo
  un'eliminazione, dato che la funzione non esiste più. Ricarica lo **stesso mese**, non salta a
  quello corrente. Sostituisce anche il `window.location.reload()` del pulsante "Riprova" nella
  lista dipendente, che avrebbe perso il mese visualizzato
- **Empty state del dipendente**: la CTA "Registra la tua prima attività" compare solo sul mese
  corrente — su un mese passato di un utente veterano sarebbe una frase falsa. Il nome del mese
  non è ripetuto nel messaggio: in italiano richiederebbe la preposizione articolata variabile
  (**ad** agosto/aprile vs **a** settembre/marzo) ed è già visibile due righe sopra
- **Il contatore è nascosto durante il caricamento**, altrimenti mostrerebbe il numero del mese
  precedente sotto il nome del mese nuovo
- Restano invariati e corretti `getDateStatus` e `getCardClasses`: su un mese passato nessuna card
  è verde. *(All'epoca valeva anche `isWithinCurrentWeek`, che nascondeva i pulsanti
  Modifica/Elimina fuori dalla settimana corrente rispecchiando il permesso del backend; è stato
  poi rimosso — vedi "Modifica attività senza limiti di data")*
- **Ruvidità note, accettate**:
  - il 1° del mese il responsabile apre una dashboard quasi vuota. È la conseguenza diretta
    dell'obiettivo
  - *(risolta in seguito)* la settimana corrente può stare **a cavallo di due mesi**
    (lun 31/8 – dom 6/9): il dipendente si trova i giorni modificabili divisi su due pagine
  - su ReportPage le summary card e i riepiloghi mostrano i dati vecchi accanto allo spinner
    durante il caricamento. È comportamento **preesistente** (succede già cambiando i filtri), ma
    le frecce lo rendono più visibile
- **Fuori ambito, stessa famiglia di bug**: `AttivitaFormPage.tsx` calcola la data di default con
  `new Date().toISOString().split('T')[0]`, quindi fra mezzanotte e le 02:00 in ora legale propone
  **ieri**. Da valutare come fix separato

---

### Modifica attività senza limiti di data (18 Agosto 2026)

**Il vincolo "solo settimana corrente" è stato rimosso.** Con le liste divise per mese il
dipendente naviga volentieri nei mesi passati, ma vi trovava attività di sola lettura: un errore
scoperto in ritardo era irreparabile senza intervento del responsabile.

**Backend:**
- `attivita.service.ts`: eliminati i controlli `isWithinSameWeek` da `update()` e `delete()`.
  **Resta il controllo di proprietà**: un dipendente non può toccare attività altrui
- `utils/duration.ts`: rimossa `isWithinSameWeek()`, non più usata da nessuno
- `update()` accetta ora anche `utenteId` (il tipo passa da
  `Omit<CreateAttivitaInput, 'utenteId' | 'createdById'>` a `Omit<..., 'createdById'>`), così
  un'attività può essere spostata su un altro dipendente
- `PUT /attivita/:id` passa `utenteId` al service **solo se il richiedente è RESPONSABILE**
  (`user.ruolo === 'RESPONSABILE' ? body.utenteId : undefined`), stessa logica già usata nella
  `POST /`. Senza questo filtro un dipendente potrebbe scaricare le proprie ore su un collega
- Nessuna migrazione Prisma: lo schema è invariato

**Frontend:**
- `AttivitaListPage.tsx`: rimossa `isWithinCurrentWeek()`; Modifica ed Elimina compaiono ora su
  **tutte** le attività, sia nella lista sia nel modale di dettaglio. Tolto il badge
  "(questa settimana)", che senza quella funzione non aveva più significato; restano il badge
  "(oggi)" e i colori per data passata/odierna/futura
- **Il responsabile ha ora una schermata di modifica**, prima poteva solo eliminare dalla
  dashboard. Riusa `AssegnaAttivitaPage` sulla rotta `/responsabile/attivita/modifica/:id` invece
  di duplicare ~780 righe: quella pagina gestisce già attività e assenze e ha i modali "crea al
  volo" per cliente/cantiere/tipo/assenza
  - **La select Dipendente resta modificabile**: è il modo per riassegnare un'attività
  - L'effetto che carica i cantieri azzerava `cantiereId` a ogni cambio di cliente, cancellando il
    cantiere precaricato. Risolto con `else if (!isEditing)`, lo stesso pattern già presente in
    `AttivitaFormPage.tsx`
  - In modifica si naviga alla dashboard dopo il salvataggio; in creazione resta il messaggio di
    successo con reset del form
- `ResponsabileDashboard.tsx`: icona matita accanto al cestino nella colonna azioni (con
  `stopPropagation` per non aprire il modale) e pulsante Modifica nel modale di dettaglio

**Conseguenza accettata:** un dipendente può ora riscrivere le ore di mesi già rendicontati.
L'app non ha un concetto di "periodo chiuso"; se servirà, sarà un blocco esplicito e non il
riflesso di una finestra di sette giorni.

---

### Foglio Excel del report riorganizzato (25 Agosto 2026)

Modifiche al **solo export Excel** (`generateExcel`). Il PDF resta invariato.

- **Righe ordinate per giorno** (dal più vecchio) e, dentro ogni giornata, **raggruppate per
  dipendente** e ordinate per orario di inizio. Nuova `sortForReport()` in `export.service.ts`
  - La chiave primaria è la **data**, non il dipendente: il foglio si legge giornata per giornata,
    e il raggruppamento per dipendente avviene dentro il singolo giorno
  - L'ordinamento avviene **nel service**, non nella query: la dashboard, la lista del dipendente
    e il PDF continuano a mostrare le attività dalla più recente, com'erano
  - Il dipendente è ordinato su `"Nome Cognome"`, la stessa stringa che si legge nella colonna,
    così l'ordine è evidente a chi apre il foglio. Ordinare per cognome avrebbe prodotto una
    sequenza apparentemente casuale rispetto al testo visibile
  - L'orario di inizio è `oraInizioMattino || oraInizioPomeriggio`: un'attività può avere il solo
    pomeriggio, e un'assenza nessuna delle due (in quel caso resta stringa vuota e va in testa)
  - `[...attivita].sort(...)`: l'array in ingresso non viene mutato, lo usa anche il foglio
    "Riepilogo"
- **Riga 1**: `REPORT ATTIVITA'` in **rosso** (`FFFF0000`), grassetto, 16pt
- **Righe 2 e 3 eliminate** (filtri applicati e totale attività/ore). L'intestazione delle colonne
  sale quindi in riga 2 e i dati partono dalla 3
- **Colonna Note a capo ogni 8 parole** (`wrapNote()`), con `wrapText` sulla cella

**Due dettagli che senza verifica sarebbero passati inosservati:**

1. **La colonna Note è stata allargata da 30 a 60.** Con `wrapText` attivo Excel manda a capo
   sulla larghezza della colonna: a 30 caratteri avrebbe spezzato le righe per conto suo e gli
   `\n` inseriti a mano sarebbero stati invisibili. Otto parole italiane occupano ~55 caratteri
2. **Il periodo è finito nel nome del file**, dato che le righe 2 e 3 lo riportavano ed erano
   l'unico posto in cui comparisse: `report-attivita-2026-08-01_2026-08-31.xlsx`
   - **Il nome del file lo decide il frontend**, non il backend: `ReportPage.tsx` ignora il
     `Content-Disposition` della risposta e ricostruisce `a.download` da sé. Modificare solo la
     rotta non avrebbe cambiato nulla di ciò che l'utente vede
   - La rotta è stata allineata comunque, per chi chiama l'endpoint direttamente. Le date arrivano
     dalla query string e finivano in un **header HTTP**: `periodoPerNomeFile()` accetta solo
     `YYYY-MM-DD`, altrimenti ripiega sulla data di download. Senza il filtro sarebbe stato un
     vettore di header injection
   - Il nome col periodo vale **anche per il PDF**: è la stessa riga di codice per i due formati e
     due nomi diversi per lo stesso download sarebbero stati una incoerenza gratuita

**Semplificazione collaterale:** `generateExcel()` non riceve più `ReportFilters` (serviva solo
alle righe cancellate), quindi la rotta Excel non fa più le due query a `cliente` e `utente` che
servivano a comporre quella riga.

---

### Sezione Bollettini — giornale lavori (25 Agosto 2026)

Un **bollettino** è il giornale lavori giornaliero compilato in cantiere da un dipendente
abilitato, firmato a mano da lui e dal committente, e archiviato come documento.

**Campi:** data, cliente, cantiere, attività (testo libero), mezzi / materiali / trasporti scelti
da anagrafica con la rispettiva quantità, numero operai, ore **per operaio**, le due firme con i
rispettivi nomi.

**Chi fa cosa:** il dipendente abilitato crea e consulta i propri; il responsabile vede
l'archivio completo, elimina e scarica il cumulativo per cantiere. Non esiste la modifica: il
documento è firmato.

#### Le quattro decisioni che spiegano il codice

**1. I PDF non sono archiviati, sono rigenerati.** `pdfkit` non sa leggere un PDF esistente,
quindi "appendere al cumulativo" richiederebbe `pdf-lib`. E un cumulativo salvato sarebbe una
cache da invalidare a ogni inserimento o cancellazione, con il rischio concreto di lasciare
scaricabile un documento non aggiornato. **L'archivio è il database**: entrambi i PDF si generano
su richiesta dalle righe, quindi il cumulativo è sempre corretto per costruzione. Costa ~1-2 s su
cento bollettini, per un'operazione rara. R2 resta dedicato al solo backup notturno.

**2. Le firme stanno in Postgres come base64.** Una firma da canvas pesa 5-30 KB. Su R2
servirebbero **200 GET S3** per un cumulativo da cento bollettini, più oggetti orfani da ripulire
e un secondo punto di rottura nella richiesta. In colonna `@db.Text` è una query sola, e
soprattutto attraversa il backup JSON esistente senza toccarlo.

Base64 e non `Bytes` perché `JSON.stringify` di un Buffer produce
`{"type":"Buffer","data":[...]}` — circa sette byte per byte — e al ripristino `createMany`
riceverebbe un oggetto invece di un Buffer: **il restore fallirebbe**.

**3. I nomi sono copiati sul bollettino.** `clienteNome`, `cantiereNome` e
`RigaBollettino.descrizione` sono istantanee prese al momento della firma. Se il responsabile
rinomina un cantiere o un mezzo, un PDF rigenerato dalle sole chiavi esterne mostrerebbe dati
diversi da quelli che il committente ha sottoscritto.

**4. Il flag di accesso non è nel token.** `abilitatoBollettini` è letto dal database a ogni
richiesta da `assertAccessoBollettini` (`src/utils/bollettiniAccess.ts`). Nel JWT sarebbe più
veloce, ma `config.jwt.expiresIn` è `7d`: revocare l'accesso richiederebbe fino a una settimana.
Il rovescio è che abilitando un altro utente collegato la **voce di menu** gli compare solo al
ricaricamento (`/auth/me` gira al mount); la guardia server è però già corretta in quell'istante,
quindi non è un buco di sicurezza ma un ritardo del menu.

**Il flag vale per tutti, responsabile compreso.** Non c'è un'eccezione di ruolo: il menu nasconde
la sezione a chi non ha la spunta, e una scorciatoia nella guardia direbbe il contrario di quello
che si vede. Non è un vicolo cieco, perché la pagina Utenti non è protetta dal flag: un
responsabile può sempre abilitarsi da solo. Perché l'operazione abbia un effetto immediato,
`AuthContext` espone `refreshUser()` e `UtentiPage` lo chiama quando l'utente modificato è quello
collegato — senza, la spunta sembrerebbe non fare nulla fino al ricaricamento.

La guardia copre anche le **anagrafiche** (`/api/voci-bollettino`), il **DELETE** del bollettino e
il **PDF cumulativo**: le ultime due si fidavano del solo `requireRole('RESPONSABILE')`, che dopo
questa scelta non basta più.

#### Un'anagrafica sola per tre elenchi

Mezzi, materiali e trasporti hanno la forma identica di `TipoAttivita`. Tre modelli gemelli
avrebbero prodotto 6 tabelle, 3 service, 3 route e 3 pagine React quasi uguali — circa 1200 righe
duplicate a parità di funzionalità. C'è invece **`VoceBollettino` discriminato dall'enum
`TipoVoce`**, con `@@unique([tipo, nome])`: "Cemento" può esistere come materiale e come
trasporto, ma un duplicato nello stesso tipo scatta come `P2002` e la rotta lo traduce in 400.
Lo stesso schema polimorfo era già in uso in `TipoAttributoExtra`/`ValoreAttributoExtra`.
Lato frontend `VociBollettinoPage` è un file solo, montato tre volte con props diverse.

#### Dettagli che senza verifica sarebbero diventati bug

- **`Float` e non `Decimal`**: Prisma restituisce `Decimal` come oggetto `Decimal.js`, che
  `JSON.stringify` serializza come stringa. Avrebbe rotto in silenzio `.toFixed()` nel PDF e i
  calcoli nel frontend
- **Le firme sono escluse dal `select` degli elenchi**: Prisma restituisce tutti gli scalari se
  non gliene si passa uno. Senza `listSelect` una pagina d'archivio da 50 righe avrebbe spedito
  qualche MB di base64 al browser. Le immagini si leggono solo in `fullSelect`, usato dal PDF
- **`bodyLimit: 2 MB` sulla POST**: il limite Fastify di default è 1 MB e due firme dense più il
  resto ci arrivano vicino, restituendo un `FST_ERR_CTP_BODY_TOO_LARGE` incomprensibile
- **Le firme nel PDF sono ancorate a `doc.page.height`**, non a `doc.y`: agganciarle al flusso
  avrebbe messo il riquadro a mezza pagina nei bollettini corti e fuori pagina in quelli lunghi.
  `ensureSpace()` aggiunge una pagina quando le voci invadono la fascia delle firme
- **Nome file sanificato con whitelist `[A-Za-z0-9._-]`**: il nome del cantiere finisce
  nell'header `Content-Disposition`. È la stessa classe di problema già documentata in
  `attivita.routes.ts` per l'export del report
- **`abilitatoBollettini` va aggiunto in due punti per lato.** Backend: risposta di login **e**
  `/auth/me`, costruite a mano separatamente. Frontend il problema era lo stesso in `checkAuth` e
  `login`, e il sintomo è un menu che compare dopo il login e sparisce dopo un refresh: le tre
  conversioni sono state unificate in una funzione `toUser()` in `AuthContext`, così un campo
  nuovo si aggiunge in un posto solo
- **Il pad di firma non usa librerie**, ma i punti dolenti sono coperti: `touchAction: 'none'`
  (senza, sul telefono il dito scorre la pagina invece di disegnare), Pointer Events con
  `setPointerCapture` per mouse/dito/pennino, `devicePixelRatio` ricordando che assegnare
  `canvas.width` **azzera il contesto**, e i tratti conservati in un ref e ridisegnati su
  `ResizeObserver` — altrimenti ruotando il telefono la firma già tracciata sparisce
- **I PDF si scaricano con `apiClient` e `responseType: 'blob'`**, non con `fetch`. Il token
  Bearer è nell'interceptor axios; una `fetch` nuda si autentica col solo cookie `SameSite=None`,
  che è esattamente ciò che Safari ITP limita. `ReportPage.tsx` usa ancora `fetch` e funziona
  oggi per quel motivo

#### Backup: modifica obbligatoria, non rimandabile

`restoreBackup` fa `deleteMany()` su `utenti` e `cantiere`. Con dei bollettini che li
referenziano **il ripristino sarebbe fallito su vincolo di chiave esterna**. Peggio: aggiungendo
le tabelle alla sola lista di cancellazione e non a quella di export, un ripristino avrebbe
cancellato tutti i bollettini in silenzio.

Sono stati toccati quattro punti: interfaccia `BackupData.tables` (campi **opzionali**, così i
backup precedenti alla feature restano ripristinabili), export, ordine di cancellazione
(`righeBollettino` → `bollettini` → `vociBollettino` **prima** di attività/cantieri/utenti) e
ordine di inserimento con il reset delle sequenze.

#### Debito annotato

Ogni bollettino aggiunge ~40 KB di **firme** base64 al backup JSON notturno — `findMany()` senza
`select` porta via ogni colonna. A 2000 bollettini il file è ~80 MB e il ripristino inserisce 2000
stringhe grandi in un'unica transazione: quando succederà, spezzare le `createMany` in blocchi da 200.
Non è un ostacolo oggi.

Gli **allegati non peggiorano questo conto**: dal 17/09/2026 foto e PDF stanno su R2 e nel backup
finiscono i soli metadati (~150 byte per allegato). È stata proprio questa riga a far scartare
l'ipotesi base64 per gli allegati (vedi *Allegati al bollettino*).

#### Rotte aggiunte

Il flag è richiesto **ovunque**, ruolo compreso: non c'è nessuna rotta della sezione che si
accontenti del solo `requireRole('RESPONSABILE')`.

| Metodo | Path | Accesso |
|---|---|---|
| GET | `/api/voci-bollettino/:tipo` | autenticato + flag |
| POST | `/api/voci-bollettino/:tipo` | autenticato + flag (dal 16/09/2026, vedi sezione dedicata) |
| PUT/DELETE | `/api/voci-bollettino/:id` | RESPONSABILE + flag |
| POST | `/api/voci-bollettino/:id/activate` | RESPONSABILE + flag |
| GET | `/api/bollettini` | autenticato + flag (il dipendente vede solo i propri) |
| GET | `/api/bollettini/:id` | autenticato + flag |
| POST | `/api/bollettini` | autenticato + flag |
| DELETE | `/api/bollettini/:id` | RESPONSABILE + flag |
| GET | `/api/bollettini/:id/pdf` | autenticato + flag |
| GET | `/api/bollettini/cantiere/:id/pdf` | RESPONSABILE + flag (cumulativo) |
| GET | `/api/bollettini/cliente/:id/pdf` | RESPONSABILE + flag (cumulativo, dal 17/09/2026) |

Pagine: `/dipendente/bollettini`, `/dipendente/bollettini/nuovo`, `/responsabile/bollettini`,
`/responsabile/mezzi|materiali|trasporti`.

#### Menu

Le quattro pagine del responsabile stanno sotto un'unica voce **Bollettino** (Archivio, Mezzi,
Materiali, Trasporti): sparse in barra sarebbero quattro tab in più su una riga già lunga, e
nulla direbbe che appartengono alla stessa cosa. Su desktop è una tendina in barra, su mobile un
gruppo dentro la rotella delle impostazioni. Tutto il blocco compare solo con il flag attivo.

La tendina desktop è resa **fuori** dal `<nav>`: `overflow-x-auto` crea un contenitore di
scorrimento che avrebbe ritagliato il pannello invece di lasciarlo uscire.

---

### Export PDF in A3 con griglia (26 Agosto 2026)

Il PDF del report va **stampato dal cliente**, quindi passa da **A4 a A3 orizzontale**
(1191x842pt, 420x297mm) e acquista una **griglia su tutte le celle**. Deploy del **solo
backend**: il frontend non conosce il layout, si limita a scaricare il file.

- **La larghezza utile passa da 792 a 1141pt.** Le dieci colonne sono state riproporzionate
  (`PDF_COLUMNS` in `export.service.ts`): Cliente 92→150, Cantiere 82→140, Note 125→234. Il corpo
  passa da 6 a 8pt: su A4 serviva un font minuscolo per far stare le colonne, su A3 non serve più
  ed era al limite della leggibilità in stampa
- **Il troncamento a caratteri è stato eliminato.** Prima ogni cella veniva tagliata a
  `larghezza / 3.5` caratteri: una stima grossolana, che su un font proporzionale tagliava troppo
  presto le stringhe strette (`Illuminazione`) e troppo tardi quelle larghe (`MMM`). Ora il testo
  **va a capo** dentro la cella e l'altezza della riga è quella della cella più alta, misurata con
  `doc.heightOfString()`
- **L'intestazione della tabella è ridisegnata a ogni pagina.** Prima il salto pagina reimpostava
  solo `yPos`: dalla seconda pagina in poi le colonne erano senza titolo. Su un documento da
  stampare e sfogliare era il difetto più fastidioso
- **Le righe del PDF sono ora ordinate come quelle dell'Excel** (`sortForReport`): per giorno dal
  più vecchio, dentro il giorno raggruppate per dipendente. Prima il PDF usciva dalla più recente e
  i due export della stessa selezione non erano confrontabili riga per riga
- **Griglia anche nell'Excel**, con bordi espliciti `thin` su intestazione e dati di entrambi i
  fogli. Non è stato usato `pageSetup.showGridLines`: è un interruttore per **tutto** l'intervallo
  usato, e avrebbe disegnato le linee anche attorno alla riga del titolo e alle righe vuote di
  separazione del foglio Riepilogo
- **Il salto pagina ora tiene conto dell'altezza della riga** (`y + rowHeight > PDF_BOTTOM`, con
  `PDF_BOTTOM` = 817). Il vecchio `if (yPos > 560)` era una soglia fissa che con righe di altezza
  variabile lascerebbe sforare l'ultima riga fuori pagina

**Due trappole trovate solo verificando il PDF generato:**

1. **`ellipsis: true` di pdfkit è inutilizzabile insieme a `height`.** Alla riga 3118 di
   `pdfkit.js` i puntini vengono aggiunti quando la riga *successiva* non entrerebbe
   (`document.y + lh * 2 > maxY`), senza controllare se il testo sia già finito. Con l'altezza
   della cella calcolata sul contenuto la condizione è vera sull'ultima riga di **ogni** cella:
   sarebbe uscito un `01/08/2026…` su tutta la tabella. L'opzione è stata tolta; resta `height`,
   che da solo si limita a tagliare
2. **`height` va comunque passato**, anche se l'altezza della riga è calcolata sul contenuto e
   quindi in teoria basta sempre. Serve per il caso limite di `MAX_ROW_HEIGHT`: una nota lunga
   quanto una pagina intera verrebbe altrimenti disegnata **sopra le righe successive**, perché
   pdfkit senza limite di altezza continua a scrivere oltre il rettangolo

**Limite noto:** una singola nota più alta di una pagina viene troncata senza alcun segno visibile,
dato che `ellipsis` non è utilizzabile. Non succede con le note reali: 234pt di larghezza a 8pt
tengono circa 60 parole per riga di stampa e oltre 400 parole prima di riempire una pagina A3.

**Rollback:** revert del solo commit backend, nessun dato coinvolto.

---

### Export del report scaricato col token e non col cookie (26 Agosto 2026)

Gli export PDF ed Excel funzionavano da desktop ma **fallivano da telefono**. Non era una
regressione dell'A3: il difetto c'era da sempre ed è emerso solo ora che il cliente ha provato a
stampare dal cellulare.

`ReportPage.handleExport` era **l'ultima chiamata del frontend con una `fetch` nuda**
(`credentials: 'include'`), quindi si autenticava con il solo cookie `token`. Fra
`gicatask.netlify.app` e `web-production-fde54.up.railway.app` quel cookie è **di terze parti**:
Chrome desktop lo accetta ancora, i browser mobili lo bloccano. Tutto il resto dell'app passa da
`apiClient`, dove l'interceptor axios aggiunge l'header `Authorization: Bearer` — ecco perché
falliva solo l'export.

È esattamente la trappola già documentata nel codice quando furono migrati i PDF dei bollettini
(`client.ts`, commento sopra l'helper di download). Il commento è stato aggiornato per citare
esplicitamente il cookie di terze parti, non solo Safari.

- `downloadPdf` diventa **`downloadFile`** ed è riusato dai tre download. Non riavvolge più il
  blob in `new Blob([...], { type: 'application/pdf' })`: quel tipo fisso avrebbe marcato l'xlsx
  come PDF, mentre `response.data` conserva già il Content-Type della risposta
- Nuovo `attivitaApi.exportReport(format, filters, filename)`; `buildExportUrl` in `ReportPage` è
  stato cancellato insieme al montaggio manuale di `VITE_API_URL`
- I filtri di elenco ed export ora passano dallo stesso `attivitaParams()`: erano due copie della
  stessa serializzazione, destinate a divergere

**Nessuna modifica al backend:** `plugins/auth.ts` legge l'header `Authorization` per primo e usa
il cookie solo come ripiego, quindi le rotte di export accettavano già il Bearer.

**Rollback:** revert del solo commit frontend.

---

### Calendario eventi annuale (2 Settembre 2026)

Nuovo tab **Calendari Eventi** nell'area Responsabile, fra *Report* e *Clienti*. Il cliente
pianificava gli eventi su un foglio Excel compilato a mano (`Calendario eventi.xlsx`): la sezione
lo sostituisce e ne **replica il formato in export**, così i fogli vecchi e quelli nuovi restano
confrontabili.

Deploy di **entrambi i lati**, commit distinti: backend `fd449e5`, frontend `b05c946` e `0b08ca5`.

**Modello.** Nuova tabella `calendario_eventi`: cliente (FK obbligatoria all'anagrafica esistente),
nome evento facoltativo, `dataInizio`/`dataFine` obbligatorie, `dataConsegna`/`dataSmontaggio`
facoltative e importo facoltativo. Tutte le date sono `@db.Date`: contano i **giorni**, non gli
istanti. La colonna A del foglio è il nome dell'evento, con ripiego sul nome del cliente quando è
vuoto.

**Il foglio.** Un **anno per foglio** (`Eventi <anno>`), tutti i 365 o 366 giorni in colonna da E in
poi, griglia nascosta e freeze panes a `E5`. Riga 3 con i dodici merge mensili, riga 4 con le date
ruotate di 90°. Le intestazioni dei giorni sono blu nei feriali, rosate nei weekend e **rosse nei
festivi**, con la festività che prevale sul weekend. Riga TOTALE in fondo: `COUNTA` per giorno e
`SUM` degli importi.

- **I pallini si distinguono solo per colore** — nero i giorni dell'evento, verde la consegna,
  rosso lo smontaggio — e sono il carattere `l` in **Wingdings**. Nella stessa cella possono
  cadere tutti e tre, quindi ogni tipo è un *run* separato del rich text. Legenda in riga 1 del
  foglio e sopra la griglia a schermo
- **I festivi sono quelli del Canton Ticino**, 15 all'anno: 11 fissi più Pasquetta, Ascensione,
  Lunedì di Pentecoste e Corpus Domini, calcolati dalla Pasqua con l'algoritmo gregoriano anonimo.
  Il **Venerdì Santo non è festivo** in Ticino ed è escluso di proposito
- **I pallini sono disegnati anche nel weekend.** Un evento dal venerdì al lunedì occupa anche
  sabato e domenica: sul foglio conta la durata reale, non i giorni lavorativi
- **L'export è un service separato** (`calendarioEventiExport.service.ts`) e non un'aggiunta a
  `export.service.ts`, che era già a 423 righe e non ha nulla in comune con questo layout

**La trappola del fuso.** ExcelJS converte le `Date` con `getTime()`, cioè in UTC. Una mezzanotte
locale in Europe/Rome finisce nel giorno precedente una volta aperta in Excel: tutte le
intestazioni sarebbero slittate di un giorno. Ogni data scritta nel foglio è costruita con
`Date.UTC()`; Prisma restituisce già UTC per le colonne `@db.Date`. Per lo stesso motivo lato
client le date restano stringhe `YYYY-MM-DD` dall'input fino all'API e sono formattate con
`slice(0, 10).split('-').reverse().join('/')`, **mai** con `new Date(iso).toLocaleDateString()`.

**Eventi a cavallo d'anno.** La query per anno non guarda solo l'intervallo dell'evento ma anche
consegna e smontaggio: un montaggio di fine dicembre per un evento di gennaio deve comparire su
**entrambi** i fogli. Sul foglio i pallini sono tagliati sull'anno, mentre le colonne *dal* e *al*
mostrano sempre le date reali complete, altrimenti la durata vera non sarebbe leggibile.

**La griglia a schermo** replica il foglio in una tabella scorrevole (`max-h-[70vh]`, colonne da
26px) con la colonna del nome e le due righe di intestazione in `sticky`, una barra "salta al mese"
e lo scroll iniziale su oggi quando l'anno selezionato è quello corrente. Usa `border-separate`:
con `border-collapse` i bordi delle celle sticky vengono ridisegnati dal browser durante lo scroll
e **spariscono a intermittenza**.

**Due scelte minori con una ragione.** Un importo mancante lascia la cella **vuota** invece di
scriverci zero, che falserebbe la lettura a vista del totale. Il form sta in una *card* e non in un
`Modal`, che è `max-w-md` e incolonnerebbe sette campi uno sotto l'altro.

**Backup:** `restoreBackup()` cancella i clienti, e gli eventi ora li referenziano. Senza aggiungere
`calendarioEvento.deleteMany()` prima di quella riga il ripristino sarebbe fallito su vincolo di
chiave esterna. La tabella entra anche nel dump, nel ripristino (con `?? []`, i backup più vecchi
non hanno la sezione) e nel reset delle sequence.

**Duplicazione accettata:** il calcolo dei festivi esiste due volte, in `backend/src/services/
calendarioEventiExport.service.ts` (dal 16 Settembre 2026 in `backend/src/utils/festivita.ts`) e in
`frontend/src/utils/festivita.ts`. I due repository sono
separati e non c'è un package condiviso; la **sorgente di verità è il backend**, che è quello che
genera l'export. Se cambiano i festivi vanno modificati entrambi.

**I campi data si scrivono e si scelgono** (`0b08ca5`). `index.css` nasconde
`::-webkit-calendar-picker-indicator` su tutti gli input date, quindi nel form degli eventi il
calendario non era raggiungibile col mouse: è stata aggiunta un'icona propria. Il picker si apre
**solo dal bottone** e non da un `onClick` sull'input, come fa invece il `DateTimeInput` condiviso:
aprirlo a ogni click sul campo impedirebbe di posizionare il cursore per digitare la data a mano.
L'icona è fuori dal giro di tabulazione (`tabIndex={-1}`), così il TAB salta da un campo all'altro
e non alle icone. Dove `showPicker` manca resta comunque la digitazione.

**Rollback:** revert dei commit. La tabella `calendario_eventi` resta nel database senza dare
fastidio a nessuno; per eliminarla serve un intervento manuale.

---

### Dream Noleggio e Dream Veicoli (5 Settembre 2026)

Due tab nuovi nell'area Responsabile, fra *Utenti* e *Import*: **Dream Noleggio** registra i
noleggi ed esporta il report del periodo in PDF, **Dream Veicoli** è l'anagrafica che alimenta la
tendina del form. Entrambi sono **solo admin**: anche la lettura passa da
`requireRole('RESPONSABILE')`, a differenza di clienti e cantieri.

**Modello.** Due tabelle nuove. `dream_veicoli` ha il **solo campo `nome`** (unico) più `attivo`:
segue il pattern di *Cantieri* / *Mezzi*, quindi si disattiva e non si cancella. `dream_noleggi` ha
veicolo, data (`@db.Date`, è un giorno), osservazioni facoltative, importo, quota e importo
calcolato. Il veicolo non si cancella mai, perciò la relazione non ha bisogno di `onDelete`.

**La regola 70/30.** `quota` è un enum `SETTANTA_TRENTA | CENTO`, non due flag: i due valori sono
**mutuamente esclusivi** e nel form sono due radio. Con `70/30` l'importo calcolato è il 70%
dell'importo, con `100` è l'importo intero, arrotondato a due decimali.

- **Il calcolo è del server.** Il client lo replica in un `useMemo` per mostrare l'anteprima nel
  campo in sola lettura, ma `create` e `update` lo **rifanno** e salvano il proprio risultato: il
  form non è fonte di verità
- **`importoCalcolato` è persistito**, non ricavato in lettura. Il report somma una colonna che
  esiste già invece di ricalcolare riga per riga, e uno storico non cambia se un giorno cambia la
  percentuale

**Il report.** PDF **A4 verticale** (595×842pt, margine 25, tabella 545pt), stesso impianto del
report ore: `drawGrid` disegna un rettangolo per cella così i separatori restano visibili anche
sulle righe con celle vuote, la testata si ripete a ogni pagina e l'altezza della riga segue la
cella più alta. In fondo una **riga totali** in grassetto con la somma di importo e importo
calcolato; se non entra nella pagina corrente se ne apre una nuova con la testata ripetuta. Il
nome del file passa da `periodoPerNomeFile()`, la stessa funzione validata con regex ISO usata dal
report attività: le date finiscono nel `Content-Disposition` e senza validazione sarebbero un
vettore di header injection.

**Un solo periodo.** Il filtro *Dal* / *Al* in testata alla pagina, che parte sul mese corrente,
comanda **sia l'elenco sia il PDF**: ciò che si vede a schermo è ciò che si stampa. Sotto la
tabella c'è la stessa riga di totali del PDF. Le date restano stringhe `YYYY-MM-DD` dall'input
fino all'API, come nel calendario eventi.

**Un veicolo disattivato dopo la registrazione** non torna più dalla lista degli attivi: in
modifica viene aggiunto alle opzioni della select, altrimenti la tendina si svuoterebbe. È lo
stesso accorgimento del cliente in `CalendarioEventiPage`.

**`CampoData` è stato estratto** da `CalendarioEventiPage.tsx` a `components/CampoData.tsx`: serve
a tre form (periodo, data del noleggio, date dell'evento) e una seconda copia sarebbe divergita.

**Backup:** le due tabelle entrano nel dump, nel ripristino e nel reset delle sequence. Nella
cancellazione i noleggi vanno **prima** dei veicoli, che referenziano; nel ripristino l'ordine è
invertito. Le due sezioni si leggono con `?? []`, i backup precedenti non le hanno.

**Rollback:** revert dei due commit. Le tabelle restano nel database senza dare fastidio a
nessuno.

### Dream: cliente sul noleggio e rinomina (5 Settembre 2026)

Il tab *Dream Noleggio* si chiama ora **Dream** e il form ha un campo **Cliente** sotto il veicolo.

**Solo le etichette cambiano.** Rinominati il tab, il titolo della pagina, il titolo del PDF
(*Report Dream*) e il nome del file scaricato (`dream-<periodo>.pdf`). Rotta, tabelle e API restano
`/responsabile/dream-noleggio`, `dream_noleggi` e `/api/dream-noleggi`: rinominarle sarebbe stato
lavoro senza effetto visibile, e `/responsabile/dream` sarebbe stato **prefisso** di
`/responsabile/dream-veicoli`, accendendo tutti e due i tab insieme — `isActive()` confronta con
`startsWith`.

**Il cliente è facoltativo** e viene dall'**anagrafica clienti esistente**, la stessa di cantieri,
attività e calendario eventi: nessuna tabella nuova. `dream_noleggi.cliente_id` è nullable, quindi
i noleggi già registrati restano validi senza migrazione di dati. Come per il veicolo, un cliente
disattivato dopo la registrazione viene riaggiunto alle opzioni della select in modifica.

Il cliente compare **sia in elenco sia nel PDF**. Le colonne del report sono state ribilanciate per
far posto alla nuova senza sforare i 545pt della tabella: *Osservazioni* scende da 210 a 140pt,
*Veicolo* da 115 a 95, e *Cliente* prende 95pt. Dove il cliente manca si stampa `-`.

Il backup non cambia: `dream_noleggi` viene già cancellato prima di `clienti` nel ripristino,
quindi la nuova foreign key non rompe l'ordine.

### Tendina Impostazioni anche su desktop (5 Settembre 2026)

La barra dell'area Responsabile mostrava undici tab in fila: sette anagrafiche affiancate alle
quattro pagine di lavoro, tutte con lo stesso peso visivo. Ora su desktop le anagrafiche stanno in
una tendina **Impostazioni**, come il gruppo *Bollettino*.

**Il criterio è l'uso, non il tipo.** In barra restano le pagine che si aprono ogni giorno —
Dashboard, Assegna, Report, Calendari Eventi, Assenze e **Dream** — mentre nella tendina vanno
quelle che si toccano di rado: Clienti, Cantieri, Tipi Attività, Utenti, **Dream Veicoli**, Import,
Backup. Dream e Dream Veicoli si separano proprio qui: registrare un noleggio è lavoro quotidiano,
aggiungere un veicolo no.

**Su mobile non cambia niente:** la rotella conteneva già le stesse voci. Le due voci promosse
(Assenze e Dream) escono dalla rotella ed entrano nella barra, che su mobile scorre in orizzontale.

Dettagli che valgono la pena di ricordare:

- La tendina sta **fuori dal `<nav>`**, accanto a quella del Bollettino. La nav ha
  `overflow-x-auto`, che crea un contenitore di scorrimento: un pannello in posizione assoluta al
  suo interno verrebbe ritagliato invece di uscire.
- Lo **stato di apertura è condiviso** con la rotella mobile. I due pulsanti sono esclusivi per
  breakpoint (`sm:hidden` contro `hidden sm:block`), quindi non possono essere aperti insieme.
- L'accensione invece **non è condivisa**: `isSettingsActive` guarda solo le voci del gruppo,
  mentre la rotella usa `isRotellaActive`, che include anche il Bollettino perché su mobile quel
  gruppo vive dentro di lei.

### I clienti Dream sono un'anagrafica a sé (5 Settembre 2026)

**Corregge la scelta di poche ore prima.** Il campo Cliente del noleggio puntava all'anagrafica
`clienti`, quella di cantieri e attività. Sbagliato: i clienti del noleggio Dream sono un **insieme
diverso**, non un sottoinsieme di quelli dei cantieri. Ora hanno una tabella loro, `dream_clienti`,
con la stessa forma di `dream_veicoli` — solo `nome` (unico) e `attivo` — e una pagina di gestione
sotto *Impostazioni* accanto a *Dream Veicoli*.

**La colonna resta `cliente_id`**, cambia solo il bersaglio della foreign key: da `clienti` a
`dream_clienti`.

**E qui il deploy si è rotto.** Su Railway c'erano noleggi con un cliente già selezionato, e quei
riferimenti nella tabella nuova non esistono:

```
Error: insert or update on table "dream_noleggi" violates foreign key
constraint "dream_noleggi_cliente_id_fkey"
  step=AddForeignKey
```

Lo start è `prisma db push && node dist/index.js`: **se il push fallisce il container non parte**,
quindi non è stato un errore di migrazione ma il backend giù in crash loop. È il rischio da tenere
a mente ogni volta che si sposta un vincolo su una colonna popolata — con `db push` non esiste il
passo intermedio in cui sistemare i dati, perché lo schema si applica da solo all'avvio.

**La riparazione è un terzo anello nella catena di start**, `dist/scripts/preparaDb.js`, che gira
**prima** del push e azzera i riferimenti cliente rimasti orfani. Due dettagli lo rendono
riutilizzabile invece che usa e getta:

- **Azzera i soli orfani**, non tutta la colonna. A vincolo creato la `UPDATE` non trova più righe,
  quindi a ogni deploy successivo è un `no-op` e non cancella i clienti che nel frattempo sono
  stati assegnati davvero. Una `UPDATE dream_noleggi SET cliente_id = NULL` secca avrebbe
  funzionato una volta sola e poi avrebbe silenziosamente svuotato il campo a ogni riavvio
- **Non dà per scontato lo stato del database**: controlla in `information_schema` se le tabelle
  esistono, perché il push fallito può aver lasciato `dream_clienti` già creata oppure no, e su un
  database vuoto non c'è niente da riparare

Da `Cliente` è sparita la relazione `dreamNoleggi`: le due anagrafiche ora non si conoscono.

**Backup:** `dream_clienti` entra nel dump, nel ripristino e nel reset delle sequence. Nella
cancellazione va **dopo** i noleggi, che la referenziano; nel ripristino **prima**. Anche qui la
lettura è con `?? []`, i backup di stamattina non hanno la sezione.

---

### Durata in ore decimali e riga totali negli export (6 Settembre 2026)

Nel report attività la durata si legge ora **nello stesso modo in Excel e in PDF**: ore decimali con
due cifre fisse, `8.50`, e in fondo alla tabella una riga **TOTALE** con la somma della colonna.

**Excel.** Il valore era già il numero giusto — `durataMinuti / 60` arrotondato a due cifre — ma
senza `numFmt` Excel mostra `8.5`, perché di suo taglia gli zeri finali. Il formato `'0.00'` sulla
cella li tiene, e la colonna resta incolonnata sul punto decimale.

**PDF.** La colonna *Durata* mostrava `8h 30m`. Ora è *Durata (ore)* con `8.50`, **col punto** e non
con la virgola: è la scelta fatta esplicitamente, e per inciso evita anche il carattere fuori da
WinAnsi che i font base di pdfkit non gestiscono. `formatDuration()` resta viva, la usa ancora il
foglio *Riepilogo*.

L'intestazione più lunga ha imposto di allargare la colonna, **da 55 a 60pt, presi dalle Note**: le
larghezze devono continuare a sommare 1141 (A3 orizzontale meno i margini), quindi ogni punto in
più a una colonna è un punto in meno a un'altra. La misura vera contava: `Durata (ore)` a 8pt
grassetto occupa 45pt e nei 49pt utili di prima ci stava per meno di 4pt — sarebbe bastato poco per
mandarla a capo e sfondare l'altezza fissa della testata. Le Note sono la colonna più capiente
(229pt) e quindi quella che sente meno la sottrazione.

**La riga totali segue le stesse regole delle righe normali**: se non entra nella pagina corrente ne
apre una nuova con l'intestazione ripetuta, altrimenti su una tabella lunga finirebbe fuori foglio.

La riga di riepilogo sopra la tabella (`Totale: N attività - X ore`) usava una cifra decimale sola:
ora usa lo stesso formatter delle righe, così lo stesso numero non compare due volte scritto in due
modi diversi nella stessa pagina.

**Verifica:** sweep da 0 a 130 righe per far cadere la riga totali a cavallo del fondo pagina, e
rilettura del file Excel generato per controllare che l'ultima riga sia `TOTALE`, in grassetto, con
`numFmt` `0.00` e la somma attesa. Con zero attività l'export non salta: la riga totali c'è lo
stesso e segna `0.00`.

---

### Lettura delle anagrafiche Dream chiusa al responsabile (6 Settembre 2026)

Le route `dream-veicoli` e `dream-clienti` nascono come copia di `cantieri.routes.ts`, e con la
copia si era portata dietro anche la regola dei permessi: scrittura da `RESPONSABILE`, **lettura da
chiunque sia autenticato**. Nell'originale ha un motivo — i dipendenti hanno bisogno dell'elenco
cantieri per compilare i form. Nelle anagrafiche Dream quel motivo non c'è: le uniche consumatrici
sono le tre pagine sotto `pages/responsabile/`, tutte già dietro `requiredRole="RESPONSABILE"`.

Un dipendente non ci arrivava dall'interfaccia, ma chiamando l'API a mano avrebbe letto l'elenco di
veicoli e clienti Dream. Ora **tutti e diciassette gli endpoint Dream** vogliono il ruolo.

`requireRole()` chiama `authenticate()` al suo interno, quindi la sostituzione è strettamente più
restrittiva e non lascia scoperto il controllo del token. Su entrambi i file è rimasto un commento
che spiega **perché** qui la lettura è chiusa mentre nell'originale è aperta: senza, la prossima
copia da `cantieri.routes.ts` reintrodurrebbe la stessa larghezza.

### Tab Gica e banca dati condivisa (7 Settembre 2026)

Un tab **Gica** nella barra Responsabile, **prima** di *Dream*: stesso form del noleggio ma
**senza quota** e quindi senza importo calcolato, più l'export del periodo in **PDF ed Excel**.

**Tabella separata, anagrafica condivisa.** `gica_noleggi` è una tabella nuova — i record Gica
sono indipendenti da quelli Dream e i due elenchi non si mescolano — ma le sue foreign key
puntano a `dream_veicoli` e `dream_clienti`, che restano **le stesse** di Dream. Un veicolo
aggiunto dalla banca dati compare subito in tutti e due i form. È la scelta opposta a quella dei
clienti Dream di due giorni prima: lì gli insiemi erano diversi e serviva un'anagrafica a sé, qui
sono lo stesso parco mezzi visto da due registri.

`GicaNoleggio` non ha `quota` né `importo_calcolato`: senza percentuale da applicare l'importo
inserito è già quello finale, e una colonna calcolata sempre uguale all'originale sarebbe solo una
copia da tenere allineata.

**`parseDataSolo()` è stata estratta** da `dreamNoleggi.service.ts` a `utils/dataSolo.ts`: la
usano entrambi i servizi e una seconda copia sarebbe divergita, come già successo per `CampoData`.

**Due export in un servizio solo.** `gicaNoleggiExport.service.ts` tiene PDF ed Excel insieme sul
modello di `export.service.ts`, non due file come Dream: condividono formattazione delle date,
degli importi e il calcolo del totale. Il PDF ha cinque colonne che sommano ancora ai 545pt della
tabella A4 (`Data 60 | Veicolo 110 | Cliente 110 | Osservazioni 195 | Importo 70`), titolo *Report
Gica* e riga totali con la sola somma dell'importo. Nell'Excel la colonna importo è un **numero**
con `numFmt '0.00'` — così la riga TOTALE si legge come somma delle righe sopra — mentre le date
sono scritte come stringhe `gg/mm/aaaa`: ExcelJS le convertirebbe con `getTime()` e in Europe/Rome
slitterebbero al giorno prima (nota 8).

**Rotta `/responsabile/gica-noleggio`** e non `/responsabile/gica`: quest'ultima sarebbe stata
prefisso della prima e avrebbe acceso due tab insieme (nota 10). Sul frontend `isExporting` non è
un booleano ma `'pdf' | 'excel' | null`, altrimenti lo spinner comparirebbe su entrambi i pulsanti.

**Rinomina di sole etichette.** Le voci *Dream Veicoli* / *Dream Clienti* si chiamano ora **Banca
dati veicoli** / **Banca dati clienti**, nel menu *Impostazioni* e nel titolo delle pagine: i due
registri le condividono e il nome non doveva più richiamarne uno solo. Rotte
(`/responsabile/dream-veicoli`), endpoint (`/api/dream-veicoli`), tabelle e nomi dei file restano
`Dream*` — sempre nota 10, si rinominano le etichette, non i path.

**Backup:** `gicaNoleggi` entra nel dump, nel ripristino e nel reset delle sequence; si legge con
`?? []` perché i backup precedenti non ce l'hanno. Nella cancellazione va **prima** di
`dream_veicoli` e `dream_clienti`, che referenzia.

**Rollback:** revert dei due commit. La tabella `gica_noleggi` resta nel database senza dare
fastidio a nessuno: essendo additiva, `db push` non ha toccato nulla di esistente.

---

### Assenze che sottraggono ore: il Recupero ore (16 Settembre 2026)

Fino a ieri **ogni** assenza valeva +492 minuti (8h 12m). È giusto per Vacanza, Malattia e Festivo,
sbagliato per il **Recupero ore**, che è tempo già maturato che il dipendente sta consumando: deve
*togliere* 8h 12m dal montante, non aggiungerle. Da oggi un Recupero ore salva `durataMinuti = -492`.
Il Festivo non cambia.

**Il riconoscimento avviene dal nome del tipo assenza, non da un flag sullo schema.** È la decisione
portante e ha un prezzo, che vale la pena scrivere per intero. Un flag `sottraeOre` su `TipoAssenza`
sarebbe stato più solido, ma avrebbe richiesto una colonna, un checkbox in *Tipi assenza* e un
default da decidere per le righe esistenti; per una sola riga di anagrafica era sproporzionato. Il
prezzo è che **il nome diventa dato di dominio**: rinominare "Recupero ore" cambierebbe il segno di
tutte le assenze già registrate di quel tipo. Per questo il rename che attraversa la regola è
**bloccato** (vedi sotto), non lasciato alla buona fede di chi modifica.

- **Punto unico: `backend/src/utils/assenze.ts`.** Contiene `DURATA_ASSENZA_MINUTI`,
  `normalizzaNomeAssenza` (trim + minuscolo + spazi interni collassati, così `"  RECUPERO   ORE  "`
  è lo stesso tipo di `"Recupero ore"`), `isAssenzaNegativa` su un `Set` di nomi e
  `durataAssenzaMinuti`, che ritorna ±492. Quando un domani si vorrà il flag persistito, **si
  riscrive solo questo file**. È separato da `duration.ts`, che parla di orari `HH:mm` e non sa
  nulla di anagrafica assenze
- **Nessuna modifica allo schema:** `durataMinuti` è un `Int`, accetta i negativi. Nessuna
  migrazione, nessun `db push` rischioso (nota 9)
- **Backend, scrittura:** `attivita.service.ts` ha un nuovo metodo privato `durataAssenza()` che
  legge il nome del tipo e ritorna il valore col segno. È chiamato dai **due soli punti di scrittura
  di `durataMinuti`**, `create()` e `update()`, che coprono sia la form assenza del dipendente sia
  l'assegnazione del responsabile. In `create()` è servita una locale `assenzaId` perché il booleano
  `isAssenza` non restringeva il tipo di `input.assenzaId`. Gli endpoint stats e `export.service.ts`
  non sono stati toccati: sommano il valore letto dal database e si adeguano da soli
- **Correzione del segno in `formatDuration`.** `Math.floor(-492 / 60)` è -9 e `-492 % 60` è -12:
  la vecchia implementazione stampava `-9h -12m`. Il bug colpiva **qualsiasi** negativo, non solo le
  assenze. Ora il segno si antepone alla stringa intera e la scomposizione lavora su `Math.abs`.
  Corretta in `export.service.ts` (l'unica rottura reale del backend, la usa il foglio *Riepilogo*
  dell'Excel), in `utils/duration.ts` (codice morto, ma era una trappola) e nel frontend.
  `oreDecimali` e `formatOreDecimali` **non** sono state toccate: `toFixed` gestisce già il segno,
  `-492` → `-8.20`, e con esse restano corrette le colonne "Durata (ore)" e le righe TOTALE
- **`frontend/src/utils/durata.ts`, e qui si rovescia una decisione presa il 3 Agosto.** Allora
  (righe 632-634) si era scelto di **non** centralizzare `formatDuration`, triplicata in
  `ReportPage`, `ResponsabileDashboard` e `AttivitaListPage`, perché il refactor avrebbe toccato più
  file di quanti ne servissero alla funzionalità. Quel ragionamento vale finché le copie sono
  *giuste*: ora sono tutte e tre *sbagliate* allo stesso modo, e lasciarle separate significherebbe
  replicare la stessa correzione tre volte e sperare che la quarta copia, domani, nasca corretta. Il
  file espone anche `isAssenzaNegativa`, che serve solo per le note nelle form: **la regola vera
  resta nel backend**. È una duplicazione fra i due repository separati, come già `festivita.ts`, e
  come quella va tenuta allineata a mano
- **Note dinamiche nelle form:** `AssenzaFormPage` e `AssegnaAttivitaPage` dicevano entrambe "la
  giornata viene conteggiata come 8h 12m", falso per il Recupero ore. Ora il testo dipende dal tipo
  selezionato
- **Rename bloccato:** `tipiAssenza.service.ts` rifiuta un `update()` in cui
  `isAssenzaNegativa(vecchio) !== isAssenzaNegativa(nuovo)`. Tutti gli altri rename restano liberi.
  La handler PUT in `tipiAssenza.routes.ts` **non aveva try/catch**: l'errore sarebbe finito
  nell'error handler globale, che in produzione lo maschera in `Internal Server Error` 500. Ora è
  avvolta e risponde 400 col messaggio, che `TipiAssenzaPage` già sa leggere
- **Dati storici: correzione manuale, nessuno script.** Le Recupero ore inserite prima del deploy
  hanno +492 salvato. Poiché `update()` **ricalcola sempre** `durataMinuti`, basta riaprire ognuna e
  premere *Salva modifiche*. Si trovano da Report, colonna "Assenza". Uno script una-tantum avrebbe
  dovuto indovinare quali righe erano davvero Recupero ore e sarebbe rimasto in repository a fare da
  mina; sono poche righe e l'utente sa quali sono
- **Ordine di deploy: backend PRIMA del frontend.** Il frontend nuovo su backend vecchio scriverebbe
  "sottrae 8h 12m dal montante ore" mentre il backend salva ancora +492: una bugia in faccia
  all'utente. Al contrario il backend nuovo col frontend vecchio è già corretto, solo con la nota
  vecchia sotto la select
- **Rollback:** revert dei commit su entrambi i lati, backend per ultimo. Le assenze già salvate a
  -492 **restano a -492**: `durataMinuti` è persistito e non viene ricalcolato in lettura. Vanno
  riaperte e risalvate, esattamente come i dati storici di oggi ma all'incontrario

### Report attività: giorni vuoti e colorazione weekend/festivi (16 Settembre 2026)

Nella stampa del report di un collaboratore compaiono ora **tutti i giorni del periodo**, anche
quelli senza nulla registrato, così il mese si legge intero senza salti. Sfondo bianco dal lunedì al
venerdì, `#ededed` (`FFEDEDED` nell'Excel) su sabato, domenica e festivi del Canton Ticino.

- **I segnaposto compaiono solo a tre condizioni insieme:** un dipendente selezionato, **nessun**
  filtro cliente o cantiere, e un periodo chiuso valido. La prima è anche il dato che riempie la
  colonna Dipendente delle righe vuote. **Il filtro cliente li esclude perché il report direbbe il
  falso:** con "Mario Rossi + ACME" una riga vuota del 12 marzo sembra dire "Mario non ha lavorato",
  mentre significa solo "non ha lavorato per ACME". La condizione sta in un punto solo,
  `giorniSenzaAttivita()` in `export.service.ts`, ed è calcolata nelle route
  (`soloDipendente: utenteId && !clienteId && !cantiereId`)
- **Lo zebra striping è stato tolto, e non perché ridondante: era incompatibile.** Le righe pari
  avevano sfondo `#f5f5f5`; con la regola nuova un martedì segnaposto sarebbe stato grigio una volta
  su due e si sarebbe letto come un weekend. Il grigio deve voler dire **una cosa sola**. Per lo
  stesso motivo la riga di un **sabato lavorato resta grigia**: il colore dipende dal giorno, non dal
  contenuto
- **Cap a 366 giorni (`MAX_GIORNI_SEGNAPOSTO`), calcolato dai timestamp *prima* del ciclo.** Non è
  una scelta estetica ed è il punto da non "semplificare" filtrando il risultato: un
  `<input type="date">` accetta anni a quattro cifre da `0001`, quindi un refuso come `0202-03-01`
  vale 666.000 giorni, e un ciclo che alloca 666k stringhe mette in ginocchio il processo *prima* di
  arrivare al controllo. Lo stesso confronto copre le date invertite, che danno un conteggio negativo
- **Nuovo `backend/src/utils/festivita.ts`**, estratto da `calendarioEventiExport.service.ts`
  (`pasqua`, `iso` → `isoUtc`, `piuGiorni` → `piuGiorniUtc`, `festiviTicino`) più
  `giornoNonLavorativo` e `giorniPeriodo`. `giorniAnno` **non** si è spostata: ha il campo `col`, che
  è una faccenda del foglio del calendario. I festivi sono in cache per anno, perché
  `giornoNonLavorativo` è chiamata una volta per riga. Il file è la nuova sorgente di verità della
  copia in `frontend/src/utils/festivita.ts`, che resta allineata a mano
- **Insidie del PDF, verificate sulle sorgenti di pdfkit.** `fill(colore)` sporca il fillColor
  corrente, quindi la `fillColor('#000000')` **deve restare fuori** dall'`if` del grigio, o tutte le
  righe dopo una grigia escono col testo grigio. Il rect va disegnato **dopo** il controllo di salto
  pagina, che riassegna `y`. I feriali non si dipingono di bianco: la pagina è già bianca e un rect
  coprirebbe metà del bordo inferiore della riga sopra
- **Excel: durata dei segnaposto a `null`, non `0`**, o uno zero si sommerebbe a vista con le durate
  vere; la cella viene creata lo stesso e resta grigia e bordata. Note, Mattino e Pomeriggio hanno un
  ramo esplicito: i loro fallback valgono `-`, e il trattino significa "attività senza note", non
  "giorno senza attività"
- **Totali intatti per costruzione:** `"Totale: N attività"`, le righe TOTALE e il foglio *Riepilogo*
  continuano a ciclare su `attivita`, non sulle righe della tabella
- **Nota 8 e `toISOString`.** La chiave giorno dei segnaposto è
  `dataRiferimento.toISOString().slice(0, 10)`, e **qui è corretto**: la colonna è `@db.Date` e
  Prisma la rilegge a mezzanotte UTC. Il divieto della nota riguarda le date costruite da componenti
  **locali**. C'è un commento sul punto, o qualcuno "correggerà" il bug che non c'è. Per lo stesso
  motivo i segnaposto passano dalla **stessa `formatDate`** delle righe piene, con una `Date` UTC:
  formattarli a mano dall'ISO farebbe divergere le due specie di riga su un server con offset
  negativo
- **Bug preesistente chiuso, non propagato:** le due route di export erano duplicate al 90% e ora
  condividono un helper, ma l'Excel prima non faceva i lookup dei nomi e ora gli servono.
  `parseInt('abc')` dà `NaN` e `findUnique({ where: { id: NaN } })` fa esplodere Prisma con un 500:
  `idNumerico()` ritorna `undefined` se il valore non è un intero, e l'id malformato vale come filtro
  assente
- **Frontend:** i pulsanti di export erano `disabled` quando `attivita.length === 0`, cioè proprio
  nel caso che questa funzione esiste per coprire — il mese in cui il collaboratore non ha registrato
  nulla. Ora la condizione è sulle date
- **Il grigio va tarato su una stampa vera.** `#f5f5f5` è al limite dell'invisibile su carta, e qui
  il colore porta informazione
- **Deploy senza ordine obbligato:** il frontend nuovo su backend vecchio abilita solo un pulsante
  che scarica un report senza righe grigie; il backend nuovo col frontend vecchio funziona già,
  tranne che per il mese vuoto

**Deploy verificato il 16 Settembre 2026.** Entrambi i lati sono in produzione con il commit giusto:

| | Commit | Stato | Pubblicato (UTC) |
|---|---|---|---|
| Backend (Railway, servizio `web`) | `31e92c7` | `SUCCESS`, istanza `RUNNING` | 15/09 23:15:59 |
| Frontend (Netlify) | `f2cbd7d` | `ready`, *published deploy* | 15/09 23:16:52 |

Su entrambi è stato verificato il **commit effettivamente servito**, non solo che il build fosse
verde: un build riuscito dice che la compilazione è passata, non che sia arrivato il codice giusto.
Sul frontend il controllo è arrivato fino al bundle servito (`/assets/index-BNJj4kk0.js`), dove i due
pulsanti sono `disabled:T||!g||!j` e `disabled:R||!g||!j` — il vecchio gate su `attivita.length === 0`
non c'è più. Sul backend il `RUNNING` vale doppio per via della nota 9: `prisma db push` gira **prima**
dell'avvio, quindi un problema di schema non sarebbe un errore di migrazione ma un backend che non
parte. Qui non si toccava lo schema e infatti l'istanza è salita.

**Resta da verificare a mano, e non è verificabile da qui:** che le righe segnaposto e il grigio
escano giusti su un export vero, e soprattutto la **taratura di `#ededed` su una stampa su carta**.
È il motivo per cui il colore è stato scelto più scuro di `#f5f5f5`, ed è un giudizio che a schermo
non si può dare.

**Questo file è stato spostato nel repo del backend** (`backend/stato_progetto.md`). Stava nella
radice, che **non è un repository**: era quindi l'unico documento del progetto a non essere
versionato, vivo su una sola macchina e perso al primo cambio di computer. Il backend è una scelta di
comodo, non di competenza: **il file racconta entrambi i lati**, e una modifica al solo frontend va
comunque annotata qui, cioè in un commit dell'altro repository. `CLAUDE.md` resta nella radice e non
versionato, ma ora punta alla posizione nuova.

---

### Bollettino: voci a testo libero nel form (16 Settembre 2026)

Nelle sezioni **Mezzi / Materiali / Trasporti** del form bollettino si può scrivere una voce a mano,
senza passare dall'anagrafica. Una spunta **"salva anche in anagrafica"** decide se la voce resta
solo in quel bollettino o entra nell'elenco condiviso. La tendina esistente resta invariata: il
campo libero le si affianca sotto, con la sua spunta e il suo pulsante *Aggiungi*.

#### Il backend era già pronto per metà

Le righe a testo libero **funzionavano già** contro la produzione, e non è stato toccato lo schema:

- `RigaBollettino.voceId` è già `Int?` con `onDelete: SetNull`
- lo schema della POST bollettino accettava già `voceId: ['number','null']` e `descrizione`
- `buildRighe` usa `riga.descrizione` quando manca il `voceId`, ed errore solo se mancano entrambi
- il PDF stampa `riga.descrizione`, non la relazione

**Nessuna modifica a `schema.prisma`**, quindi il `prisma db push` all'avvio non aveva niente da
applicare: il rischio di crash loop della nota 9 non si è presentato.

L'unica cosa che mancava lato server era il **permesso**: `POST /api/voci-bollettino/:tipo` era
riservata al `RESPONSABILE`. Ora chiede solo `fastify.authenticate`, mentre
`assertAccessoBollettini` resta e continua a valere — il permesso si allarga ai dipendenti
**abilitati ai bollettini**, non a tutti. PUT / DELETE / activate restano al responsabile: creare
una voce è un gesto di compilazione, rinominarne o disattivarne una tocca i bollettini altrui.

Chiuso anche il buco del **nome fatto di soli spazi**: `minLength: 1` di ajv è verificato *prima*
del `.trim()`, quindi `"   "` creava una voce vuota in anagrafica. Prima lo poteva fare solo il
responsabile dalla sua modale, ora la rotta è aperta a chiunque compili un bollettino.

#### Frontend: l'identità delle righe cambia

`VoceSelezionata` era `{ voceId: number, quantita }` e il `voceId` faceva da chiave React, da
selettore negli handler e da insieme delle voci già scelte. Le righe libere non hanno un `voceId`,
quindi è stato aggiunto un `uid` **solo client** (contatore di modulo), tolto prima della POST con
un mapper in `handleSubmit`. Gli handler lavorano ora sull'**indice**, e il nome si legge da
`riga.descrizione` invece che da un lookup in `vociById`.

L'`uid` non è derivato dal testo: cambierebbe a ogni battuta se un domani la riga diventasse
editabile, e React smonterebbe l'input a ogni carattere.

**Il blocco di aggiunta è sempre visibile.** Prima l'intero `<div>` stava dentro il ramo
`disponibili.length > 0`: in una sezione senza voci in anagrafica sarebbe sparito anche il campo
libero, cioè proprio nel caso in cui serve di più. Tendina condizionata come prima, campo libero
sempre presente.

**Il testo che coincide con una voce dell'elenco non crea un duplicato**: si riusa quella, col suo
`voceId`, senza nessuna POST. Il confronto normalizza maiuscole e spazi interni
(`trim().toLocaleLowerCase('it').replace(/\s+/g, ' ')`), perché `@@unique([tipo, nome])` su Postgres
è **case-sensitive** e senza normalizzazione "Ruspa" e "ruspa" convivrebbero in anagrafica.

#### La trappola della voce disattivata

La tendina contiene solo le voci **attive**. Un nome che collide con una voce **disattivata**
prende un 400 `Voce già presente` riferito a qualcosa che nell'elenco non c'è: un messaggio
incomprensibile. Il testo mostrato lo dice apertamente e offre la via d'uscita:

> Esiste già una voce con questo nome, probabilmente disattivata. Togli la spunta per usarla solo
> in questo bollettino, oppure chiedi al responsabile di riattivarla.

La discriminazione è sullo **status**, non sul corpo: `err.response?.data?.error` su un 401 scaduto
vale `"Unauthorized"` e verrebbe mostrato all'operatore così com'è.

#### Guardie contro gli errori illeggibili

Superare i limiti dello schema non passa dal `try/catch` della rotta ma dall'**error handler
globale**, che risponde `{ error: 'Error' }`. Nel form del bollettino quell'errore arriverebbe
**dopo** che l'operatore ha disegnato entrambe le firme.

- `maxLength={100}` sull'input. Il limite del backend è 200, ma il PDF stampa la descrizione con
  `lineBreak: false` e `ellipsis: true` su 420pt: oltre ~90 caratteri il testo **esce troncato dal
  bollettino firmato**, che non si può correggere
- pulsanti *Aggiungi* disabilitati a 50 righe (`maxItems: 50` per sezione) con la ragione scritta
- `.trim()` alla creazione della riga, non solo all'invio: il `maxLength: 200` di ajv è controllato
  prima del trim lato server
- `isSalvandoVoce` disabilita il pulsante durante la POST: due click darebbero un 201 e un 400, cioè
  un errore fantasma su una riga che invece è stata creata

#### Ordine di deploy

**Prima il backend, poi il frontend.** Invertendoli, chi spunta la casella prende un 403 dalla rotta
ancora riservata al responsabile.

---

### Invio del bollettino per e-mail (16 Settembre 2026)

Campo **e-mail facoltativo** nel form del bollettino. Al salvataggio il backend genera il PDF e lo
spedisce a quell'indirizzo con **Resend**. Indirizzo ed esito restano sul bollettino, e il
responsabile può **reinviare** dall'archivio correggendo l'indirizzo.

Il codice è completo e **degrada in modo pulito finché `RESEND_API_KEY` non è impostata**: ogni invio
risulta `NON_CONFIGURATA`, l'operatore legge un avviso, l'archivio mostra *Non inviata*. Accendere il
servizio non richiede di toccare una riga di codice, solo tre variabili su Railway.

> **Servizio attivo dal 17 Settembre 2026.** Dominio `gica.ch` verificato su Resend, mittente
> `Bollettini GicaTask <noreply@gica.ch>`, reply-to `info@gica.ch`. Le tre variabili sono impostate
> sul servizio `web` del progetto Railway `sweet-truth`. Nessuna riga di codice è stata modificata
> per accenderlo, come previsto.

#### Il vincolo che guida tutto

Il bollettino è **firmato e non modificabile**. Quando la POST arriva, l'operatore ha già disegnato
entrambe le firme: **nessun fallimento dell'invio mail deve poter essere letto dal client come
"salvataggio fallito"**, perché l'operatore rifirmerebbe tutto e nascerebbe un doppione.

L'handler della POST aveva un solo `try` il cui `catch` risponde 400. Ora quel `try` si chiude sulla
sola `create`; da lì in poi il bollettino esiste e **nessun percorso può più rispondere con un
errore**. `BollettinoEmailService.invia()` e `inviaEmail()` hanno entrambi come contratto esplicito
di **non lanciare mai**: l'esito è sempre nel valore di ritorno.

#### Cinque colonne nullable, nessun enum

`emailDestinatario`, `emailStato`, `emailInviataAt`, `emailMessageId`, `emailErrore`. Cinque
`ADD COLUMN ... NULL` senza default, unique o FK: additive, la categoria che la **nota 9** dichiara
sicura, quindi nessuna modifica a `preparaDb.ts`. Viene conservato solo l'ultimo tentativo, non lo
storico.

- `emailStato` è `String` e **non** un enum Prisma: un enum imporrebbe un `CREATE TYPE` e aggiungere
  un valore costerebbe un altro push. Il tipo forte lo mette TypeScript.
  Valori: `IN_CORSO | INVIATA | ERRORE | NON_VALIDA | NON_CONFIGURATA`.
- `IN_CORSO` è scritto nella `create` stessa: se il processo muore durante l'invio, il responsabile
  vede un invio in sospeso invece di un bollettino che sembra non aver mai richiesto la mail.
- `emailErrore` non è ridondante: senza, i tre casi delle prime settimane (dominio non verificato,
  chiave assente, indirizzo sbagliato) sarebbero indistinguibili. Troncato a 500 caratteri.
- I quattro campi leggibili stanno in `listSelect`: sono stringhe corte, non hanno il problema di
  peso delle firme.
- I backup restano compatibili in entrambe le direzioni: `backup.service.ts` fa `createMany` con le
  righe grezze del JSON, e colonne nullable non rompono i dump precedenti.

#### `fetch` e non l'SDK `resend`

Serve una sola chiamata, sono ~25 righe; è una dipendenza in meno nella build di Railway, che va in
crash loop se lo start non torna. Ma la ragione vera è il **timeout**: questa chiamata sta dentro la
POST che salva le firme e deve avere un tetto duro. Con `fetch` è `AbortSignal.timeout(10_000)`, una
riga; l'SDK non lo espone in modo stabile fra le versioni. Node ≥18 ha `fetch` globale.

L'allegato va passato come **stringa base64 senza prefisso `data:`**, cioè
`pdfBuffer.toString('base64')`.

**Difetto accettato:** se Resend risponde all'11º secondo la mail parte lo stesso e noi la segniamo
`ERRORE`; un reinvio produrrebbe un doppione. Fastidio, non perdita di dati.

#### Latenza

Si passa da ~300 ms a ~1÷1,5 s (PDF in memoria più una chiamata a Resend), con tetto a 10 s.
`apiClient` non ha un `timeout` axios, quindi il browser non tronca nulla. L'alternativa
fire-and-forget è incompatibile con l'avviso richiesto: al momento della risposta l'esito non
esisterebbe ancora.

#### Rotta di reinvio

`POST /api/bollettini/:id/invia-mail` risponde **sempre 200** con l'esito, anche quando l'invio
fallisce. Un 5xx passerebbe dall'error handler globale, che **in produzione maschera i 500 con
"Internal Server Error"**, cancellando proprio la diagnosi che serve. Uniche eccezioni: 404 se il
bollettino non esiste, 400 se non c'è alcun indirizzo utilizzabile.

Il body accetta un `email` facoltativo: senza, si riusa `bollettino.emailDestinatario`. Serve poter
passare un indirizzo nuovo, perché il caso più frequente è "l'operaio ha sbagliato a digitare".

| Metodo | Path | Accesso |
|---|---|---|
| POST | `/api/bollettini/:id/invia-mail` | RESPONSABILE + flag |

#### Frontend: salvato ma con avviso

`handleSubmit` non naviga più incondizionatamente. Se l'esito esiste e non è `INVIATA`, si imposta
`salvato` e si mostra un box **ambra** (non rosso: non è un errore) con un pulsante *Torna ai
bollettini*, senza navigare — l'avviso va letto.

**Non negoziabile:** `disabled={isSaving || !puoSalvare || salvato}` sul submit. Senza `salvato`, chi
legge l'avviso e ritocca "Firma e salva" crea un secondo bollettino identico: è il difetto classico
di "salvato ma con avviso".

`puoSalvare` **non** include la validità dell'e-mail: aggiungercela disabiliterebbe il pulsante, che
è peggio. C'è invece un avviso inline mentre si digita, perché `type="email"` dentro un `<form>`
attiva la validazione nativa: con un indirizzo malformato **il submit non parte** e appare solo un
fumetto di sistema, che su un form lungo da telefono sembra un pulsante rotto.

Nell'archivio, colonna **Mail** fra Ore e Azioni (`—` / *Inviata* / *In corso* / *Non inviata*), col
`title` che mostra `emailErrore`: è lì che quella colonna ripaga. Il reinvio apre una modale
precompilata, non un pulsante secco, perché il caso comune è **correggere** l'indirizzo.

#### Ordine di deploy

**Backend per primo, sempre.** Se uscisse prima il frontend il difetto sarebbe silenzioso e quindi
peggiore: il backend vecchio ignora `email` (non c'è `additionalProperties: false`), risponde
`{ id }`, il frontend non trova `data.email` e naviga — **l'utente crede che la mail sia partita**.

#### Accensione del servizio (17 Settembre 2026)

1. Dominio `gica.ch` verificato su Resend (SPF, DKIM, DMARC)
2. API key con **solo *Sending access***: `GET /domains` risponde infatti
   `401 restricted_api_key — "This API key is restricted to only send emails"`. È la conferma che la
   chiave non può fare altro che spedire, ed è il comportamento voluto
3. Su Railway (progetto `sweet-truth`, servizio `web`): `RESEND_API_KEY`, `MAIL_FROM`,
   `MAIL_REPLY_TO`, impostate in un solo comando per avere un solo redeploy
4. Prova di trasporto diretta all'API Resend, **senza passare dall'app**: `HTTP 200` con message id.
   Serve a separare i due possibili colpevoli — un 403 *domain is not verified* è un problema di DNS,
   non del nostro codice, e dall'interfaccia sarebbe apparso solo come un generico *Non inviata*

Nota per il futuro: `MAIL_FROM` **deve** restare su `gica.ch`. Il valore viene passato tal quale a
Resend, e un mittente fuori dal dominio verificato prende 403 su ogni invio. Il piano gratuito è
nell'ordine dei 100 messaggi/giorno, da confrontare col volume dei bollettini.

**La chiave non è in nessun file del repo**, solo nelle variabili Railway. Va ruotata dalla dashboard
Resend se finisce in una chat, in un log o in una cronologia shell: una chiave con *Sending access*
permette di spedire **a nome di `gica.ch`**, e il danno è alla reputazione del dominio, che si ripara
lentamente. La sostituzione è una variabile e un riavvio.

#### Cosa non cambia

Nessun campo e-mail su Cliente o Cantiere: l'indirizzo si digita ogni volta. Il reinvio resta al
responsabile — consentirlo anche al dipendente sul *proprio* bollettino e *solo* verso l'indirizzo
già salvato costerebbe quattro righe e toglierebbe il "chiama il responsabile" cinque secondi dopo la
firma.

---

### Cantiere facoltativo nel bollettino (17 Settembre 2026)

Il cantiere non è più obbligatorio nel bollettino. Vale la **stessa regola già in uso per le
attività**: *il cantiere è obbligatorio solo se il cliente ne ha almeno uno attivo*
(`attivita.service.ts:126`).

**Il motivo:** **50 clienti attivi su 57 non hanno alcun cantiere**, quindi fino a ieri per loro un
bollettino non era compilabile.

#### Il legame col cliente andava ricostruito prima

`cantiereId` non era solo un campo obbligatorio, era **l'unico legame col cliente**: `clienteNome` si
ricavava da `cantiere.cliente.nome` e il filtro d'archivio passava da `{ cantiere: { clienteId } }`.
Toglierne l'obbligo senza altro avrebbe reciso quel legame. Da qui la colonna `cliente_id` sul
bollettino, che il cantiere non sostituisce ma affianca.

`clienteNome` resta **NOT NULL**: è sempre valorizzato, dal cantiere o dal cliente diretto, e
continua a essere lo snapshot mostrato ovunque.

#### Schema: tutto allargamento, niente di distruttivo

`ADD COLUMN cliente_id INT NULL`, due `DROP NOT NULL` (`cantiere_id`, `cantiere_nome`), una FK su
colonna interamente NULL e un `CREATE INDEX`. Tutte operazioni additive o di allargamento, che la
**nota 9** dichiara sicure per il `db push` senza `--accept-data-loss`.

> **Il rollback dello schema no.** Un `db push` all'indietro riproverebbe a rimettere `NOT NULL` su
> colonne che nel frattempo hanno dei NULL e si fermerebbe, cioè backend in crash loop. Vale la
> stessa nota già scritta per i cantieri generici: in caso di problemi si reverta il **codice**, non
> lo schema.

`isGenerico` non si tocca, per la ragione già documentata: un `DROP COLUMN` fermerebbe il push.

#### Un `OR` invece di un backfill

Il filtro per cliente deve pescare sia le righe nuove (`clienteId` valorizzato) sia quelle storiche
(`clienteId` NULL, raggiungibili solo via cantiere):

```ts
{ OR: [{ clienteId }, { cantiere: { clienteId } }] }
```

Un backfill una tantum avrebbe voluto uno script d'avvio, e **su Railway un avvio che non torna manda
il container in crash loop**. L'`OR` non richiede di riscrivere una sola riga di storico ed è corretto
da subito su ogni bollettino, vecchio o nuovo. **Nessun backfill è stato eseguito.**

#### Il cantiere resta la fonte più precisa

Nella `create`, se arriva `cantiereId` si parte da lì e da lì si ricava anche il cliente: è quel che
permette al **frontend vecchio, che manda il solo `cantiereId`, di continuare a funzionare senza
modifiche**. Solo in assenza di cantiere si legge `clienteId`, e lì scatta il conteggio dei cantieri
attivi del cliente.

#### `cantiereId` fuori da `required`, e nemmeno `clienteId` ci entra

Nello schema della POST **nessuno dei due è `required`**. La verifica "almeno uno dei due" la fa il
service, dentro il `try` che già risponde 400. Mettere `clienteId` in `required` produrrebbe un **400
dallo schema ajv prima dell'handler** con un frontend vecchio: bollettino non salvato e due firme
perse. È la **nota 11** applicata alla lettera.

#### PDF, nome file e mail senza cantiere

- PDF del singolo: alla voce Cantiere compare `—`
- Nome del file: col cantiere invariato, senza cantiere ripiega sul **nome del cliente** — un file
  con solo id e data sarebbe irriconoscibile in una cartella di download
- Copertina del cumulativo: senza cantiere il cliente prende da solo la riga in evidenza
- Oggetto della mail: `Bollettino {cliente} — {data}`, senza il trattino a vuoto; il corpo dice *per
  il cliente Y* invece di *per il cantiere X (cliente)*

#### Cumulativo anche per cliente

| Metodo | Path | Accesso |
|---|---|---|
| GET | `/api/bollettini/cliente/:clienteId/pdf` | RESPONSABILE + flag |

Gemella di `/cantiere/:cantiereId/pdf`, stessi `preHandler`. Comprende tutti i bollettini del
cliente, quelli dei suoi cantieri inclusi: è l'unico cumulativo disponibile per i 50 clienti che
cantieri non ne hanno. Nell'archivio il pulsante cambia etichetta da sé — *cumulativo cantiere* con
un cantiere selezionato, *cumulativo cliente* col solo cliente.

#### Frontend: il box Cantiere compare solo se serve

Come in `AttivitaFormPage`, il box è avvolto in `{cantieri.length > 0 && (…)}`. `loadCantieri` fa già
`setCantieri([])` in testa, quindi non c'è lo sfarfallio che aveva colpito le attività. `puoSalvare`
chiede il cliente e il cantiere **solo se il cliente ne ha**.

Il passaggio di `cantiereNome` a `string | null` nei tipi è voluto: fa emergere in compilazione tutti
i punti da sistemare (archivio → `—`, lista dipendente → ripiego sul cliente).

#### Ordine di deploy: **backend per primo**, al contrario dei cantieri generici

Il frontend vecchio manda solo `cantiereId`, il service ne ricava il cliente e tutto continua come
prima: nessuna finestra di rottura.

**L'ordine inverso romperebbe il salvataggio:** il frontend nuovo può non mandare `cantiereId`, e il
backend vecchio lo ha in `required` → 400 dallo schema ajv, prima dell'handler, con le due firme già
disegnate e perse. È l'opposto di quanto accadde con i cantieri generici, dove andò prima il
frontend.

#### Cosa non cambia

Le firme e il flusso di salvataggio (nessuna modifica ai `SignaturePad` né al `bodyLimit`), l'invio
e-mail salvo oggetto e corpo, `clienteNome` NOT NULL, `isGenerico`, e i bollettini storici — nessuna
riga riscritta.

---

### Allegati al bollettino — foto e PDF (17 Settembre 2026)

Sotto il campo **E-mail** del form bollettino c'è un box **Allegati**: si scelgono immagini o PDF dal
telefono, oppure si scatta una foto sul momento. I file partono insieme al PDF nella mail al
committente — è il motivo per cui il box sta proprio lì e non nel blocco delle firme.

#### Perché R2 e non base64 in Postgres

Le firme sono base64 in colonna `@db.Text`, 5-30 KB l'una. Una foto da telefono è 2-8 MB: **due ordini
di grandezza**. E `backup.service.ts` fa `bollettini: await this.prisma.bollettino.findMany()`
**senza `select`**, quindi ogni colonna del bollettino finisce nel JSON notturno. Il debito già
annotato più sopra (*~40 KB per bollettino, a 2000 bollettini il file è ~80 MB*) sarebbe diventato
ingestibile: con tre foto per bollettino il backup notturno da solo avrebbe superato il gigabyte.

R2 c'era già: `@aws-sdk/client-s3` è una dipendenza e il client condizionale sulle env
(`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) vive in `BackupService`. Si riusa **lo
stesso bucket** con prefisso `allegati/`: nessuna env nuova da impostare su Railway.

**Verificato prima di condividere il bucket:** `cleanupOldBackups` non spazza il bucket con una
`ListObjectsV2`, itera le righe di `backup_log` e cancella **per nome file esatto**. Gli oggetti sotto
`allegati/` non vengono mai toccati dalla pulizia dei backup.

In DB resta la sola riga di metadati (~150 byte), che quindi **può** entrare nel backup.

#### Perché l'upload precede la firma

La POST del bollettino trasporta solo `allegatiIds: number[]`. Tre ragioni, tutte vincolanti:

- il `BODY_LIMIT` di 2 MB resta intatto: dieci foto non ci sarebbero mai entrate;
- **un upload che fallisce deve fallire quando fallire è ancora innocuo**, cioè mentre l'operatore
  compila, non dopo che ha firmato. Dopo la `create` nessun percorso può più rispondere errore, o il
  client lo legge come "non salvato" e fa rifirmare tutto;
- nota tecnica 11: niente vincoli semantici nello schema ajv, o è un 400 *prima* dell'handler.

Nella `create`, gli id ammissibili si filtrano **prima** della `prisma.bollettino.create` e si passano
come `connect` annidato: l'operazione resta atomica e non serve una `update` dopo la create, che è
esattamente il momento in cui nessun errore è più ammesso. Un id non ammissibile — di un altro utente,
o già appeso a un bollettino — viene **scartato in silenzio**: perdere un allegato è sempre meglio che
rifiutare un bollettino già firmato.

#### Il backup contiene i metadati, non i byte

`allegatiBollettino` è una sezione **opzionale** di `BackupData.tables`, come le altre aggiunte in
seguito, così i backup precedenti restano ripristinabili. Nel restore la `deleteMany` sta **prima** di
quella dei bollettini e la `createMany` **dopo**, altrimenti il vincolo di chiave esterna.

Gli oggetti su R2 vivono di vita propria e non vengono mai cancellati per i bollettini salvati:
un ripristino li ritrova al loro posto, perché le chiavi sono nei metadati ripristinati.

#### Pulizia degli orfani: secondo cron alle 2:30

Un allegato nasce con `bollettino_id` NULL e lo resta finché il bollettino non viene salvato. Chi
carica una foto e poi **abbandona il form** lascia su R2 un oggetto che nessuno collegherà mai: il
cron delle 2:30 (dopo quello del backup, stessa timezone `Europe/Rome`) cancella gli orfani più vecchi
di 24 ore, prima l'oggetto e poi la riga. Un errore su R2 non ferma il giro: la riga resta e il giro
successivo riprova.

#### Il PDF elenca i nomi, non impagina i file

Dopo le tre sezioni voci compare una riga sola: `Allegati: foto-1.jpg, muro.pdf`. Il documento firmato
registra così **cosa** era allegato. I file non vengono impaginati perché servirebbe una lettura da R2
per ogni immagine, e nel cumulativo di cliente (50 bollettini) sarebbero centinaia di GET dentro una
sola richiesta.

Nella mail gli allegati si fermano a un totale di **15 MB** e stanno in un `try/catch` proprio: se R2
non risponde la mail parte comunque col solo PDF. Il contratto *"`invia()` non lancia mai"* non si
tocca.

#### Frontend: ridimensionamento prima dell'upload

`AllegatiUploader` ridimensiona le immagini lato client — canvas, lato lungo max 1600 px,
`toBlob('image/jpeg', 0.8)`, lo stesso mestiere che `SignaturePad` fa con `toDataURL`. Una foto da
4 MB scende a ~300 KB, che **in cantiere è la differenza fra funzionare e no**. I PDF passano intatti.
Se la decodifica fallisce (HEIC su un browser che non lo decodifica) si carica l'originale: il MIME è
comunque nell'allowlist del server.

Due pulsanti, entrambi `<input type="file">` nascosti: *Scegli file* (`multiple`) e *Scatta foto*
(`capture="environment"`, che da desktop viene ignorato — innocuo). Ogni file parte appena scelto, con
la sua riga: spinner, poi ✓ oppure l'errore e una ✕ che chiama la DELETE. Massimo 10 file.

**Trappola dell'upload:** `apiClient` ha `Content-Type: application/json` fra i default dell'istanza, e
axios v1 con quell'header in testa **serializza la FormData in JSON** invece di spedirla come
multipart (`transformRequest`: `return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data`).
Il server non avrebbe trovato nessun file. La `uploadAllegato` passa quindi
`headers: { 'Content-Type': undefined }`: azzerato, il browser mette da solo il boundary.

`puoSalvare` **non cambia**: gli allegati sono facoltativi, come l'e-mail.

#### Rotte aggiunte

Tutte dietro `fastify.authenticate` + `assertAccessoBollettini`, e dichiarate **prima** di `/:id`: il
radix tree di Fastify dà comunque la precedenza alle rotte statiche, ma l'ordine esplicito toglie il
dubbio a chi legge.

| Metodo | Path | Accesso |
|---|---|---|
| POST | `/api/bollettini/allegati` | autenticato + flag (multipart, un file, max 10 MB; **503** se R2 non è configurato, 400 su MIME fuori allowlist) |
| DELETE | `/api/bollettini/allegati/:id` | autenticato + flag, solo su un **orfano proprio**; 404 altrimenti |
| GET | `/api/bollettini/allegati/:id/file` | autenticato + flag; il DIPENDENTE accede solo ai propri (orfani suoi, o allegati a un suo bollettino) |

`@fastify/multipart` (già installato, v8.3.1) è registrato in testa al plugin dei bollettini, come fa
`import.routes.ts`. Intercetta solo `multipart/form-data`, quindi la POST JSON del bollettino non è
toccata; i due plugin sono scope fratelli, quindi la doppia registrazione non entra in conflitto.

#### Se R2 non è configurato

La `POST /allegati` risponde **503** e il box mostra *"Gli allegati non sono disponibili"*. Il
bollettino si salva lo stesso, senza file, e nient'altro nell'applicazione ne risente.

#### Cosa non cambia

Le firme e il flusso di salvataggio, il `BODY_LIMIT`, `puoSalvare`, i cumulativi (nessuna lettura da
R2, solo la riga dei nomi), le env (stesso bucket dei backup) e i bollettini storici — nessun
backfill, nessuna riga riscritta.

---

### Report per collaboratore e selezione multipla (21 Settembre 2026)

Nel Report, cliente e dipendente non sono più due tendine a scelta singola ma due **elenchi a
spunta** (`MultiSelect`). E con **due o più dipendenti selezionati** il PDF non è più un elenco
unico: contiene **una sezione per ciascuno**, ognuna da pagina nuova, e l'Excel un foglio per
ciascuno.

#### Perché "due o più" e non "sempre spezzato"

Zero dipendenti selezionati continua a voler dire *"tutti, in un elenco solo"*: è il comportamento
di sempre, ed è quello che le due tabelle di riepilogo della pagina mostrano a schermo. Spezzare
anche quel caso avrebbe cambiato il significato del pulsante Esporta senza che nessuno lo avesse
chiesto, e chi vuole il mensile di tutti separato li seleziona tutti — la riga *Seleziona tutti*
del componente lo fa in un click.

Con **un** dipendente il documento è identico a prima: una sezione, un foglio `Attività`. La soglia
sta a due perché è lì che "sezione" comincia a significare qualcosa.

#### I clienti filtrano, non spezzano

Non si può spezzare lo stesso documento su due dimensioni: un PDF per dipendente *e* per cliente
sarebbe un prodotto cartesiano di sezioni, e non è quello che serve a chi stampa il mensile di una
squadra. I clienti selezionati restringono quindi le attività e basta, e finiscono nella riga dei
filtri come elenco separato da virgole.

Il **cantiere resta a scelta singola** ed è abilitato solo con **esattamente un** cliente
selezionato: l'elenco dei cantieri si carica per cliente (`cantieriApi.getByCliente`) e non esiste
una lista trasversale da cui pescare. Con zero o due clienti il campo si svuota e si disabilita.

#### `soloDipendente` si allarga, ma non sul cliente

I giorni segnaposto — il mese intero, sabati e festivi in grigio, le righe vuote dove non c'è
registrazione — erano riservati al caso *un solo dipendente e nessun cliente*. Ogni sezione è ora
per costruzione di **una persona sola**, quindi la condizione diventa:

```ts
soloDipendente: utentiIds.length > 0 && clientiIds.length === 0 && cantiereId === undefined,
```

Il vincolo su cliente e cantiere **resta intatto**, e per la ragione già scritta in
`export.service.ts`: con un cliente selezionato una riga vuota non direbbe *"quel giorno non ha
lavorato"* ma *"quel giorno non ha lavorato **per quel cliente**"*, che è un'affermazione diversa e
leggibile al contrario. Allentare lì avrebbe prodotto un documento che mente.

Il guadagno è che il report mensile di ciascuno adesso **esiste davvero**: tre dipendenti
selezionati danno tre mesi completi, giorni vuoti compresi. E **un dipendente senza attività nel
periodo mantiene la sua sezione**, fatta dei soli segnaposto: è precisamente l'informazione che si
voleva vedere.

#### Un documento, una `addPage` per sezione, una `end`

Il corpo di `generatePDF` è diventato `renderSezione(doc, gruppo, filters)`, che disegna titolo,
riga dei filtri, riepilogo, tabella e riga TOTALE **senza creare né chiudere il documento**.
`generatePDF(gruppi, filters)` apre il `PDFDocument`, chiama `renderSezione` per ogni gruppo con un
`doc.addPage()` fra uno e l'altro (la prima sezione sta sulla pagina che pdfkit apre da solo) e fa
**una sola** `doc.end()`.

È lo **stesso schema di `bollettinoPdf.service.ts`** (`generateCumulativo`), che impagina 50
bollettini in un documento con la stessa sequenza. Non è una coincidenza da imitare per simmetria:
è l'unico modo in cui pdfkit produce un file solo, perché lo stream si chiude una volta e non si
riapre.

Il titolo `Report Attività` resta, e la riga dei filtri sotto porta già `Dipendente: …` — col
gruppo diventa il nome della sezione, che quindi **si identifica da sé** senza intestazioni nuove.

I **gruppi si costruiscono con una query sola** e una partizione in memoria: N query sarebbero N
volte lo stesso piano con un id diverso, e i totali del riepilogo si calcolano comunque
sull'insieme intero. Gli utenti si rileggono con lo stesso `orderBy` delle tendine, così l'ordine
delle sezioni è quello che il responsabile vede a schermo.

Sull'Excel: **un foglio per gruppo**, e il foglio **`Riepilogo` resta uno**, calcolato sull'unione —
è il quadro d'insieme, e serve proprio a confrontare le persone fra loro. Excel vieta `: \ / ? * [ ]`
nel nome di un foglio, lo tronca a 31 caratteri e non ammette duplicati: un nome non ripulito fa
aprire il file come *danneggiato*, quindi `nomeFoglio` ripulisce, tronca e disambigua con un
progressivo.

#### Compatibilità: le liste non sostituiscono gli id singoli

`GET /api/attivita` accetta `utenteIds`/`clienteIds` **e** i vecchi `utenteId`/`clienteId`, perché
Dashboard e *Assegna attività* filtrano ancora su una persona sola. È ciò che permette il
**backend per primo**: il frontend vecchio continua a funzionare identico mentre il nuovo non è
ancora in linea. Il vincolo del DIPENDENTE resta assoluto — se `user.ruolo === 'DIPENDENTE'` si
impone `utentiIds: [user.id]` ignorando qualunque cosa la query chieda.

`idsNumerici` spezza sulla virgola e scarta i non interi con lo stesso criterio di `idNumerico`: un
`NaN` in un `where` fa esplodere Prisma con un 500.

Il nome del file guadagna il suffisso `-per-dipendente` quando è spezzato, così due esportazioni
consecutive non si sovrascrivono nella cartella Download. E sotto i pulsanti compare una riga di
stato — *"Il PDF conterrà una sezione per ciascuno dei N dipendenti selezionati"* — perché
altrimenti chi stampa non sa cosa sta per ottenere finché non apre il file.

#### I responsabili in fondo alle tendine

`orderBy: [{ ruolo: 'asc' }, { cognome: 'asc' }, { nome: 'asc' }]` in `auth.service.ts` e
`utenti.service.ts`. Postgres ordina gli enum secondo l'**ordine di dichiarazione**, e in
`enum Ruolo { DIPENDENTE RESPONSABILE }` i dipendenti vengono per primi: i responsabili finiscono in
fondo **senza nessun `CASE`** e senza toccare lo schema. Non è un caso speciale sull'account
amministratore, è la regola generale.

Tutte le tendine leggono da questi due metodi, quindi l'ordine è corretto ovunque senza ordinamenti
lato client.

#### Il `nome` è facoltativo: l'amministratore non è una persona

Lo schema ajv imponeva `minLength: 1` sul `nome`, e l'account amministratore si trovava così
costretto a chiamarsi "Sistema Amministratore". Il difetto vero è la pretesa: **un account di
servizio non ha un nome di battesimo**. Il vincolo sul solo `nome` scende quindi a `minLength: 0`
nella POST e nella PUT; il **`cognome` resta obbligatorio**, è il campo che porta sempre l'identità.

La rinomina è **un dato, non codice**: da *Impostazioni → Utenti* si salva l'utente col Nome vuoto e
il Cognome "Amministratore". Nessuno script, nessuna migrazione.

Un helper condiviso — `nomeUtente(u)` in `backend/src/utils/` e `frontend/src/utils/`, identici —
compone `` `${u.cognome} ${u.nome}`.trim() ``. Il `trim` **non è difensivo**: è ciò che assorbe il
nome vuoto, che senza uscirebbe come `"Amministratore "` con lo spazio in coda.

#### Cognome Nome negli elenchi, Nome Cognome nelle frasi

L'helper sostituisce la composizione a mano solo dove il nome è **una voce di elenco o una colonna**
— le tendine di Report, Assegna attività e Archivio bollettini, le tabelle della Dashboard e del
Report, la lista utenti, la tendina del login, le colonne di PDF ed Excel.

**Restano `Nome Cognome`** il saluto in barra dei due layout ("Rossi Mario" a chi ha appena fatto
login suonerebbe come un richiamo), il nome precompilato della **firma dell'operatore** sul
bollettino e nel suo PDF, e il messaggio *"Attività assegnata a Mario Rossi"*: sono frasi e firme,
non elenchi.

#### Cosa non cambia

Lo **schema del database** — nessuna tabella, nessuna colonna, nessun `ALTER`. Il **layout del PDF**
(A3 orizzontale, stesse colonne, stesse larghezze, stessi grigi). Il **foglio `Riepilogo`**, unico e
sull'insieme. Il **vincolo dei segnaposto** rispetto a cliente e cantiere. I **bollettini** e tutto
il resto dell'applicazione.

---

### Bollettino: cantieri, collaboratori e mezzi dalle anagrafiche, a scelta multipla (23 Settembre 2026)

Nel form del bollettino cantieri, collaboratori e mezzi si scelgono ora dalle anagrafiche esistenti
con un **elenco a spunta** (`MultiSelect`), anche più di uno per campo. Il **cliente resta
singolo**: i cantieri scelti devono appartenere tutti a lui.

| Campo | Prima | Ora |
|---|---|---|
| Cantiere | tendina singola | più cantieri del cliente scelto (`cantieriIds`) |
| Numero operai | numero scritto a mano | **Collaboratori**: utenti dell'app (`collaboratoriIds`); `numeroOperai` è il loro conteggio, calcolato dal server |
| Mezzi | voci bollettino `MEZZO`, testo libero ammesso | veicoli dell'anagrafica **Gica Noleggi** (`dream_veicoli`), ore per ciascun mezzo, niente testo libero |

Materiali e trasporti non cambiano (`VociSelector`, testo libero compreso).

#### Schema (solo aggiunte, `db push` sicuro)

- `bollettini_cantieri` (`bollettino_id` cascade, `cantiere_id` nullable SetNull, `nome` copiato
  alla firma).
- `bollettini_collaboratori` (`bollettino_id` cascade, `utente_id` nullable SetNull, `nome`
  copiato alla firma come "Nome Cognome").
- `righe_bollettino.veicolo_id` nullable → `dream_veicoli`, SetNull. Le righe mezzo storiche hanno
  `voce_id` e restano come sono.

`bollettini.cantiere_id` e `cantiere_nome` **restano valorizzati**: il primo cantiere scelto e i
nomi di tutti uniti da virgola. Così elenco, archivio, mail, nome del PDF e cumulativi continuano a
leggere quelle due colonne, e i bollettini precedenti (senza righe nelle tabelle nuove) non vanno
toccati. Il filtro per cantiere (`buildWhere`) cerca in OR su `cantiere_id` e sulla tabella di
collegamento, quindi il cumulativo di cantiere include anche i bollettini in cui quel cantiere non è
il primo. Cantiere e cliente sono ora due OR distinti, messi in `AND`.

#### Backend

- `POST /api/bollettini` accetta `cantieriIds[]`, `collaboratoriIds[]` e righe mezzo con
  `veicoloId`. `cantiereId` singolo e `numeroOperai` restano accettati per compatibilità: se
  `collaboratoriIds` manca vale ancora il numero inviato.
- `GET /api/bollettini/veicoli`: veicoli attivi (`id`, `nome`) per chi è abilitato ai bollettini.
  `/api/dream-veicoli` resta riservata al responsabile.
- PDF: il valore dei campi d'intestazione è limitato a due righe (più cantieri andrebbero a capo
  sopra la riga successiva) e compare una riga **Collaboratori** quando ce ne sono.
- Backup: esporta e ripristina le due tabelle nuove; i veicoli Dream si ripristinano **prima** delle
  righe bollettino, che ora li referenziano.

#### Frontend

- `MultiSelect` ha una casella di ricerca oltre le 8 voci.
- Nuovo `MezziSelector`: scelta multipla dei veicoli e ore per ciascuno.
- `BollettinoFormPage`: cantieri e collaboratori a spunta; l'utente loggato parte già selezionato
  tra i collaboratori; con un solo cantiere questo è preselezionato come prima.
- Elenco dipendente: nomi dei collaboratori sotto la riga operai. Archivio: i nomi nel tooltip
  della colonna Operai.

La pagina **Anagrafica → Mezzi** (voci `MEZZO`) non alimenta più il form: i mezzi nuovi vanno
aggiunti nell'anagrafica veicoli di Gica/Dream.

---

## Progetto Completato

Tutte le fasi sono state completate con successo.

---

## Struttura File Principali

### Backend
```
backend/
├── prisma/
│   ├── schema.prisma          # Schema database
│   └── seed.ts                # Script seed dati iniziali
├── src/
│   ├── index.ts               # Entry point Fastify
│   ├── config/index.ts        # Configurazione ambiente
│   ├── plugins/
│   │   ├── auth.ts            # Guardie ruolo; legge Bearer, poi il cookie
│   │   └── prisma.ts          # Plugin Prisma per Fastify
│   ├── scripts/
│   │   └── preparaDb.ts       # Ripara i dati prima del push dello schema
│   ├── routes/
│   │   ├── index.ts           # Registrazione tutte le route
│   │   ├── auth.routes.ts     # Autenticazione
│   │   ├── clienti.routes.ts  # CRUD clienti
│   │   ├── cantieri.routes.ts # CRUD cantieri
│   │   ├── tipiAttivita.routes.ts # CRUD tipi
│   │   ├── tipiAssenza.routes.ts  # CRUD tipi assenza
│   │   ├── utenti.routes.ts   # CRUD utenti
│   │   ├── attivita.routes.ts # CRUD attività + export
│   │   ├── backup.routes.ts   # Backup/ripristino
│   │   ├── import.routes.ts   # Import massivo Excel
│   │   ├── bollettini.routes.ts # CRUD bollettini + PDF
│   │   ├── vociBollettino.routes.ts # Anagrafiche mezzi/materiali/trasporti
│   │   ├── calendarioEventi.routes.ts # CRUD eventi + export Excel
│   │   ├── dreamNoleggi.routes.ts # CRUD noleggi Dream + export PDF
│   │   ├── dreamVeicoli.routes.ts # Anagrafica veicoli Dream
│   │   └── dreamClienti.routes.ts # Anagrafica clienti Dream (separata)
│   ├── services/
│   │   ├── allegatiBollettino.service.ts # Foto e PDF su R2, prefisso allegati/
│   │   ├── attivita.service.ts  # CRUD attività
│   │   ├── auth.service.ts      # Login e utente corrente
│   │   ├── backup.service.ts    # Backup R2
│   │   ├── bollettini.service.ts    # CRUD bollettini
│   │   ├── bollettinoPdf.service.ts # PDF singolo e cumulativo
│   │   ├── calendarioEventi.service.ts       # CRUD eventi calendario
│   │   ├── calendarioEventiExport.service.ts # Foglio annuale, festivi Ticino
│   │   ├── cantieri.service.ts  # CRUD cantieri
│   │   ├── clienti.service.ts   # CRUD clienti
│   │   ├── dreamClienti.service.ts  # CRUD clienti Dream
│   │   ├── dreamNoleggi.service.ts  # CRUD noleggi + calcolo quota 70/30
│   │   ├── dreamNoleggiPdf.service.ts # Report Dream, A4 verticale
│   │   ├── dreamVeicoli.service.ts  # CRUD veicoli Dream
│   │   ├── export.service.ts    # Generazione PDF/Excel
│   │   ├── import.service.ts    # Import massivo da Excel
│   │   ├── scheduler.service.ts # Cron: backup 2:00, allegati orfani 2:30
│   │   ├── seed.service.ts      # Tipi assenza di default + pulizia generici
│   │   ├── tipiAssenza.service.ts  # CRUD tipi assenza
│   │   ├── tipiAttivita.service.ts # CRUD tipi attività
│   │   ├── utenti.service.ts    # CRUD utenti
│   │   └── vociBollettino.service.ts # Anagrafica polimorfa voci
│   ├── utils/
│   │   ├── password.ts        # Hash/verifica password
│   │   ├── duration.ts        # Calcolo durate e settimane
│   │   ├── assenze.ts         # Durata e segno delle assenze (punto unico)
│   │   ├── festivita.ts       # Festivi Ticino e giorni non lavorativi
│   │   ├── nomeUtente.ts      # Cognome Nome, col trim sul nome vuoto
│   │   └── bollettiniAccess.ts # Guardia flag bollettini (condivisa)
│   └── types/index.ts         # Tipi TypeScript
├── stato_progetto.md          # Questo file: storia di ENTRAMBI i repo
└── package.json
```

Lo `start` è **una catena di tre passi**, non un comando solo:

```
node dist/scripts/preparaDb.js && prisma db push && node dist/index.js
```

Non esistendo `prisma/migrations`, lo schema si applica con `db push` **all'avvio**. Ne segue che
un push fallito tiene giù il container, e che ogni sistemazione dei dati che il push richiede va
messa nel primo anello, prima che lo schema cambi.

### Frontend
```
frontend/
├── src/
│   ├── main.tsx               # Entry point React
│   ├── App.tsx                # Router e provider
│   ├── index.css              # Stili Tailwind
│   ├── api/
│   │   └── client.ts          # Axios client e API functions
│   ├── context/
│   │   └── AuthContext.tsx    # Stato autenticazione
│   ├── components/
│   │   ├── ProtectedRoute.tsx
│   │   ├── DipendenteLayout.tsx
│   │   ├── ResponsabileLayout.tsx
│   │   ├── AllegatiUploader.tsx   # Foto/PDF, ridimensiona e carica su R2
│   │   ├── CalendarioEventiGrid.tsx # Griglia annuale scorrevole
│   │   ├── CampoData.tsx          # Input data, condiviso Calendario/Dream
│   │   ├── DateTimeInput.tsx      # Input data/ora con picker e default
│   │   ├── InactivityWarning.tsx  # Modal avviso timeout sessione
│   │   ├── MonthNavigator.tsx     # Navigazione mese + utility su "YYYY-MM"
│   │   ├── MultiSelect.tsx        # Elenco a spunta, chiusura al click fuori
│   │   ├── SignaturePad.tsx       # Firma su canvas (pointer events, no librerie)
│   │   ├── VociSelector.tsx       # Selezione voci con quantità
│   │   └── Modal.tsx
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── DipendenteDashboard.tsx
│   │   ├── ResponsabileDashboard.tsx
│   │   ├── dipendente/
│   │   │   ├── AttivitaListPage.tsx
│   │   │   ├── AttivitaFormPage.tsx
│   │   │   ├── AssenzaFormPage.tsx   # Form separato per le assenze
│   │   │   ├── BollettiniListPage.tsx
│   │   │   └── BollettinoFormPage.tsx
│   │   └── responsabile/
│   │       ├── ClientiPage.tsx
│   │       ├── ClienteDetailPage.tsx
│   │       ├── UtentiPage.tsx
│   │       ├── ReportPage.tsx
│   │       ├── AssegnaAttivitaPage.tsx
│   │       ├── BackupPage.tsx
│   │       ├── ImportPage.tsx
│   │       ├── CantieriPage.tsx      # Gestione cantieri
│   │       ├── TipiAttivitaPage.tsx  # Gestione tipi attività
│   │       ├── TipiAssenzaPage.tsx   # Gestione tipi assenza
│   │       ├── BollettiniArchivioPage.tsx # Archivio + cumulativo
│   │       ├── VociBollettinoPage.tsx     # Un file per mezzi/materiali/trasporti
│   │       ├── CalendarioEventiPage.tsx   # Form, elenco, griglia ed export
│   │       ├── DreamNoleggiPage.tsx       # Form, elenco, totali ed export PDF
│   │       ├── DreamVeicoliPage.tsx       # Anagrafica veicoli Dream
│   │       └── DreamClientiPage.tsx       # Anagrafica clienti Dream
│   ├── utils/
│   │   ├── festivita.ts       # Pasqua e festivi Ticino (copia del backend)
│   │   ├── nomeUtente.ts      # Cognome Nome (copia del backend)
│   │   └── durata.ts          # formatDuration con segno + assenze negative
│   └── types/index.ts
├── netlify.toml
└── package.json
```

---

## Variabili Ambiente

### Backend (Railway)
```
DATABASE_URL=postgresql://...
JWT_SECRET=<stringa-segreta>
NODE_ENV=production
FRONTEND_URL=https://gicatask.netlify.app

# Cloudflare R2 (opzionali). Stesso bucket per i backup e per gli allegati dei
# bollettini, che stanno sotto il prefisso allegati/. Senza queste, la POST
# /api/bollettini/allegati risponde 503 e il bollettino si salva senza file.
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_BUCKET_NAME=gicatask-backups

# Resend (impostate in produzione dal 17/09/2026).
# Senza queste, ogni invio risulta NON_CONFIGURATA e nulla si rompe.
# MAIL_FROM deve stare sul dominio verificato su Resend, altrimenti 403.
RESEND_API_KEY=<api-key-con-solo-sending-access>
MAIL_FROM=Bollettini GicaTask <noreply@gica.ch>
MAIL_REPLY_TO=info@gica.ch
```

### Frontend (Netlify)
```
VITE_API_URL=https://web-production-fde54.up.railway.app
```

---

## Utenti di Test (da seed)

| Nome | Cognome | Ruolo | Password |
|------|---------|-------|----------|
| Mario | Rossi | RESPONSABILE | admin123 |
| Luigi | Verdi | DIPENDENTE | (nessuna) |
| Anna | Bianchi | DIPENDENTE | (nessuna) |
| Giuseppe | Neri | DIPENDENTE | dip123 |

---

## Note Tecniche

1. **Cookie Cross-Site:** Per funzionare tra Netlify e Railway, i cookie usano `sameSite: 'none'` e `secure: true` in produzione. **Non bastano da soli:** quel cookie è di terze parti e i browser mobili lo bloccano. L'autenticazione che regge ovunque è il token in `localStorage`, che l'interceptor axios manda come header `Authorization: Bearer`; il backend legge l'header per primo e usa il cookie solo come ripiego. Ne segue la regola pratica: **ogni chiamata al backend deve passare da `apiClient`**, mai da una `fetch` nuda con `credentials: 'include'`, download di file compresi.

2. **Cantiere Generico:** rimosso. Il cantiere è **facoltativo** (`cantiereId` nullable): un'attività senza cantiere lo lascia vuoto, invece di puntare a un segnaposto. All'avvio `removeCantieriGenerici()` cancella i cantieri con `isGenerico: true` rimasti in produzione e scollega le attività che li usavano. Il campo `isGenerico` sopravvive nello schema solo per far funzionare questa pulizia.

3. **Permessi Modifica:** I dipendenti possono modificare/eliminare le proprie attività senza limiti di data (il vincolo alla settimana corrente è stato rimosso). I responsabili possono agire su qualsiasi attività e riassegnarla a un altro dipendente.

4. **Auto-selezione Form:** Nei form con select a cascata (Cliente → Cantiere), se c'è una sola opzione viene selezionata automaticamente.

5. **Tipi Attività Globali:** I tipi attività sono entità indipendenti, non legati a specifici cantieri. Sono condivisi e riutilizzabili per qualsiasi cliente/cantiere.

6. **Sistema Backup:** I backup vengono salvati su Cloudflare R2 in formato JSON. Ogni notte alle 2:00 viene creato un backup automatico e vengono eliminati quelli più vecchi di 7 giorni. Il ripristino sovrascrive tutti i dati esistenti in una transazione atomica.

7. **Bollettini:** i PDF non sono archiviati ma rigenerati dalle righe a ogni download, quindi i cumulativi — **per cantiere e per cliente** — sono aggiornati per costruzione. Il cantiere è **facoltativo**, con la stessa regola delle attività: obbligatorio solo se il cliente ne ha almeno uno attivo. Il cliente invece c'è sempre, e nei bollettini precedenti alla colonna `cliente_id` si raggiunge attraverso il cantiere: per questo il filtro d'archivio per cliente è un `OR` fra i due percorsi. Le firme sono PNG base64 in Postgres, escluse dai `select` degli elenchi. Gli **allegati** (foto e PDF) seguono invece la regola opposta: i byte stanno su **R2** sotto il prefisso `allegati/`, in Postgres c'è la sola riga di metadati, e l'upload avviene **prima** della firma perché dopo la `create` nessun errore è più ammissibile. L'accesso dipende dal flag `abilitatoBollettini` letto dal database a ogni richiesta e non dal token.

8. **Date senza orario:** le colonne `@db.Date` (attività, bollettini, calendario eventi) valgono come **giorni**, non come istanti. Lato server vanno costruite con `Date.UTC()` e mai con la mezzanotte locale: ExcelJS converte le date con `getTime()`, quindi in Europe/Rome uno slittamento al giorno precedente sarebbe visibile in ogni export. Lato client restano stringhe `YYYY-MM-DD` e si formattano con `slice(0, 10)`, mai passando da `new Date(iso).toLocaleDateString()`.

9. **Lo schema si applica all'avvio, e questo ha un prezzo.** Non c'è la cartella `prisma/migrations`: lo `start` fa `prisma db push` prima di avviare il server. Comodo finché le modifiche sono additive, ma **una modifica che il push non riesce ad applicare non è un errore di migrazione: è il backend che non parte**, in crash loop. Vale in particolare per i vincoli su colonne popolate — spostare una foreign key su un'altra tabella fallisce se i valori già presenti non esistono nella tabella nuova (successo il 5 Settembre). Non essendoci un passo intermedio in cui sistemare i dati, la sistemazione va messa in `src/scripts/preparaDb.ts`, che gira **prima** del push. Chi scrive lì dentro tenga presente che quel codice rigira **a ogni riavvio**: dev'essere idempotente e mirato (azzerare i soli riferimenti orfani, non l'intera colonna), altrimenti la riparazione di oggi diventa la perdita di dati di domani.

10. **Nessuna rotta può essere prefisso di un'altra.** `isActive()` nei layout confronta con `startsWith`, quindi con `/responsabile/dream` e `/responsabile/dream-veicoli` si accenderebbero due tab insieme. È il motivo per cui la sezione si chiama *Dream* nell'interfaccia ma la rotta è rimasta `/responsabile/dream-noleggio`: si rinominano le etichette, non i path.

11. **Nessun vincolo semantico in `createBodySchema` sui campi facoltativi.** `format: 'email'` *è* disponibile (`@fastify/ajv-compiler` carica `ajv-formats` di default), ma usarlo sul campo e-mail del bollettino genererebbe un **400 prima dell'handler**: bollettino non salvato e due firme perse per un typo su un campo che è facoltativo. In più `ajv-formats` lì è una dipendenza *transitiva*, non dichiarata, e un bump di Fastify potrebbe togliere la validazione in silenzio. La regola generale: lo schema tutela il server (tipi e lunghezze massime), la semantica si valuta **dopo** il salvataggio, nel codice, dove il fallimento può diventare un avviso invece che un errore.

12. **I pannelli a tendina stanno fuori dal `<nav>`.** La barra ha `overflow-x-auto` per scorrere su schermi stretti, e quello crea un contenitore di scorrimento che **ritaglia** i figli in posizione assoluta: una tendina messa dentro la nav verrebbe tagliata invece di uscirne. *Impostazioni* e *Bollettino* sono fratelli della nav, non figli.

---

## Stato Finale

Tutte le fasi del progetto sono state completate:

- ✅ Fase 1: Setup e Autenticazione
- ✅ Fase 2: CRUD Anagrafiche
- ✅ Fase 3: Area Dipendente
- ✅ Fase 4: Area Responsabile (Report e Assegnazione)
- ✅ Fase 5: Backup e Ripristino
- ✅ Fase 6: Configurazione Finale

### Eventuali Sviluppi Futuri

- CI/CD con GitHub Actions
- Notifiche email
- Dashboard statistiche avanzate
- PWA / App mobile
- Export attività in altri formati (CSV)
- Report grafici con chart
