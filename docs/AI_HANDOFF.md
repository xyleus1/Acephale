# AI Handoff

## Latest Update

### Retired the parallel procurement prototype and restored freight workflows

- Removed the isolated prototype UI, API routes, domain modules, browser state,
  styles, tests, and feature-only documentation.
- Restored the freight dashboard, RFQ, pricing, inbox, CRM, carrier, activity,
  reporting, search, and domestic-pricing pages that had been replaced with
  redirects.
- Restored `/dashboard` as the operator home and `/dashboard/loads` as the
  restricted employee home.
- Removed dependencies that no remaining source file imports.
- Removed model promotion, slogans, internal strategy jargon, and
  anthropomorphic system copy from active product surfaces.
- Added `docs/PRODUCT_COPY_POLICY.md` and a build-time copy check.

## Date

2026-08-08

## Branch

remove-retired-product-bloat, targeting main

## Verification

- The complete 24-migration chain passed on a disposable PostgreSQL database.
  Post-migration checks found zero retired relations, functions, triggers, or
  constraints.
- Prisma validation, generated client, TypeScript, production build, docs
  freshness, copy policy, and focused freight workflow regressions passed.
- Authenticated runtime smoke checks returned 200 for ten restored admin routes.
  The employee loads page returned 200, while dashboard home and new-load entry
  redirected to the employee loads board as required.

## Database Retirement

The founder approved permanent removal of the retired prototype's persisted
data. The 26 active Prisma models are removed and a forward migration drops
their 26 tables and 18 trigger functions. The five historical migrations remain
unchanged so deployed databases retain a valid migration history.
