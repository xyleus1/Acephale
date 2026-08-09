# Product Copy Policy

Derya is an operating tool, not a pitch deck. Product copy must help an
operator understand state, make a decision, complete work, or recover from a
problem. If a line does none of those things, delete it.

## Allowed Copy

Every visible line must do at least one of these jobs:

- identify the current record, scope, or workspace
- report actual data, status, freshness, connection state, or failure state
- state a limit, assumption, approval gate, privacy boundary, or source
- name the action the operator can take
- request a specific input needed to continue
- explain an error and the concrete recovery step
- distinguish source text, automated drafts, and operator-confirmed facts

Evidence and provenance labels are allowed when they identify an actual source
or review boundary. They are not marketing benefits.

## Forbidden Copy

Do not ship:

- product names for retired or experimental surfaces
- model names, model versions, or AI vendors in headers, subtitles, empty
  states, buttons, badges, or capability claims
- claims such as "AI-powered," "AI-native," "answers with cited evidence," or
  "intelligent workflow"
- self-congratulation about citations, intelligence, accuracy, speed, or being
  advanced
- internal strategy jargon such as "wedge," "flywheel," or "unlock" used as a
  product label
- product metaphors such as "commercial brain," "command center," or "control
  tower" when a plain operational label is available
- anthropomorphic system claims such as "the brain is refusing"
- future promises, mood copy, greetings, slogans, or narration about what the
  product will become
- subtitles that merely repeat the heading or list generic capabilities
- explanation cards that restate controls already visible on the page

The words "automated draft" or equivalent may appear only when provenance
matters and the operator must distinguish generated content from source text or
confirmed facts. Prefer action labels such as "Generate draft," "Parse request,"
and "Re-extract."

## Surface Rules

- Page subtitles must contain current state, scope, or a material limit.
- Empty states get one direct heading, at most one useful instruction sentence,
  and an obvious next action when one exists.
- Buttons name the action and object. Do not name the implementation technology.
- Loading text describes the work in progress, not the model doing it.
- Error text says what failed and what the operator can do next.
- Agent prompts and generated customer or supplier drafts follow the same
  policy as static UI copy.

Model or vendor names are allowed only when an operator explicitly requests
diagnostic identity, or when a settings, privacy, security, or compliance
disclosure requires the name. Normal product UI has no exception.

## Enforcement

Run:

```bash
npm run check:product-copy
```

`npm run build` runs this check first. The check rejects retired product names,
model promotion in UI TSX, generic AI claims, hype language, and known Derya
slogans or metaphors across product TypeScript source.

If a necessary diagnostic or disclosure needs blocked text, add an exact file
and text exception in `scripts/product-copy-policy.test.ts` with a specific
reason of at least 20 characters. Do not weaken a rule or add a broad path
exemption.

## Review Checklist

Before approving product copy:

1. What operator decision or action does this line support?
2. Is it a verified state or limitation, or is it a claim about the product?
3. Would deleting it make the task harder?
4. Does it name implementation technology that the operator does not need?
5. Does it preserve privacy, provenance, approval, and error-recovery facts?

If question 1 has no concrete answer or question 3 is no, delete the line.
