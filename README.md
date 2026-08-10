# UniPay API

Fastify, TypeScript, Prisma, and PostgreSQL API boilerplate.

## Requirements

- Node.js 20 or newer
- PostgreSQL

## Setup

```sh
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
```

Set `DATABASE_URL` in `.env` to a reachable PostgreSQL database. The same
connection string can also be placed in `prisma/.env` for Prisma CLI commands.

## Commands

```sh
npm run dev          # Start the API with tsx watch mode
npm run debug        # Start the API with the Node.js inspector on port 9229
npm run build        # Compile TypeScript to dist/
npm start            # Run the compiled server
npm run db:generate  # Generate Prisma Client
npm run db:migrate   # Create/apply a development migration
npm run db:seed      # Seed electricity biller providers and meter whitelist records
npm run db:studio    # Open Prisma Studio
```

The seed reads `Meter Bill List.XLSX` from the project root. Records default to
`MESC-MANDALAY`; set `DEFAULT_BILLER_CODE` to another seeded provider code when
needed.

## PM2 Staging

Configure `DATABASE_URL` and any staging-specific values in `.env` on the
staging server, then run these commands from the project directory:

```sh
npm install
npm run build
npm run pm2:start
pm2 status
pm2 logs unipay-billing-service --lines 20
```

For subsequent deployments:

```sh
npm run build
npm run pm2:reload
```

To stop the service:

```sh
npm run pm2:stop
```

The only route currently registered is `GET /health`. Successful responses use
`{ "err": 200, "data": ... }`; handled errors use `{ "err": <status>, "message": "..." }`.

## Structure

```text
src/
├── config/       Environment validation
├── controllers/  Request handlers
├── plugins/      Fastify plugins, including Prisma
├── routes/       Route modules
├── schemas/      Request/response schemas
├── services/     Business logic
├── utils/        Shared helpers
├── app.ts        Fastify application factory
└── server.ts     Server startup and shutdown
prisma/
├── schema.prisma Prisma schema
└── .env.example  Prisma CLI environment example
```
