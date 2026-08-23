# Derya Freight OS

Automated freight forwarding & procurement platform. Captures customer RFQs, parses them with AI, sources rates from carriers/agents, builds quotes, tracks jobs from booking through delivery — with a CRM sub-module for customer relationships.

## Project context

- Vision & status: [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md)
- Roadmap to automated forwarding office: [`docs/PRODUCTIZATION_ROADMAP.md`](docs/PRODUCTIZATION_ROADMAP.md)

## Tech

- Web: Next.js 15 (App Router) + TypeScript, Server Components + Server Actions
- DB: SQLite (local demo) / Postgres-ready
- ORM: Prisma
- Auth: Cookie-based credentials
- AI: OpenAI GPT-5.6 via the Responses API

## Prereqs

- Node.js 20+

## Getting started

1) Create `.env` from `.env.example` (set `OPENAI_API_KEY` for AI features)
2) Install deps:

```bash
npm install
```

3) Push schema + seed:

```bash
npm run db:push
npm run db:seed
npx tsx prisma/seed-jobs.ts   # seeds demo jobs, RFQs, carrier quotes, milestones
```

4) Start dev server:

```bash
npm run dev
```

## Demo logins

- `admin@demo.local / admin1234`
- `sales1@demo.local / sales1234`

## Key routes

- `/dashboard` — control workbench for the focused load/RFQ
- `/dashboard/inbox` — email triage, load-linked threads, and RFQ intake
- `/dashboard/jobs` — RFQ → pricing → booked/waiting cargo → en route → delivered pipeline
- `/dashboard/pricing` — target price capture and forwarder quote comparison
- `/dashboard/rfq/[id]` — RFQ qualification and maturity gate
- `/dashboard/settings/email` — Gmail/Outlook/IMAP setup
- `/dashboard/customers` — CRM
- `/dashboard/customer-portal`: staff company and customer-user management with scoped workspace preview
- `/portal`: customer username and password sign-in to the company-scoped Supply OS
- `/customer`: public design sandbox with fictional data only, never live customer records
- `/api/jobs/[id]/quote-pdf` — printable customer quote
