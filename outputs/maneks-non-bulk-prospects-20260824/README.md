# MANEKS non-bulk buyer research

This folder contains a research-only prospect list for MANEKS DIS TICARET LIMITED SIRKETI.

## Delivery

- `maneks-non-bulk-prospects.csv`: 318 rows, 318 unique domains, and all 33 requested countries.
- `queries.txt`: the 32 public web queries run and the source method.
- `validation.json`: machine-readable validation counts and the verification boundary.
- `build-maneks-prospects.mjs`: generation and provenance script. It requires the adjacent public-source inventory named below, which is not included in this delivery folder.
- `validate-maneks-prospects.mjs`: structural validator.

The CSV uses the exact requested 18-column header. It is ready for upload at `/dashboard/research/maneks-prospects`.

## Evidence and confidence

- 80 rows were researched from public pages during this run.
- 238 rows reuse public-source evidence retrieved between 2026-08-16 and 2026-08-18 from first-party company sites and official association, chamber, exhibitor, industrial-zone, or government directories.
- Every row has one to three HTTP(S) evidence URLs.
- Existing-inventory rows leave all contact fields blank. Public emails and phone numbers appear only where they were manually transcribed from a public page returned during this run.
- For existing-inventory rows, `what_they_buy` is a buyer-fit inference from the published manufacturing capability, not a confirmed purchase record. Each such row says this in `notes` and should be qualified before outreach.

The web tool re-requested a 20-source directory sample. Sixteen returned current public content. ABIFA returned a server error, Madayn and APF returned fetch errors, and ACAROM returned a challenge page through the tool. Those affected rows still include a first-party company website and evidence recorded as reachable in the recent public-source inventory. The shell sandbox could not resolve external DNS, so all 318 URLs were not re-requested with `curl`.

## Safety boundary

No company was contacted. No form was submitted. No email, call, or message was sent. Russia, Venezuela, and Ukraine rows include sanctions, counterparty, or logistics-screening notes where applicable.

## Rebuild and validate

Validation is standalone:

```sh
node outputs/maneks-non-bulk-prospects-20260824/validate-maneks-prospects.mjs
```

Regeneration also requires `outputs/bourne-sourcing-upload-20260822/bourne-procurement-sources-net-new-9802.csv`:

```sh
node outputs/maneks-non-bulk-prospects-20260824/build-maneks-prospects.mjs
```
