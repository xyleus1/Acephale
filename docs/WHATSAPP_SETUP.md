# WhatsApp Cloud API setup

This app now has a real Meta WhatsApp Cloud API integration surface:

- Webhook verification and inbound ingest: `/api/webhooks/whatsapp`
- Session-protected outbound text send: `POST /api/whatsapp/send`
- Inbound WhatsApp text messages are stored as inbox threads, classified, and auto-linked or promoted to RFQs when possible.

## Environment

Set these values in the runtime environment:

```bash
WHATSAPP_VERIFY_TOKEN="a-random-string-you-also-enter-in-meta"
WHATSAPP_APP_SECRET="meta-app-secret"
WHATSAPP_ACCESS_TOKEN="permanent-or-system-user-access-token"
WHATSAPP_PHONE_NUMBER_ID="meta-phone-number-id"
WHATSAPP_GRAPH_API_VERSION="v23.0"
WHATSAPP_OFFICE_ID="office-id-if-you-have-more-than-one-office"
```

`WHATSAPP_APP_SECRET` is optional for local testing but should be set in production so webhook POST bodies are checked against `X-Hub-Signature-256`.

## Meta callback

Use this callback URL in Meta after the app is public:

```text
https://YOUR_DOMAIN/api/webhooks/whatsapp
```

For local testing, expose port 3000 through a tunnel and use the tunnel URL. `localhost` will not work as a Meta callback.

## Outbound test

After setting `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`, a logged-in app user can send:

```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -b "crm_session=YOUR_SESSION_COOKIE" \
  -d '{"to":"+905xxxxxxxxx","body":"Test from Derya Freight Desk"}'
```

The API logs the outbound message into the matching WhatsApp inbox thread.
