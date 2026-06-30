import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { applyBrainIngest, validateBrainIngestPayload } from "../src/lib/brain-ops/ingest";
import { getDecisionTimeline, getOpenCommitments, getOperationalBrainContext, getOrganizationDossier, searchBrain } from "../src/lib/brain-ops/query";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const runId = `brain-ops-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });
  const otherOffice = await prisma.office.create({ data: { name: `${runId}-other` } });

  try {
    const user = await prisma.user.create({
      data: {
        officeId: office.id,
        email: `${runId}@example.com`,
        passwordHash: "test",
        fullName: "Brain Ops Tester",
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        officeId: otherOffice.id,
        email: `${runId}-other@example.com`,
        passwordHash: "test",
        fullName: "Other Office Tester",
      },
    });
    const company = await prisma.company.create({
      data: { officeId: office.id, name: `${runId} Logistics`, status: "IN_PROGRESS" },
    });
    await prisma.contact.createMany({
      data: [
        { companyId: company.id, fullName: "Ambiguous Contact", email: `${runId}-ambiguous@example.com` },
        { companyId: company.id, fullName: "Ambiguous Contact", email: `${runId}-ambiguous@example.com` },
      ],
    });
    const inquiry = await prisma.inquiry.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        subject: `${runId} Sea freight RFQ`,
        status: "INGESTED",
      },
    });
    const duplicateSubjectInquiry = await prisma.inquiry.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        subject: inquiry.subject,
        status: "INGESTED",
      },
    });
    const job = await prisma.job.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        inquiryId: inquiry.id,
        reference: `${runId.toUpperCase()}-JOB-001`,
        title: `${runId} operational move`,
      },
    });
    const jobDocument = await prisma.jobDocument.create({
      data: {
        officeId: office.id,
        jobId: job.id,
        name: `${runId} packing list`,
        docType: "PACKING_LIST",
      },
    });

    const validPayload = {
      mode: "calibration" as const,
      source: {
        title: `${runId} Granola customer meeting`,
        source_type: "granola_meeting_note",
        source_uri: `memory://test/${runId}`,
        occurred_at: "2026-06-23",
        raw_text: `${runId} Logistics asked for a firm quote and Sara owns the rate follow-up.`,
      },
      operational_refs: [
        { type: "company", name: company.name },
        { type: "job", reference: job.reference },
        { type: "job_document", id: jobDocument.id },
        { type: "job", reference: `${job.reference}-typo` },
      ],
      commitments: [{
        organization_name: company.name,
        owner_text: "Sara",
        description: "Send a firm quote after carrier rates are checked.",
        source_quote: "Sara owns the rate follow-up.",
        confidence: 0.91,
      }],
      decisions: [{
        title: "Keep pricing review human-approved",
        summary: "Pricing changes remain proposed until reviewed.",
        source_quote: "firm quote after carrier rates are checked",
        confidence: 0.82,
      }],
      risks: [{
        organization_name: `${runId} Logistic`,
        description: "Similar company name should not link automatically.",
        severity: "medium",
        source_quote: `${runId} Logistic is a typo, not an exact customer.`,
        confidence: 0.7,
      }],
      documents: [{
        organization_name: company.name,
        title: "Weekly memo",
        status: "report",
        summary: "Customer follow-up memo.",
      }],
    };

    const validation = await validateBrainIngestPayload({ officeId: office.id, payload: validPayload });
    assert(validation.ok, `valid payload should pass: ${JSON.stringify(validation.rejectedItems)}`);
    assert(
      validation.proposals.some((proposal) => proposal.type === "commitment" && proposal.payload.company_id === company.id),
      "exact organization name should link to company",
    );
    assert(
      validation.unresolvedEntities.some((entity) => entity.name === `${runId} logistic`.toLowerCase()),
      "similar but non-exact organization name should stay unresolved",
    );
    assert(
      validation.resolvedOperationalRefs?.some((ref) => ref.type === "job" && ref.id === job.id),
      "Granola operational refs should resolve exact job references",
    );
    assert(
      validation.resolvedOperationalRefs?.some((ref) => ref.type === "job_document" && ref.id === jobDocument.id),
      "Granola operational refs should resolve scoped job document ids",
    );
    assert(
      validation.unresolvedEntities.some((entity) => entity.type === "job" && entity.name === `${job.reference}-typo`),
      "bad Granola job references should stay unresolved",
    );

    const evidenceLessGranola = await validateBrainIngestPayload({
      officeId: office.id,
      payload: {
        source: { title: "no evidence", source_type: "granola_meeting_note" },
      },
    });
    assert(!evidenceLessGranola.ok, "Granola notes without raw_text or source_uri should fail validation");

    const ambiguousRefs = await validateBrainIngestPayload({
      officeId: office.id,
      payload: {
        source: { title: "ambiguous refs", source_type: "granola_meeting_note", source_uri: "memory://ambiguous" },
        operational_refs: [
          { type: "contact", email: `${runId}-ambiguous@example.com` },
          { type: "inquiry", subject: inquiry.subject },
        ],
      },
    });
    assert(
      ambiguousRefs.unresolvedEntities.some((entity) => entity.type === "contact" && entity.name.includes("ambiguous exact match")),
      "ambiguous contact exact matches should not link with findFirst semantics",
    );
    assert(
      ambiguousRefs.unresolvedEntities.some((entity) => entity.type === "inquiry" && entity.name.includes("ambiguous exact match")),
      "ambiguous inquiry exact matches should not link with findFirst semantics",
    );

    const missingQuote = await validateBrainIngestPayload({
      officeId: office.id,
      payload: {
        source: { title: "bad", source_type: "meeting_note" },
        commitments: [{ organization_name: company.name, owner_text: "ops", description: "Quote them." }],
      },
    });
    assert(!missingQuote.ok, "missing source_quote on commitment should fail validation");

    const invalidStatus = await validateBrainIngestPayload({
      officeId: office.id,
      payload: {
        source: { title: "bad status", source_type: "meeting_note" },
        documents: [{ title: "Doc", status: "truthy-truth" }],
      },
    });
    assert(!invalidStatus.ok, "invalid document status should fail validation");

    const beforeObjects = await prisma.knowledgeObject.count({ where: { officeId: office.id } });
    const result = await applyBrainIngest({ officeId: office.id, userId: user.id, payload: validPayload });
    assert(result.ok, `apply should succeed: ${JSON.stringify(result)}`);
    assert(result.sourceObjectId, "apply should create a source object");
    assert(result.proposalIds.length >= 4, "calibration mode should create review proposals");

    const companyAfterApply = await prisma.company.count({ where: { officeId: office.id } });
    assert(companyAfterApply === 1, "calibration mode should not create final company records");
    const afterObjects = await prisma.knowledgeObject.count({ where: { officeId: office.id } });
    assert(afterObjects === beforeObjects + 1, "apply should create exactly one source KnowledgeObject");
    const afterProposals = await prisma.agentProposal.count({ where: { officeId: office.id } });
    const sourceObject = await prisma.knowledgeObject.findFirstOrThrow({ where: { officeId: office.id, id: result.sourceObjectId } });
    assert(sourceObject.sourceType === "DOCUMENT", "Granola note should be stored as a document-backed memory source");
    assert(sourceObject.canonicalType === "job", "Granola note linked to a job should be searchable as job memory");
    assert(sourceObject.jobId === job.id, "Granola note should keep exact job linkage");
    assert(sourceObject.companyId === company.id, "Granola note should keep company linkage from exact refs");
    const mentions = await prisma.entityMention.findMany({ where: { officeId: office.id, objectId: result.sourceObjectId } });
    assert(mentions.some((mention) => mention.entityType === "job" && mention.entityId === job.id), "Granola note should create job entity mention");

    const duplicate = await applyBrainIngest({ officeId: office.id, userId: user.id, payload: validPayload });
    assert(duplicate.ok, `duplicate apply should be idempotent: ${JSON.stringify(duplicate)}`);
    assert(duplicate.sourceObjectId === result.sourceObjectId, "duplicate apply should return the original source object");
    assert(duplicate.warnings.some((warning) => warning.message.includes("Duplicate Brain Ops source payload")), "duplicate apply should report idempotent reuse");
    assert(
      await prisma.knowledgeObject.count({ where: { officeId: office.id } }) === afterObjects,
      "duplicate apply should not create another KnowledgeObject",
    );
    assert(
      await prisma.agentProposal.count({ where: { officeId: office.id } }) === afterProposals,
      "duplicate apply should not create duplicate AgentProposal rows",
    );

    const crossOfficeActor = await applyBrainIngest({ officeId: office.id, userId: otherUser.id, payload: {
      source: { title: "wrong actor", source_type: "granola_meeting_note", source_uri: "memory://wrong-actor" },
    } });
    assert(!crossOfficeActor.ok, "cross-office userId should fail actor validation");

    const failedAtomic = await applyBrainIngest({
      officeId: office.id,
      payload: { source: { source_type: "meeting_note" }, commitments: [{ description: "bad" }] },
    });
    assert(!failedAtomic.ok, "invalid payload should not enter transaction");
    const afterFailedObjects = await prisma.knowledgeObject.count({ where: { officeId: office.id } });
    assert(afterFailedObjects === afterObjects, "invalid apply should not create partial source records");

    const commitments = await getOpenCommitments({ officeId: office.id });
    assert(commitments.length >= 1 && commitments[0].source.id, "commitment query should return source metadata");

    const decisions = await getDecisionTimeline({ officeId: office.id });
    assert(decisions.length >= 1 && decisions[0].source.source_type, "decision query should return source metadata");

    const dossier = await getOrganizationDossier({ officeId: office.id, organizationName: company.name });
    assert(dossier.found, "dossier should find exact organization");
    assert((await getOrganizationDossier({ officeId: office.id, organizationName: `${company.name} LLC` })).found === false, "dossier should not fuzzy match");

    const search = await searchBrain({ officeId: office.id, query: runId });
    assert(search.length >= 1 && search[0].source.id, "brain search should return source metadata");
    const operationalContext = await getOperationalBrainContext({ officeId: office.id, jobId: job.id, query: runId });
    assert(operationalContext.length >= 1, "operational context should retrieve Granola note for linked job");

    void duplicateSubjectInquiry;
    console.log(JSON.stringify({ ok: true, officeId: office.id, sourceObjectId: result.sourceObjectId, proposalCount: result.proposalIds.length }, null, 2));
  } finally {
    await prisma.agentProposal.deleteMany({ where: { officeId: office.id } });
    await prisma.knowledgeChunk.deleteMany({ where: { officeId: office.id } });
    await prisma.entityMention.deleteMany({ where: { officeId: office.id } });
    await prisma.memoryEvent.deleteMany({ where: { officeId: office.id } });
    await prisma.agentMemory.deleteMany({ where: { officeId: office.id } });
    await prisma.knowledgeObject.deleteMany({ where: { officeId: office.id } });
    await prisma.knowledgeSource.deleteMany({ where: { officeId: office.id } });
    await prisma.jobDocument.deleteMany({ where: { officeId: office.id } });
    await prisma.job.deleteMany({ where: { officeId: office.id } });
    await prisma.inquiry.deleteMany({ where: { officeId: office.id } });
    await prisma.contact.deleteMany({ where: { company: { officeId: office.id } } });
    await prisma.user.deleteMany({ where: { officeId: office.id } });
    await prisma.user.deleteMany({ where: { officeId: otherOffice.id } });
    await prisma.company.deleteMany({ where: { officeId: office.id } });
    await prisma.office.delete({ where: { id: office.id } });
    await prisma.office.delete({ where: { id: otherOffice.id } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
