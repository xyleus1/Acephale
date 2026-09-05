# World company data

The world company spine is an office-less dataset in a separate Postgres database. Set `WORLD_DATABASE_URL` before running the loader. It never writes rows to the office-scoped CRM `Company` table.

## Run

1. Download a source file and unzip it first. GLEIF and Companies House distribute ZIP archives, and the loader intentionally does not read ZIP files directly.
2. Apply the world migration:

```bash
npm run db:world:migrate
```

3. Load a CSV, gzipped CSV, or PDL JSONL file:

```bash
npm run world:load -- load --source gleif --file ./data/gleif.csv
npm run world:load -- load --source companies_house --file ./data/BasicCompanyDataAsOneFile.csv
npm run world:load -- load --source pdl_free --file ./data/companies.jsonl
```

Use `--limit N` for a bounded run and `--batch N` to tune write batches. Loading the same file again is idempotent.

4. Merge source records into the global company spine:

```bash
npm run world:load -- merge
npm run world:load -- stats
npm run world:load -- urls
```

## Sources

- GLEIF Level 1 Golden Copy, latest file list at https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest. GLEIF data is available under CC0. GLEIF provides legal entity identity and address data, not industry codes.
- Companies House Basic Company Data, download page at http://download.companieshouse.gov.uk/en_output.html. The data is published under the UK Open Government Licence v3.0.
- People Data Labs free company dataset, information at https://www.peopledatalabs.com/free-dataset. It uses the PDL free-dataset licence. Check the current licence before redistribution.

Source rows keep their raw payload and normalized fields. Merge matching uses LEI first, then registrable domain, then country plus normalized company name. Manufacturer status is an OR across source evidence.

When a matched source record supplies a missing LEI or domain, the value is filled only if it is unique across the current match batch and is not already owned by another company. Conflicting identifiers never replace an existing company value.
