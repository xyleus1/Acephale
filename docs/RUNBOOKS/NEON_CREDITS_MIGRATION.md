# Neon Credits Migration (YC $100k)

> **EXECUTED 2026-07-08** via Path C (dump/restore): production now runs on
> project `derya-production` (`broad-cloud-67682012`) in org `Derya`,
> database `derya_production`. Old project `hidden-heart-85646173` is kept
> untouched as rollback — decommission no earlier than **2026-07-15** (see
> section C.5; that deletion destroys the old database). Full record in
> `docs/ENGINEERING_LOG.md` (2026-07-08 entry).

The YC deal granted $100,000 in Neon credits, valid 12 months from approval.
The credits live in the Neon organization **"Derya"** (Launch plan, no
projects yet). The live production project is **`neon-champagne-cable`**
(AWS US East 1, ~191 MB storage, 4 branches, no project-level integrations)
in the organization **"Vercel: mert's projects"** — a **Vercel-managed org**
on the **Free plan**, created through the Vercel Marketplace and billed
through Vercel.

**Urgency (2026-07-08):** the Neon console warns the project is over 80% of
its monthly Free-plan compute limit and will face **database downtime** at
100%. Burn rate (~36.7 CU-hrs in the first 7 days of July) points at
suspension well before month end. The cutover into the credited org is the
fix and should happen within days, not weeks.

Confirmed constraint (Neon docs + Vercel staff): Vercel-managed orgs are not
supported by Neon's self-serve project transfer. Paths, in order: check the
transfer button anyway (30 seconds, section B), dump/restore cutover
(primary, section C), Neon support ticket (parallel/backup, section D),
emergency plan upgrade (stopgap, section E).

## Non-Negotiables

- Do not print connection strings, tokens, or secrets while working through
  this.
- Do not delete or disconnect anything under Vercel -> Storage until the
  cutover is verified and a rollback window (>= 1 week) has passed. Deleting
  the marketplace resource deletes the database. The old org is free-plan,
  so it costs nothing while it waits as rollback.
- Production is live. No `db push`, `migrate dev`, or `migrate reset` at any
  point in this runbook.
- Keep the cutover window short and off the top of the hour (Vercel crons
  fire at :00 and :05; Google Sheets sync at :25).

## A. Pre-Checks

1. **Identify the production branch.** The project has 4 branches; the
   2026-06-23 cutover put production on branch `production-company-brain`
   (database `derya_production`). Confirm by matching the `ep-...` endpoint
   host in Vercel's Production `DATABASE_URL` against the branch's compute
   endpoint in the Neon console. All dump commands run against THAT branch's
   direct (unpooled) URL.
2. **Postgres version:** old project -> Settings; the new project must match
   the major version (same-major dump/restore is the safe path).
3. **Vercel env vars:** Vercel -> project -> Settings -> Environment
   Variables. Production `DATABASE_URL` / `DATABASE_URL_UNPOOLED` are
   expected to be plain, manually-set values (the cutover runbook set them by
   hand and the Neon project shows no integrations). If they are instead
   tagged as synced from a storage integration, plan to add plain
   replacements rather than editing in place.
4. **Credited org ready:** Neon -> Derya org: Launch plan, $100k balance.
   Projects created here bill against the credits.

## B. 30-Second Check: Transfer Button / API

Neon docs say Vercel-managed orgs cannot use self-serve transfer, but the
check is free, and the documented API failure mode (422) is about
project-level integrations — which this project does not have.

- Console: old org -> `neon-champagne-cable` -> Settings -> look for
  **Transfer**. (The old org's settings page has no "Transfer projects"
  section, unlike regular orgs.)
- API (definitive; an error is a no-op, transfers are atomic): needs a
  **personal** API key (account-level, spans both orgs — not an org key),
  the source org ID (`org-plain-darkness-21549314`), the destination org ID
  (Derya -> Settings -> Organization ID), and the project ID (project ->
  Settings -> General):

  ```bash
  curl -sS -X POST \
    "https://console.neon.tech/api/v2/organizations/org-plain-darkness-21549314/projects/transfer" \
    -H "Authorization: Bearer $NEON_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"project_ids": ["<PROJECT_ID>"], "destination_org_id": "<DERYA_ORG_ID>"}'
  ```

  - `200` + `{}`: transferred. Connection strings preserved; verify per
    section F and leave the Vercel -> Storage entry alone (it may show a
    dangling reference; do not delete it yet).
  - `422`: blocked by an attached GitHub/Vercel integration.
  - `406`: destination plan/limit problem.
  - Any error: nothing changed; continue with section C.

If the transfer succeeds, nothing else in this runbook is needed except
section F verification. Otherwise continue.

## C. Primary Path: Dump/Restore Into The Credited Org (~30 Min Window)

1. **Create the target project** (any time before the window): Neon console
   -> Derya org -> Create project. Region **AWS US East 1 (N. Virginia)**,
   same Postgres major version as the old project. Copy the pooled and
   direct (unpooled) connection strings.
2. **Rehearse (optional but cheap at 191 MB):** run the dump/restore below
   into the new project without freezing anything; point a local dev server
   at it and confirm the app boots and lists real data. Reset/recreate the
   target database before the real run — the final restore must land on an
   empty database.
3. **Cutover window** (quiet hour, nobody working, avoid :00/:05/:25):
   - Dump from the OLD production branch's direct URL, restore to the NEW
     project's direct URL (client tools must match the server major version;
     `brew install libpq` or `postgresql@<version>`):

     ```bash
     pg_dump -Fc -v -d "$OLD_DIRECT_URL" -f derya_prod.dump
     pg_restore -v -d "$NEW_DIRECT_URL" --no-owner --no-privileges derya_prod.dump
     ```

     A full dump carries schema, data, sequences, and the
     `_prisma_migrations` table, so migration history stays intact. At
     ~191 MB this is minutes.
   - Sanity checks against the new direct URL:

     ```bash
     npx prisma migrate status   # expect: schema up to date, no pending
     ```

     Spot-check row counts on User, Office, Customer, Load, Quote,
     EmailMessage against the old DB.
   - Swap Vercel Production env vars `DATABASE_URL` (new pooled) and
     `DATABASE_URL_UNPOOLED` (new direct), per the A.3 finding. Redeploy
     production.
   - Smoke test per section F.
   - Writes made to the old DB between dump and redeploy are lost — that is
     why the window is quiet and short. Gmail sync self-heals by re-syncing
     from its stored watermark.
4. **Rollback:** if the smoke test fails, swap the env vars back and
   redeploy. The old database is untouched.
5. **Decommission (>= 1 week later):** after a clean week on the new DB,
   remove the Vercel Marketplace Neon resource. This is the step that
   deletes the old database — do not do it early.

## D. Parallel/Backup: Neon Support Ticket

Costs five minutes; worth filing even if the cutover proceeds, in case they
offer a cleaner transfer.

- Neon console -> Derya org -> top-right `?` -> Contact support (Launch plan
  includes support), or `console.neon.tech/app/support`.
- Ask: transfer project `neon-champagne-cable` (`<project ID>`) from the
  Vercel-managed org `Vercel: mert's projects` into org `Derya` (holds YC
  startup credits), or alternatively apply the credits to the Vercel-managed
  org. Mention the Free-plan limit warning and ask whether connection
  strings would be preserved.

## E. Emergency Stopgap: Upgrade The Old Org

Only if the Free-plan limit is about to hit before the cutover can happen:
upgrade the Vercel-managed org to a paid plan (billing goes through
Vercel — the Upgrade button in the Neon console routes accordingly). Real
money, so treat it as insurance for a few days, downgrade/decommission after
the cutover.

## F. Post-Migration Verification

- `https://www.derya.ai/api/health` returns `ok=true` with the DB ping
  passing.
- Login works; dashboard/customers/jobs/inbox pages show real data.
- Unauthenticated `/api/cron/*` returns `401`.
- Sessions, Gmail OAuth, and portal links are DB rows — after a full copy
  they keep working; after a support-side transfer nothing changes at all.
- Derya org -> Billing: "Total charges to date" starts accruing and debits
  the credit balance.
- Old org: project compute goes idle (no new CU-hrs accruing).

## G. After Migration: Spending The Credits Deliberately

Credits expire 12 months after approval and are use-it-or-lose-it. Current
usage is far below $100k/year, so treat the credits as room to buy
reliability and development speed, not as something to conserve:

1. Turn off scale-to-zero on the production compute (kills cold starts) —
   also removes the very failure mode the Free plan was about to cause.
2. Raise the autoscaling max CU so heavy pages and cron bursts never throttle.
3. Extend the restore window (PITR history retention) to the plan maximum —
   cheap insurance for a production CRM.
4. Create a persistent staging branch from production (copy-on-write) and
   rehearse every `prisma migrate deploy` there before production. This
   directly de-risks the manual-migration-before-deploy constraint.
5. Optionally add Neon's Vercel integration from the Derya org for a database
   branch per preview deployment — only after production lives in Derya.

Set a monthly reminder to glance at the billing page, and around month 10
right-size compute/retention back to a sustainable configuration so the
first post-credit invoice is not a surprise.
