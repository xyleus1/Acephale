# Google Sheets sync

The app can now pull the current tracking sheet into the product.

Default spreadsheet:

```text
1CFmfSdFJKOCThss5xzglHb5GihPRlK3pRxLCmpuFUHg
```

Default tabs:

- `06/2026 Talepler`: imported as RFQs / inquiries
- `Operasyonlar`: imported as Jobs with customer, route, mode, purchase cost, sales price, margin context, and status

## Runtime configuration

```bash
DERYA_GOOGLE_SHEET_ID="1CFmfSdFJKOCThss5xzglHb5GihPRlK3pRxLCmpuFUHg"
DERYA_GOOGLE_SHEET_REQUESTS_TAB="06/2026 Talepler"
DERYA_GOOGLE_SHEET_OPERATIONS_TAB="Operasyonlar"
DERYA_GOOGLE_SHEET_REQUESTS_GID="0"
DERYA_GOOGLE_SHEET_OPERATIONS_GID="883687961"
DERYA_GOOGLE_SHEET_OFFICE_ID=""
```

For private sheets, use a Google service account and share the sheet with that service-account email:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL="sync-account@project.iam.gserviceaccount.com"
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

For public/readable sheets, `GOOGLE_SHEETS_API_KEY` can be used instead. If no Google API credentials exist, the app falls back to CSV export by `gid`, which only works when the sheet is publicly readable.

## Manual sync

From the app:

```text
Dashboard -> Email & WhatsApp -> Google Sheet source -> Sync Google Sheet
```

Via API as a logged-in user:

```bash
curl -X POST http://localhost:3000/api/google-sheets/sync \
  -b "crm_session=YOUR_SESSION_COOKIE"
```

Via cron:

```bash
curl "https://YOUR_DOMAIN/api/google-sheets/sync?secret=$CRON_SECRET"
```
