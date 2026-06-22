# Domain Logic Guidance

- `src/lib` is backend and domain logic. Keep business rules deterministic and testable before adding LLM behavior.
- Avoid prompt sprawl. Centralize prompts and tool contracts instead of scattering near-duplicate strings through domain code.
- Preserve `officeId` scoping across all data access and agent-visible summaries.
- Keep customer-facing and supplier-facing side effects behind explicit human approval unless the task says otherwise.
- Prefer small pure helpers for pricing, route, risk, memory, and qualification logic. Do not hide freight decisions inside UI components.
- Do not log secrets, tokens, raw credentials, or unnecessary customer-sensitive payloads.
