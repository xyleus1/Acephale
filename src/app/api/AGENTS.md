# API Route Guidance

- Validate inputs at API boundaries before touching domain logic or external services.
- Preserve auth and tenant boundaries. Never trust request-provided `officeId` without session or integration validation.
- Do not log secrets, tokens, OAuth codes, webhook signatures, or raw credentials.
- Keep webhooks and sync endpoints idempotent. Retries should not duplicate customer records, jobs, memory objects, or outbound messages.
- Treat customer-facing and supplier-facing sends as risky side effects. Preserve review gates unless explicitly changed.
- Return concise errors; keep sensitive implementation details out of API responses.
