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
npm run world:load -- load --source epa_frs --file ./data/STATE_SINGLE.CSV
npm run world:load -- load --source eu_industrial_emissions --file ./data/F1_4_Air_Releases_Facilities.csv
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
- EPA Facility Registry Service, national single-file ZIP at https://ordsext.epa.gov/FLA/www3/state_files/national_single.zip and download page at https://www.epa.gov/frs/epa-frs-facilities-state-single-file-csv-download. The CSV headers include `REGISTRY_ID`, `PRIMARY_NAME`, `LOCATION_ADDRESS`, `CITY_NAME`, `STATE_CODE`, `POSTAL_CODE`, `NAICS_CODES`, and `SIC_CODES`. A state archive sample was used for parser preparation, not the 349,469,314-byte national archive.
- EEA Industrial Reporting database, portal at https://industry.eea.europa.eu/download and current SDI share at https://sdi.eea.europa.eu/datashare/s/AnfiqFkZYBSq36B/download. The current user-friendly CSV archive is https://sdi.eea.europa.eu/datashare/public.php/dav/files/AnfiqFkZYBSq36B/User%20friendly%20.csv%20files.zip, 147,626,010 bytes. The facility export headers include `PublicationDate`, `countryName`, `reportingYear`, `EPRTR_SectorCode`, `EPRTR_SectorName`, `EPRTRAnnexIMainActivity`, `FacilityInspireId`, `facilityName`, and `city`; the installation export includes `InstallationInspireId`, `installationName`, `City_of_Facility`, and `IEDAnnexIMainActivity`. The parser classifies E-PRTR sectors 2, 3, 4, 6, 8, and 9, and IED chapters 2, 3, 4, and 6 as manufacturer activities. The export does not expose postal or street columns in these facility files, so those fields remain null when absent. Only bounded byte samples were inspected, not the full archive.

Source rows keep their raw payload and normalized fields. Facility sources are never name-matched because facility names are not company identities. EEA rows are aggregated per facility before insertion, retaining bounded metadata such as the first and latest rows, row count, years, pollutants, activities, and source files. The complete raw rows remain in the downloaded archive under `world-data`; loading with `--limit` can produce partial facilities, so a refresh or upsert is the shared follow-up before treating the data as complete. Other merge matching uses LEI first, then registrable domain, then country plus normalized company name. Manufacturer status is an OR across source evidence.

When a matched source record supplies a missing LEI or domain, the value is filled only if it is unique across the current match batch and is not already owned by another company. Conflicting identifiers never replace an existing company value.
