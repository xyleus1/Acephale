# Gmail OAuth Token Encryption Runbook

H1 stores Gmail OAuth tokens encrypted at rest with AES-256-GCM.

## Required Secret

```bash
TOKEN_ENCRYPTION_KEY=""
```

Generate it with:

```bash
openssl rand -base64 32
```

Back it up in the production secret manager. If this key is lost, encrypted
OAuth tokens cannot be recovered.

## Existing Plaintext Tokens

Existing `EmailAccount.accessToken` and `EmailAccount.refreshToken` values may
already be plaintext from older builds.

Current compatibility behavior:

- Values prefixed with `enc:v1:` are decrypted with `TOKEN_ENCRYPTION_KEY`.
- Values without `enc:v1:` are treated as legacy plaintext.
- A legacy plaintext refresh token can still be used for Gmail sync/send.
- After a successful refresh, the new access token is stored encrypted.
- If the refresh token was legacy plaintext, it is re-stored encrypted after
  the successful refresh.

There is no bulk token migration script yet. That is intentional. Bulk scripts
touch secrets and are easy to make stupid. Let normal refresh encrypt legacy
rows unless production compliance requires immediate migration.

## Missing Key Behavior

If a token write/decrypt needs the key and it is missing, the error is:

```text
TOKEN_ENCRYPTION_KEY is required to encrypt or decrypt OAuth tokens. Generate one with: openssl rand -base64 32
```

If a Gmail account has no refresh token, the error is:

```text
Account has no refresh token (re-connect needed)
```

## Verification

Run:

```bash
npm run test:security
npx tsc --noEmit
```

The security smoke test covers:

- encrypted token decrypts
- missing key fails safely
- legacy plaintext read fallback is explicit
- legacy plaintext refresh token is re-encrypted after a mocked refresh
- account without tokens returns a reconnect error
- token values are not printed in test output
