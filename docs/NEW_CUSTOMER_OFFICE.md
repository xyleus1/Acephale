# Opening A New Customer Office

Recipe for starting a customer with context instead of a blank office. Maneks
(`cmt7r9u7g0000qhis751x6khz`) is the reference implementation.

## 1. Write the customer profile

Add a profile next to `MANEKS_PROFILE` in `src/lib/leadgen/profile.ts`:

- `slug`, `companyName`, `homepage`
- `buyerSegments`: who the customer wants to sell to, with the Turkish and
  English keywords each segment is searched by
- `regions`: the cities or provinces to sweep
- `positiveSignals` / `negativeSignals`: page vocabulary that qualifies or
  disqualifies a company
- `directorySeeds`: chamber, OSB and association member lists worth expanding

Everything downstream (queries, scoring, persistence tags) is derived from the
profile, so a new customer needs a profile plus configuration, not new pipeline
code.

The leadgen runner selects profiles with `--profile <slug>`. The registry in
`src/lib/leadgen/registry.ts` currently exposes the profiles `maneks`,
`maneks-corridor`, `wens`, and `feast`; it rejects unknown slugs before a run
starts. For example:

```bash
npx tsx scripts/leadgen-run.ts plan --profile wens --limit 900 --out .leadgen/wens-queries.txt
```

The default profile remains `maneks` for regular commands. `corridor-plan` and
`corridor-harvest` default to `maneks-corridor` unless another profile is
provided.

## 2. Create the office

### Create an office in the app

An allowlisted platform operator with an `ADMIN` session can create an office
from the Supply OS company index at `/dashboard/supply-os`. The `New office`
action is hidden from customer sessions, preview sessions, managers, and
non-allowlisted accounts.

The form asks for:

- Office name
- Optional customer login username
- Optional customer login password, at least 12 characters when supplied

The acting operator is added as an admin in the new office, so it appears in
the office switcher immediately. The optional username creates a second admin
using the reserved customer login identity. The in-app form refuses an office
name that already exists. The direct script and GitHub Actions workflow remain
idempotent and reuse existing records.

### Shell operations fallback

When no browser session or local database URL is available, an operator can
call the deployed app:

- `POST /api/ops/offices` creates an office. It requires an allowlisted operator
  email and accepts office, optional customer login, company, and workspace
  inputs.
- `POST /api/ops/research/import` creates a research list when needed and
  imports rows for an existing office resolved by office name. Existing list
  definitions are left unchanged. Every import must include a `dedupeField`
  matching a list field so retries do not create duplicates.

Both endpoints require the `Authorization: Bearer <OPS_PROVISIONING_SECRET>`
header. Configure `OPS_PROVISIONING_SECRET` with at least 32 characters in the
Vercel Production environment. Keep the token out of shell history, logs, and
repository files. The in-app `New office` button remains the primary route for
human operators. The office endpoint limits office names to 80 characters,
operator emails to 200, company and workspace names to 160, and workspace
external keys to 120. Research imports limit office names to 80, list names to
160, slugs to 80, descriptions to 1000, dedupe fields to 80, and request
payloads to 4,000,000 bytes.

### Direct script fallback

```bash
DATABASE_URL="$DERYA_PROD_DATABASE_URL" \
ALLOW_PRODUCTION_OFFICE_SEED=1 \
PRODUCTION_OFFICE_NAME="Customer" \
PRODUCTION_ADMIN_USERNAME="customer" \
PRODUCTION_ADMIN_PASSWORD="<generated>" \
PRODUCTION_COMPANY_NAME="Customer Legal Name" \
PRODUCTION_WORKSPACE_NAME="Customer Expansion" \
PRODUCTION_WORKSPACE_EXTERNAL_KEY="customer:primary" \
npx tsx scripts/create-production-office.ts
```

Use `PRODUCTION_ADMIN_USERNAME` rather than `PRODUCTION_ADMIN_EMAIL` for
customer offices: the username maps to a reserved `@office.derya.invalid`
identity, so an operator email is never tied to two offices and email-code login
cannot resolve into the wrong tenant. The customer signs in with the username
and the password on the same form; the code flow rejects reserved identities.

### GitHub Actions fallback

Use the `Create production office` workflow in GitHub Actions when the
in-app route is unavailable or a local production database URL is not available.
Dispatch it from `main`, select the `Production` environment, enter the office
and admin inputs, and type the exact confirmation phrase `create production
office`. The workflow checks the pinned Neon host and database role before
running `scripts/create-production-office.ts`.

The admin password is read from the `PRODUCTION_ADMIN_PASSWORD` secret on the
`Production` environment. Add or rotate that secret in GitHub rather than
putting it in a shell command or repository file. The workflow writes the
script result to the run summary and keeps the idempotent behavior of the
existing script.

## 3. Harvest, verify, load

```bash
npm run leadgen -- plan --limit 900 --out .leadgen/queries.txt
npm run leadgen -- directory --urls .leadgen/directories.txt --out .leadgen/directory-targets.txt
npm run leadgen -- harvest --urls .leadgen/harvest-urls.txt --out .leadgen/candidates.jsonl --concurrency 12
npm run leadgen -- verify --in .leadgen/candidates.jsonl --out .leadgen/verified.jsonl
DATABASE_URL="$DERYA_PROD_DATABASE_URL" npm run leadgen -- load --in .leadgen/verified.jsonl --office-id <officeId>
```

Search result collection runs through the browser helpers rather than a paid
SERP API. Harvest fetches go through the egress guard in
`src/lib/leadgen/fetch-guard.ts`, which validates every hop at connect time.

## 4. Human review before any outreach

`load` only writes companies and contacts and tags them with the campaign; it
never enqueues or sends anything. Outreach starts only after the customer has
reviewed the list.
