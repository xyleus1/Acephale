# Gmail account setup

`/dashboard/settings/email` is the administrator surface for connected Gmail
accounts. It stores each account under the authenticated Office, monitors
inbound mail, and controls which accounts may send through Derya.

## Account states

- Connected: OAuth tokens or an encrypted Gmail app password exist and
  monitoring can run.
- Paused: monitoring is stopped, the account cannot send, and its messages are
  hidden from the active Inbox. Existing records are retained.
- Sending enabled: approved Derya send paths may use the account.
- Default sender: the first-choice account for system email paths that do not
  already bind an exact conversation account.

Connecting Gmail does not enable sending automatically. An administrator must
enable sending and may then choose one default sender. Existing connected Gmail
accounts are enabled during the migration so current delivery behavior does not
silently break.

## Google Cloud configuration

1. Create or select a Google Cloud project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen.
4. Add the Gmail accounts as test users while the application remains
   unverified.
5. Create a Web application OAuth client.
6. Register the exact callback URLs used by each environment, for example:

```text
https://app.derya.ai/api/auth/gmail/callback
http://localhost:3000/api/auth/gmail/callback
```

The consent screen must allow these scopes:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/userinfo.email
```

## Server configuration

Set these server-only variables in the deployment environment:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
TOKEN_ENCRYPTION_KEY
```

`GOOGLE_REDIRECT_URI` must match the registered callback exactly.
`TOKEN_ENCRYPTION_KEY` protects stored OAuth tokens and app passwords. Do not use a
`NEXT_PUBLIC_` variable for any credential.

Redeploy after changing environment variables.

## Gmail app-password accounts

Use this path when the mailbox has a Google app password but cannot complete
OAuth.

1. Revoke any password that was shared in chat, a ticket, or source control.
2. Generate a fresh 16-character Gmail app password.
3. Open `/dashboard/settings/email` as an `ADMIN` user.
4. Enter the display name, email, and fresh app password under **Gmail app
   password**.
5. Select **Verify and add**. Derya checks both sending and monitoring before
   storing the encrypted password.
6. Select **Enable sending**, **Send test**, and **Sync now**.

The Gmail endpoints are fixed to `smtp.gmail.com:587` with required STARTTLS
and `imap.gmail.com:993` with TLS. Administrators cannot provide an arbitrary
mail host.

## Connect and verify an account

1. Sign in as an active Office user whose operational role is `ADMIN`.
2. Open `/dashboard/settings/email`.
3. Select **Connect Gmail** and complete Google consent.
4. Select **Sync now** to verify monitoring and queue bounded backfill work.
5. Select **Enable sending** only if the account is approved for outbound use.
6. Select **Make default** if system email should prefer this account.
7. Use **Send test**. The test recipient is the signed-in administrator, not a
   browser-supplied address.

The settings page shows message counts, last inbound and outbound activity,
last sync time, monitoring state, sending state, and the default sender.

## Automation boundary

Derya owns Gmail authorization, encrypted tokens, account policy, message sync,
and the local email ledger. Bourne owns sourcing campaigns, supplier selection,
campaign scheduling, and approval state.

The legacy RFQ SMTP fallback also requires its matching Gmail account to be
connected, monitored, and enabled here. SMTP credentials alone cannot bypass
the administrator sending switch or reply-monitoring requirement.

Login codes are the deliberate exception. They prefer an enabled Office Gmail
account, but may use the server-only RFQ SMTP bootstrap when no usable account
exists. This prevents the account settings dependency from locking every
operator out of the application.

Do not copy Gmail refresh tokens into Bourne. A future Bourne delivery bridge
must use an authenticated server-to-server request, a Derya account reference,
an exact approved message, a tenant binding, and an idempotency key. Until that
contract exists, connecting or enabling an account in Derya does not authorize
Bourne to send a campaign.

## Troubleshooting

| Symptom | Correction |
| --- | --- |
| `redirect_uri_mismatch` | Match the Google Cloud callback and `GOOGLE_REDIRECT_URI` exactly. |
| Google blocks the account | Add the account as an OAuth test user or complete app verification. |
| `state_mismatch` | Restart the connection from the authenticated settings page. |
| Send permission error | Reconnect the account so Google grants `gmail.send`. |
| No refresh token | Reconnect with the Google consent prompt. |
| Sync returns zero | Send a new message or inspect the last sync time. Existing Gmail message IDs are deduplicated. |
| Sending disabled | An administrator must enable the account after connection. |
| App password rejected | Revoke it, generate a fresh Gmail app password, and verify that IMAP access is allowed for the Workspace account. |
