# GicaTask Backend

API backend per GicaTask - Portale Gestione Attività Logistica.

## Stack Tecnologico

- **Runtime**: Node.js 18+
- **Framework**: Fastify
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Autenticazione**: JWT (httpOnly cookies)
- **Linguaggio**: TypeScript

## Setup Locale

```bash
npm install
cp .env.example .env
# Configura DATABASE_URL in .env

npx prisma generate
npx prisma migrate dev
npx prisma db seed

npm run dev
```

Il server sarà disponibile su http://localhost:3001

## Scripts

- `npm run dev` - Avvia in modalità sviluppo
- `npm run build` - Compila TypeScript
- `npm start` - Avvia in produzione
- `npm run typecheck` - Verifica tipi TypeScript

## Variabili d'Ambiente

```env
DATABASE_URL=postgresql://user:password@localhost:5432/gicatask
PORT=3001
JWT_SECRET=your-secret-key
CORS_ORIGIN=http://localhost:5173
```

## Deploy su Railway

1. Crea progetto su [Railway](https://railway.app)
2. Aggiungi servizio PostgreSQL
3. Collega questo repository
4. Configura variabili d'ambiente
5. Deploy automatico

## API Endpoints

### Auth
- `GET /api/auth/users` - Lista utenti attivi
- `GET /api/auth/check-password/:id` - Verifica se utente ha password
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Utente corrente

## Credenziali di Test

| Utente | Ruolo | Password |
|--------|-------|----------|
| Mario Rossi | RESPONSABILE | admin123 |
| Giuseppe Neri | DIPENDENTE | dip123 |
| Luigi Verdi | DIPENDENTE | (nessuna) |
| Anna Bianchi | DIPENDENTE | (nessuna) |
