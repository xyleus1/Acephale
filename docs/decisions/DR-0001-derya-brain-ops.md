# DR-0001: Add Derya Brain Ops

Status: active
Date: 2026-06-23
Owner: engineering
Related docs: `docs/COMPANY_BRAIN.md`, `docs/brain/README.md`, `docs/current-state/brain-ops.md`

## Context

Derya already has a tenant-scoped company-brain substrate built around `KnowledgeSource`, `KnowledgeObject`, `KnowledgeChunk`, `MemoryEvent`, and `AgentProposal`. Future agents still need Codex-native operating docs, repo-scoped skills, status-marked documentation, and one controlled proposal path for new source-grounded business/product memory.

## Decision

Add Derya Brain Ops as an operating layer on top of the existing company-brain schema instead of creating a second parallel brain schema.

## Why

Source-grounded memory matters because freight operators need to know what was promised, what is risky, what changed, and which source supports the claim. One controlled write path keeps extraction auditable. Exact-match organization linking is safer than fuzzy linking because similar customer names can represent different businesses. Status markers keep plans, brainstorms, reports, and current state from being mixed together. AI-generated proposals need human review before trusted writes because pricing, legal, scope, and customer commitments are expensive places to be confidently wrong.

## Alternatives considered

Create new `BrainSource`, `BrainDocument`, `BrainDecision`, and related tables exactly as requested. Rejected for now because the repo already has a broader memory/event substrate; duplicate schemas would create contradictory truth and duplicated tooling.

## Consequences

Brain Ops writes create source objects and reviewable `AgentProposal` rows first. Future UI/API work can review and apply proposals, but the first version does not silently mutate customer records. Future agents must cite sources and treat unsourced generated text as a draft, not truth.

## Supersedes / superseded by

None.
