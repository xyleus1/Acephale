# Email connection setup (Gmail)

Step-by-step to wire up real Gmail OAuth so the app can pull inbound mail and AI-classify it per load.

## What you'll get

Once set up, on `/dashboard/settings/email` you can:
- Click **"Connect a Gmail inbox"** to authorize any number of Gmail accounts (one at a time)
- Click **"Sync now"** on any connected inbox to fetch the last 7 days of mail
- Inbound emails are classified by AI:
  - **RFQ** → creates a new `Inquiry` record with parsed origin/destination/mode/etc.
  - **Carrier reply** → updates the matching `CarrierQuote` with rate, transit, validity
  - **Customer reply** → attaches to the matching job's email thread
  - **Other** → stored as a plain `EmailMessage` for record
- All messages threaded by `In-Reply-To` / `References` headers, fallback to subject match

## What you need to do (10 minutes)

### 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com>
2. Create a new project (or use an existing one). Top-left dropdown → **New Project** → name it `Derya Freight OS`.

### 2. Enable the Gmail API

1. In the project, go to **APIs & Services → Library**
2. Search for **Gmail API**, click it, click **Enable**

### 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** (unless you're on Workspace; then Internal is fine and skips the verification step)
3. Fill in:
   - App name: `Derya Freight OS` (or whatever)
   - User support email: your email
   - Developer contact: your email
4. **Scopes** → Add or remove scopes → check:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
5. **Test users** → add the Gmail addresses you'll use to connect (until the app is verified, only test users can authorize). For demo, add your own + any team emails you'll connect.

### 4. Create OAuth 2.0 credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `Derya OAuth`
4. **Authorized redirect URIs** — add **both** of these (exactly):
   - `https://app.derya.ai/api/auth/gmail/callback`
   - `http://localhost:3000/api/auth/gmail/callback` *(for local dev)*
5. Click **Create**. A modal pops up with the **Client ID** and **Client Secret** — copy both.

### 5. Add env vars to Vercel

In **Vercel project → Settings → Environment Variables**, add (Production + Preview scope):

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 4 |
| `GOOGLE_CLIENT_SECRET` | the Client Secret from step 4 |
| `GOOGLE_REDIRECT_URI` | `https://app.derya.ai/api/auth/gmail/callback` |

> **Important:** The `GOOGLE_REDIRECT_URI` value must match **exactly** what you put in step 4's "Authorized redirect URIs" — same protocol, host, path. A trailing slash mismatch will fail.

For local dev (optional), put the same in your local `.env`:
```
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/gmail/callback"
```

### 6. Redeploy

Vercel project → Deployments → **Redeploy** the latest. Env var changes don't apply to existing deployments.

### 7. Connect your first inbox

1. Go to `https://app.derya.ai/dashboard/settings/email`
2. Click **"Connect a Gmail inbox"**
3. Google asks you to choose an account → choose, click through consent
4. You'll be redirected back with a green confirmation banner
5. Click **"Sync now"** — first sync grabs the last 7 days
6. Check `/dashboard` and `/dashboard/rfq` — new RFQs and threads should appear

### 8. Connect a second (third, fourth...) inbox

Same flow. Each authorization creates a separate `EmailAccount` record. When the consent screen shows, you can switch Google accounts via "Use another account".

## Costs

- **Google Cloud / Gmail API:** free for the volumes any single forwarding office will hit
- **OpenAI GPT-5.6 classifier:** usage depends on input, output, and reasoning tokens. Check current OpenAI pricing before estimating production sync cost.

## Limitations of the current MVP

- **No automatic background sync yet** — you click "Sync now" manually. Cron job is on the roadmap.
- **Read-only** — we don't send via the connected account yet. Outbound emails are still logged to `EmailMessage` only. Adding `gmail.send` scope + send button is a small follow-up.
- **No attachment handling** — message bodies only. PDFs / docs ignored. (Document drag-drop classifier is on the ideas list.)
- **Outlook / IMAP** — not yet implemented. Gmail only for now.
- **Unverified app limit** — Google caps unverified OAuth apps to 100 users. Fine for any forwarder; if you need to scale further, submit for verification (takes a week, free).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "redirect_uri_mismatch" | Check the URI in Google Cloud (step 4) matches `GOOGLE_REDIRECT_URI` env var exactly |
| "Access blocked: this app is not verified" | Add yourself as a Test User in step 3 |
| `OAuth error: state_mismatch` after callback | Cookies blocked or session expired — retry |
| Sync returns "0 new" | The account already has those messages (de-duped by Gmail message-id). Send yourself a new test email and try again |
| `Gmail list failed: 401` | Token refresh failed — disconnect and reconnect the account |
