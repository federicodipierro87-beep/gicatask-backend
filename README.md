# GicaTask Backend

Backend API per GicaTask - Portale Gestione Attività Logistica.

## Stack Tecnologico

- **Runtime**: Node.js 18+
- **Framework**: Fastify
- **Linguaggio**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Autenticazione**: JWT (httpOnly cookies)
- **Storage**: Cloudflare R2 (backup)
- **Scheduler**: node-cron

## Requisiti

- Node.js 18+
- PostgreSQL 14+
- Account Cloudflare (opzionale, per backup)

## Installazione Locale

```bash
# Clona il repository
git clone https://github.com/federicodipierro87-beep/gicatask-backend.git
cd gicatask-backend

# Installa dipendenze
npm install

# Copia e configura variabili ambiente
cp .env.example .env
# Modifica .env con i tuoi valori

# Genera Prisma Client
npx prisma generate

# Esegui migrazioni
npx prisma db push

# (Opzionale) Popola con dati di test
npx prisma db seed

# Avvia in development
npm run dev
```

Il server sarà disponibile su http://localhost:3001

## Variabili Ambiente

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/gicatask

# JWT
JWT_SECRET=una-stringa-segreta-lunga-e-casuale

# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

# CORS
FRONTEND_URL=http://localhost:5173

# Cloudflare R2 (opzionale, per backup)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=gicatask-backups
```

## Script Disponibili

| Script | Descrizione |
|--------|-------------|
| `npm run dev` | Avvia server in development con hot-reload |
| `npm run build` | Compila TypeScript |
| `npm start` | Avvia server in production |
| `npm run typecheck` | Verifica tipi TypeScript |

## API Endpoints

### Autenticazione (`/api/auth`)
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/users` | Lista utenti attivi |
| GET | `/check-password/:id` | Verifica se utente ha password |
| POST | `/login` | Login |
| POST | `/logout` | Logout |
| GET | `/me` | Utente corrente |

### Clienti (`/api/clienti`)
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/` | Lista clienti |
| GET | `/:id` | Dettaglio cliente |
| POST | `/` | Crea cliente |
| PUT | `/:id` | Modifica cliente |
| DELETE | `/:id` | Disattiva cliente |
| POST | `/:id/activate` | Riattiva cliente |

### Cantieri (`/api/cantieri`)
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/cliente/:clienteId` | Cantieri per cliente |
| GET | `/:id` | Dettaglio cantiere |
| POST | `/` | Crea cantiere |
| PUT | `/:id` | Modifica cantiere |
| DELETE | `/:id` | Disattiva cantiere |
| POST | `/:id/activate` | Riattiva cantiere |

### Tipi Attività (`/api/tipi-attivita`)
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/cantiere/:cantiereId` | Tipi per cantiere |
| POST | `/` | Crea tipo |
| PUT | `/:id` | Modifica tipo |
| DELETE | `/:id` | Disattiva tipo |
| POST | `/:id/activate` | Riattiva tipo |

### Utenti (`/api/utenti`)
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/` | Lista utenti |
| GET | `/:id` | Dettaglio utente |
| POST | `/` | Crea utente |
| PUT | `/:id` | Modifica utente |
| POST | `/:id/password` | Imposta/rimuove password |
| DELETE | `/:id` | Disattiva utente |
| POST | `/:id/activate` | Riattiva utente |

### Attività (`/api/attivita`)
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/` | Lista attività (con filtri) |
| GET | `/me` | Attività utente corrente |
| GET | `/:id` | Dettaglio attività |
| POST | `/` | Crea attività |
| PUT | `/:id` | Modifica attività |
| DELETE | `/:id` | Elimina attività |
| GET | `/export/pdf` | Export PDF (responsabile) |
| GET | `/export/excel` | Export Excel (responsabile) |
| GET | `/stats` | Statistiche (responsabile) |

### Backup (`/api/backup`) - Solo Responsabile
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/status` | Stato sistema backup |
| GET | `/test` | Test connessione R2 |
| GET | `/` | Lista backup |
| POST | `/` | Crea backup manuale |
| POST | `/:id/restore` | Ripristina backup |
| DELETE | `/:id` | Elimina backup |

## Deploy su Railway

1. Crea un nuovo progetto su [Railway](https://railway.app)
2. Aggiungi un database PostgreSQL
3. Collega questo repository GitHub
4. Configura le variabili ambiente (vedi sopra)
5. Il deploy è automatico ad ogni push su `main`

## Backup Automatici

Se configurato con Cloudflare R2:
- **Backup automatico**: ogni giorno alle 2:00 (Europe/Rome)
- **Retention**: 7 giorni (backup più vecchi eliminati automaticamente)
- **Formato**: JSON con tutte le tabelle

### Configurazione R2

1. Crea un bucket su Cloudflare R2
2. Genera un API token con permessi "Object Read & Write"
3. Aggiungi le variabili `R2_*` su Railway

## Licenza

ISC
