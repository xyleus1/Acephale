# WhatsApp Cloud API setup

This app now has a real Meta WhatsApp Cloud API integration surface:

- Webhook verification and inbound ingest: `/api/webhooks/whatsapp`
- Session-protected outbound text send: `POST /api/whatsapp/send`
- Inbound WhatsApp text messages are stored as inbox threads, classified, and auto-linked or promoted to RFQs when possible. The auto-inquiry extractor is WhatsApp-aware (Turkish trucking defaults, ROAD/TRY hints) and seeds the lead's phone number from the sender, so the RFQ sheet's WhatsApp draft gets a recipient automatically.
- RFQ sheet: the Turkish WhatsApp inquiry draft has a Send button that delivers through the CRM number and logs into the matching inbox thread (`sendWhatsAppInquiryAction`; sent state stamped as `parsedData.whatsappSentAt`).
- Inbox: "AI reply" on a WhatsApp thread drafts a WhatsApp-shaped reply (short, Turkish); Send in the draft modal routes through the CRM number instead of Gmail. Drafts-first — nothing sends without the operator clicking Send.
- Optional auto-read receipts (blue ticks) on inbound messages during webhook ingest.

## Environment

Set these values in the runtime environment:

```bash
WHATSAPP_VERIFY_TOKEN="a-random-string-you-also-enter-in-meta"
WHATSAPP_APP_SECRET="meta-app-secret"
WHATSAPP_ACCESS_TOKEN="permanent-or-system-user-access-token"
WHATSAPP_PHONE_NUMBER_ID="meta-phone-number-id"
WHATSAPP_GRAPH_API_VERSION="v23.0"
WHATSAPP_OFFICE_ID="office-id-if-you-have-more-than-one-office"

# Outbound sending is fail-closed: without this flag every send path
# (API route, RFQ sheet button, inbox reply modal) returns an error.
WHATSAPP_SEND_ENABLED="true"

# Opt-in: mark inbound messages as read (blue ticks) during webhook ingest.
WHATSAPP_AUTO_READ_ENABLED="true"
```

`WHATSAPP_APP_SECRET` is optional for local testing but should be set in production so webhook POST bodies are checked against `X-Hub-Signature-256`.

## Provider mode: Green API (no Meta account required)

Until Meta Cloud API credentials exist, the same pipeline can run through
[Green API](https://green-api.com) — a hosted WhatsApp gateway paired to the
business number by QR scan (unofficial WhatsApp Web protocol; keep sending
volumes human-ish). Everything downstream (inbox, classification, auto-RFQ,
RFQ-sheet send, inbox AI replies, auto-read) is identical; moving to the
official API later is an env-var swap.

```bash
WHATSAPP_PROVIDER="greenapi"
GREEN_API_ID_INSTANCE="7103xxxxxx"          # from console.green-api.com
GREEN_API_TOKEN="instance-api-token"
GREEN_API_BASE_URL="https://7103.api.greenapi.com"  # instance apiUrl; defaults to api.green-api.com
GREEN_API_WEBHOOK_TOKEN="a-random-shared-secret"
WHATSAPP_PHONE_NUMBER_ID="905xxxxxxxxx"     # the business number's digits — keys threads/accounts
WHATSAPP_SEND_ENABLED="true"
WHATSAPP_AUTO_READ_ENABLED="true"
# WHATSAPP_ACCESS_TOKEN / WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN not used in this mode
```

Inbound arrives on the adapter route `/api/webhooks/whatsapp/greenapi`
(authenticated by `GREEN_API_WEBHOOK_TOKEN` in the `Authorization` header and
translated into the Meta webhook shape). Point the instance at it once with:

```bash
GREEN_API_ID_INSTANCE=... GREEN_API_TOKEN=... GREEN_API_WEBHOOK_TOKEN=... \
WEBHOOK_URL=https://YOUR_DOMAIN/api/webhooks/whatsapp/greenapi \
npm run setup:green-api
```

Notes: Green API's free Developer plan covers 3 chats (enough to test
end-to-end); the Business plan lifts limits on the same instance with no code
change. Group chats are ignored by the adapter. The number can stay paired to
the phone app and other linked devices at the same time.

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
