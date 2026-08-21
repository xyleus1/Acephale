# Bourne procurement reliability handoff

Implement this against the existing procurement workflow. Reuse equivalent
columns and constraints when they already exist. Do not create a parallel order
or supplier workflow.

## Required behavior

1. Treat the committed `orders` row as the queue. The Derya webhook only requests
   immediate pickup.
2. Keep a one-minute schedule that scans eligible `new` orders even when no
   webhook arrives.
3. Claim each order atomically. Only one worker may own an order at a time.
4. Use a five-minute lease with a heartbeat. An expired lease makes unfinished
   work eligible for another attempt.
5. Retry infrastructure failures with bounded exponential backoff. Keep the
   order retryable and record a stable error code.
6. Use `needs_attention` only for missing, conflicting, or invalid procurement
   input that an operator can correct.
7. Make supplier research, supplier email, quote ingestion, and every other
   external side effect idempotent by order, supplier, and workflow step.
8. A webhook response may return success only after the request has been
   durably observed or claimed. Repeated webhook events for the same order must
   be harmless.

## Minimum workflow fields

Use existing equivalents if available:

- `attempt_count`
- `next_attempt_at`
- `lease_until`
- `worker_run_id`
- `last_error_code`
- `last_error_at`
- `started_at`
- `completed_at`

Do not add these fields to Derya's Prisma schema. They belong to the
Bourne-owned lowercase workflow schema.

## Claim shape

The exact names may differ, but the transition must have these semantics:

```sql
WITH candidate AS (
  SELECT id
  FROM orders
  WHERE status = 'new'
    AND COALESCE(next_attempt_at, now()) <= now()
    AND (lease_until IS NULL OR lease_until < now())
  ORDER BY created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE orders
SET status = 'researching',
    lease_until = now() + interval '5 minutes',
    worker_run_id = gen_random_uuid(),
    attempt_count = COALESCE(attempt_count, 0) + 1,
    started_at = COALESCE(started_at, now()),
    updated_at = now()
WHERE id = (SELECT id FROM candidate)
RETURNING *;
```

If the existing state machine requires the row to remain `new` while leased,
keep that status and use the same conditional lease claim. The non-negotiable
part is one atomic owner plus expiry recovery.

## Failure rules

- Network timeout, provider 429 or 5xx, worker crash, and deployment termination:
  release or expire the lease, calculate `next_attempt_at`, save a stable error
  code, and retry.
- Invalid or incomplete item, quantity, unit, specification, or technical
  conflict: set `needs_attention` with a concise operator-facing reason.
- Retry exhaustion: keep a distinct infrastructure-failure state or alert. Do
  not pretend that the customer omitted information.
- Supplier email: use a unique idempotency key before sending. A retried worker
  must retrieve the prior send receipt instead of sending again.

Suggested backoff: 30 seconds, 2 minutes, 5 minutes, 15 minutes, then hourly
with an alert. A newly corrected request should be a new order rather than an
in-place rewrite of an immutable request snapshot.

## Acceptance tests

- Webhook absent, scheduled poll starts the order within two minutes.
- Webhook returns 500, later polling still starts the order.
- Webhook returns 204 but the first worker dies, lease expiry resumes the order.
- Two workers race, exactly one claim succeeds.
- The same webhook is delivered five times, one workflow execution is created.
- A supplier email step crashes after send, retry does not send a second email.
- Infrastructure failures never produce `needs_attention`.
- Missing STL units or conflicting PCB finish may produce `needs_attention`
  with the exact missing input.
- A completed order is never claimed again.
