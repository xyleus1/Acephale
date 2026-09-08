import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getProcurementRequest,
  getProcurementWorkflowAccount,
  procurementCustomerIdFromServerMetadata,
  type ProcurementWorkflowAccountLookup,
} from "@/lib/procurement-workflow";
import { hashSupplyStateValue } from "@/lib/supply-os/state-runtime/canonicalize";
import type { SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import {
  companySupplierRelationshipValue,
  procurementConversationMessageState,
  supplierEvidenceListValue,
  supplierProfileIdentityValue,
  supplierProfileResearchValue,
} from "./selectors";
import {
  boundSupplyStateValue,
  boundedText,
  decimalString,
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  safeIso,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";

type ProcurementConversationReader = typeof import("@/lib/procurement-conversation")["procurementVendorConversation"];

type SupplierReaderDependencies = {
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findWorkflowAccount: ProcurementWorkflowAccountLookup;
  findSupplier: typeof prisma.supplier.findFirst;
  findCompanySupplier: typeof prisma.companySupplier.findFirst;
  findSupplierProfile: typeof prisma.supplySupplierProfile.findFirst;
  findProfileFacts: typeof prisma.supplyProfileFact.findMany;
  findPriceObservations: typeof prisma.supplyPriceObservation.findMany;
  findEvidence: typeof prisma.supplyEvidence.findMany;
  resolveCustomerId: typeof procurementCustomerIdFromServerMetadata;
  getRequest: typeof getProcurementRequest;
  getConversation: ProcurementConversationReader;
};

const defaultDependencies: SupplierReaderDependencies = {
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findWorkflowAccount: getProcurementWorkflowAccount,
  findSupplier: (args) => prisma.supplier.findFirst(args),
  findCompanySupplier: (args) => prisma.companySupplier.findFirst(args),
  findSupplierProfile: (args) => prisma.supplySupplierProfile.findFirst(args),
  findProfileFacts: (args) => prisma.supplyProfileFact.findMany(args),
  findPriceObservations: (args) => prisma.supplyPriceObservation.findMany(args),
  findEvidence: (args) => prisma.supplyEvidence.findMany(args),
  resolveCustomerId: procurementCustomerIdFromServerMetadata,
  getRequest: getProcurementRequest,
  getConversation: async (...args) => {
    const { procurementVendorConversation } = await import("@/lib/procurement-conversation");
    return procurementVendorConversation(...args);
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requestWorkspaceId(requestContext: unknown) {
  const source = record(record(requestContext).source);
  return typeof source.workspace_id === "string" && source.workspace_id.trim()
    ? source.workspace_id.trim()
    : null;
}

export async function readSupplierState(
  input: SupplyStateReaderInput,
  dependencies: SupplierReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  if (input.scope.type !== "supplier") return emptySupplyStateReaderResult();
  if (!input.scope.supplierId && !input.scope.supplierKey && !(input.scope.orderId && input.scope.vendorId)) {
    throw new Error("Supplier state scope requires an exact supplier, profile, or request vendor reference.");
  }
  const workspace = input.scope.workspaceId
    ? await dependencies.findWorkspace({
        where: { id: input.scope.workspaceId, officeId: input.scope.officeId, status: "ACTIVE" },
        select: { id: true, companyId: true },
      })
    : null;
  if (input.scope.workspaceId && !workspace) {
    throw new Error("Supplier state scope references an unavailable workspace.");
  }
  if (workspace && input.scope.companyId && workspace.companyId !== input.scope.companyId) {
    throw new Error("Supplier state scope company does not own the requested workspace.");
  }
  const result = emptySupplyStateReaderResult();
  const [globalSupplier, profile] = await Promise.all([
    input.scope.supplierId ? dependencies.findSupplier({
      where: { id: input.scope.supplierId, officeId: input.scope.officeId },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        website: true,
        domain: true,
        status: true,
        sourceRefs: true,
        createdAt: true,
        updatedAt: true,
      },
    }) : Promise.resolve(null),
    input.scope.workspaceId && input.scope.supplierKey ? dependencies.findSupplierProfile({
      where: {
        officeId: input.scope.officeId,
        workspaceId: input.scope.workspaceId,
        supplierKey: input.scope.supplierKey,
      },
      select: {
        id: true,
        workspaceId: true,
        linkedCompanyId: true,
        lastResearchRunId: true,
        supplierKey: true,
        normalizedName: true,
        companyName: true,
        website: true,
        websiteDomain: true,
        roles: true,
        status: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }) : Promise.resolve(null),
  ]);
  const companyRelationship = globalSupplier && input.scope.companyId
    ? await dependencies.findCompanySupplier({
        where: {
          officeId: input.scope.officeId,
          companyId: input.scope.companyId,
          supplierId: globalSupplier.id,
        },
        select: {
          id: true,
          companyId: true,
          supplierId: true,
          status: true,
          notes: true,
          sourceRefs: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    : null;
  const [facts, observations] = profile ? await Promise.all([
    dependencies.findProfileFacts({
      where: {
        officeId: input.scope.officeId,
        workspaceId: profile.workspaceId,
        subjectType: "SUPPLIER",
        subjectRef: profile.supplierKey,
      },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        capabilityRunId: true,
        evidenceId: true,
        factType: true,
        value: true,
        sourceType: true,
        sourceUri: true,
        contentHash: true,
        observedAt: true,
        capturedAt: true,
      },
    }),
    dependencies.findPriceObservations({
      where: {
        officeId: input.scope.officeId,
        workspaceId: profile.workspaceId,
        supplierProfileId: profile.id,
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        capabilityRunId: true,
        evidenceId: true,
        itemKey: true,
        observationType: true,
        amount: true,
        currency: true,
        unitOfMeasure: true,
        minimumQuantity: true,
        availableQuantity: true,
        sourceUrl: true,
        sourceLabel: true,
        contentHash: true,
        observedAt: true,
        validUntil: true,
        capturedAt: true,
      },
    }),
  ]) : [[], []];
  const evidenceIds = [...new Set([
    ...facts.map((fact) => fact.evidenceId),
    ...observations.map((observation) => observation.evidenceId),
  ].filter((id): id is string => Boolean(id)))];
  const evidenceRows = input.scope.workspaceId && evidenceIds.length ? await dependencies.findEvidence({
    where: {
      officeId: input.scope.officeId,
      workspaceId: input.scope.workspaceId,
      id: { in: evidenceIds },
    },
    select: {
      id: true,
      contentHash: true,
      kind: true,
      sourceType: true,
      sourceUri: true,
      sourceRecordId: true,
      sourceVersion: true,
      title: true,
      excerpt: true,
      observedAt: true,
      capturedAt: true,
    },
  }) : [];
  const supplierEvidenceValue = supplierEvidenceListValue(evidenceRows);
  const evidenceRefs: SupplyWorldEvidenceRef[] = [
    ...facts.map((fact) => ({
      kind: "supply_profile_fact" as const,
      id: fact.id,
      contentHash: fact.contentHash,
    })),
    ...observations.map((observation) => ({
      kind: "supply_price_observation" as const,
      id: observation.id,
      contentHash: observation.contentHash,
    })),
    ...supplierEvidenceValue.map((evidence) => ({
      kind: "supply_evidence" as const,
      id: evidence.id,
      contentHash: evidence.contentHash,
    })),
  ];
  result.evidenceRefs.push(...evidenceRefs);

  if (globalSupplier) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `supplier.identity:${globalSupplier.id}`,
      source: "APP_DB",
      entityType: "Supplier",
      entityRef: globalSupplier.id,
      value: {
        id: globalSupplier.id,
        name: globalSupplier.name,
        normalizedName: globalSupplier.normalizedName,
        website: globalSupplier.website,
        domain: globalSupplier.domain,
        status: globalSupplier.status,
      },
      policy: "STRICT",
      reason: "The canonical office supplier identity changed.",
      evidenceRefs: [],
    }));
  } else if (input.scope.supplierId) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `supplier.identity:${input.scope.supplierId}`,
      source: "APP_DB",
      entityType: "Supplier",
      entityRef: input.scope.supplierId,
      value: null,
      policy: "STRICT",
      reason: "The requested canonical supplier did not exist when state was compiled.",
      evidenceRefs: [],
    }));
    result.uncertainties.push({ kind: "canonical_supplier_missing", supplierId: input.scope.supplierId });
  }
  if (companyRelationship) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `supplier.company_relationship:${companyRelationship.companyId}:${companyRelationship.supplierId}`,
      source: "APP_DB",
      entityType: "CompanySupplier",
      entityRef: companyRelationship.id,
      value: companySupplierRelationshipValue(companyRelationship),
      policy: "STRICT",
      reason: "The company-specific supplier relationship changed.",
      evidenceRefs: [],
    }));
  } else if (input.scope.companyId && input.scope.supplierId) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `supplier.company_relationship:${input.scope.companyId}:${input.scope.supplierId}`,
      source: "APP_DB",
      entityType: "CompanySupplier",
      entityRef: `${input.scope.companyId}:${input.scope.supplierId}`,
      value: null,
      policy: "STRICT",
      reason: "No company-specific supplier relationship existed when state was compiled.",
      evidenceRefs: [],
    }));
  }
  if (profile) {
    const prefix = `${profile.workspaceId}:${encodeURIComponent(profile.supplierKey)}`;
    result.dependencies.push(
      makeSupplyStateDependency({
        key: `supplier.profile:${prefix}`,
        source: "APP_DB",
        entityType: "SupplySupplierProfile",
        entityRef: profile.id,
        value: supplierProfileIdentityValue(profile),
        policy: "STRICT",
        reason: "The workspace supplier profile identity or qualification state changed.",
        evidenceRefs,
      }),
      makeSupplyStateDependency({
        key: `supplier.profile_research:${prefix}`,
        source: "APP_DB",
        entityType: "SupplySupplierProfileResearch",
        entityRef: profile.id,
        value: supplierProfileResearchValue(profile),
        policy: "ADVISORY",
        reason: "The workspace supplier profile research provenance changed.",
        evidenceRefs: [],
      }),
      makeSupplyStateDependency({
        key: `supplier.profile_facts:${prefix}`,
        source: "APP_DB",
        entityType: "SupplyProfileFact",
        entityRef: profile.supplierKey,
        value: facts.map((fact) => ({ id: fact.id, contentHash: fact.contentHash })),
        version: hashSupplyStateValue(facts.map((fact) => ({ id: fact.id, contentHash: fact.contentHash }))),
        policy: "ADVISORY",
        reason: "Workspace supplier intelligence facts changed.",
        evidenceRefs: evidenceRefs.filter((reference) => reference.kind === "supply_profile_fact"),
      }),
      makeSupplyStateDependency({
        key: `supplier.price_observations:${prefix}`,
        source: "APP_DB",
        entityType: "SupplyPriceObservation",
        entityRef: profile.supplierKey,
        value: observations.map((observation) => ({ id: observation.id, contentHash: observation.contentHash })),
        version: hashSupplyStateValue(observations.map((observation) => ({ id: observation.id, contentHash: observation.contentHash }))),
        policy: "ADVISORY",
        reason: "Supplier price observations changed.",
        evidenceRefs: evidenceRefs.filter((reference) => reference.kind === "supply_price_observation"),
      }),
      makeSupplyStateDependency({
        key: `supplier.evidence:${prefix}`,
        source: "APP_DB",
        entityType: "SupplyEvidenceList",
        entityRef: `${profile.workspaceId}:${profile.supplierKey}`,
        value: supplierEvidenceValue,
        version: hashSupplyStateValue(supplierEvidenceValue),
        policy: "ADVISORY",
        reason: "Source evidence linked to supplier intelligence changed.",
        evidenceRefs: evidenceRefs.filter((reference) => reference.kind === "supply_evidence"),
      }),
    );
  } else if (input.scope.supplierKey) {
    if (input.scope.workspaceId) {
      result.dependencies.push(makeSupplyStateDependency({
        key: `supplier.profile:${input.scope.workspaceId}:${encodeURIComponent(input.scope.supplierKey)}`,
        source: "APP_DB",
        entityType: "SupplySupplierProfile",
        entityRef: input.scope.supplierKey,
        value: null,
        policy: "STRICT",
        reason: "The requested workspace supplier profile did not exist when state was compiled.",
        evidenceRefs: [],
      }));
    }
    result.uncertainties.push({
      kind: "workspace_supplier_profile_missing",
      workspaceId: input.scope.workspaceId ?? null,
      supplierKey: input.scope.supplierKey,
    });
  }

  let requestVendor: Record<string, unknown> | null = null;
  let communication: Record<string, unknown> | null = null;
  const orderId = input.scope.orderId;
  const vendorId = input.scope.vendorId;
  if (orderId && vendorId) {
    const customerId = dependencies.resolveCustomerId(input.scope.officeId);
    const workflowAccount = await dependencies.findWorkflowAccount({
      customerId,
      officeId: input.scope.officeId,
      companyId: input.scope.companyId ?? workspace?.companyId ?? null,
    });
    if (!workflowAccount) {
      throw new Error("Supplier request scope is not owned by the requested company.");
    }
    const order = await dependencies.getRequest(customerId, orderId);
    const linkedWorkspaceId = order ? requestWorkspaceId(order.requestContext) : null;
    if (input.scope.workspaceId && linkedWorkspaceId !== input.scope.workspaceId) {
      throw new Error("Supplier request scope is not linked to the requested workspace.");
    }
    if (linkedWorkspaceId) {
      const linkedWorkspace = workspace?.id === linkedWorkspaceId
        ? workspace
        : await dependencies.findWorkspace({
            where: { id: linkedWorkspaceId, officeId: input.scope.officeId, status: "ACTIVE" },
            select: { id: true, companyId: true },
          });
      if (!linkedWorkspace || (input.scope.companyId && linkedWorkspace.companyId !== input.scope.companyId)) {
        throw new Error("Supplier request workspace is not owned by the workflow company.");
      }
    }
    const vendor = order?.vendors.find((candidate) => candidate.id === vendorId) ?? null;
    if (!order || !vendor) {
      if (input.scope.supplierId) {
        throw new Error("The request vendor is not linked to the scoped canonical supplier.");
      }
      const prefix = `${customerId}:${orderId}:${vendorId}`;
      result.dependencies.push(
        makeSupplyStateDependency({
          key: `procurement.vendor:${prefix}`,
          source: "WORKFLOW_DB",
          entityType: "order_vendor",
          entityRef: vendorId,
          value: null,
          policy: "STRICT",
          reason: "The requested workflow supplier did not exist when state was compiled.",
          evidenceRefs: [],
        }),
        makeSupplyStateDependency({
          key: `procurement.vendor_quote:${prefix}`,
          source: "WORKFLOW_DB",
          entityType: "order_vendor_quote",
          entityRef: vendorId,
          value: null,
          policy: "STRICT",
          reason: "No request-specific quote existed when state was compiled.",
          evidenceRefs: [],
        }),
      );
      result.uncertainties.push({
        kind: "request_supplier_missing",
        orderId,
        vendorId,
      });
    } else {
      if (input.scope.supplierId && vendor.supplierRegistryId !== input.scope.supplierId) {
        throw new Error("The request vendor is not linked to the scoped canonical supplier.");
      }
      const vendorValue = {
        id: vendor.id,
        supplierRegistryId: vendor.supplierRegistryId,
        name: vendor.name,
        website: vendor.website,
        contact: vendor.contact,
        contacted: vendor.contacted,
        status: vendor.status,
      };
      const vendorEvidence: SupplyWorldEvidenceRef = {
        kind: "procurement_vendor",
        id: vendor.id,
        valueHash: hashSupplyStateValue(vendorValue),
      };
      result.evidenceRefs.push(vendorEvidence);
      const prefix = `${customerId}:${order.id}:${vendor.id}`;
      result.dependencies.push(
        makeSupplyStateDependency({
          key: `procurement.vendor:${prefix}`,
          source: "WORKFLOW_DB",
          entityType: "order_vendor",
          entityRef: vendor.id,
          value: vendorValue,
          policy: "STRICT",
          reason: "The request-specific supplier identity, recipient, or state changed.",
          evidenceRefs: [vendorEvidence],
        }),
        makeSupplyStateDependency({
          key: `procurement.vendor_quote:${prefix}`,
          source: "WORKFLOW_DB",
          entityType: "order_vendor_quote",
          entityRef: vendor.id,
          value: vendor.quote,
          policy: "STRICT",
          reason: "The request-specific supplier quote changed.",
          evidenceRefs: [vendorEvidence],
        }),
      );
      requestVendor = {
        ...vendorValue,
        responseCount: vendor.responseCount,
        research: boundSupplyStateValue(vendor.research, { maxArray: 30, maxString: 1_000 }),
        quote: boundSupplyStateValue(vendor.quote, { maxArray: 30, maxString: 2_000 }),
      };
      try {
        const conversation = await dependencies.getConversation({
          officeId: input.scope.officeId,
          customerId,
          orderId: order.id,
          vendorId: vendor.id,
        });
        const messageState = procurementConversationMessageState(conversation.messages);
        const { latest, latestInbound } = messageState;
        result.evidenceRefs.push(...messageState.evidenceRefs);
        result.dependencies.push(makeSupplyStateDependency({
          key: `procurement.vendor_latest_message:${prefix}`,
          source: "EMAIL_LEDGER",
          entityType: "procurement_communication_message",
          entityRef: vendor.id,
          value: messageState.value,
          version: latest?.id,
          policy: "STRICT",
          reason: "The latest explicitly linked supplier message changed.",
          evidenceRefs: messageState.evidenceRefs,
        }));
        communication = {
          available: conversation.available,
          source: conversation.source,
          accountEmail: conversation.accountEmail,
          messageCount: conversation.messages.length,
          routing: {
            basis: "EXPLICIT_REQUEST_VENDOR",
            ambiguousIncluded: false,
          },
          latestMessage: latest ? {
            id: latest.id,
            direction: latest.direction,
            fromEmail: latest.fromEmail,
            toEmails: latest.toEmails,
            ccEmails: latest.ccEmails,
            subject: boundedText(latest.subject, 500) || null,
            bodyExcerpt: boundedText(latest.body, 1_000),
            sentAt: latest.sentAt,
            truncated: latest.truncated || latest.body.length > 1_000,
          } : null,
          latestInboundMessage: latestInbound ? {
            id: latestInbound.id,
            direction: latestInbound.direction,
            fromEmail: latestInbound.fromEmail,
            sentAt: latestInbound.sentAt,
            bodyHash: hashSupplyStateValue(latestInbound.body),
          } : null,
        };
      } catch (error) {
        result.dependencies.push(makeSupplyStateDependency({
          key: `procurement.vendor_latest_message:${prefix}`,
          source: "EMAIL_LEDGER",
          entityType: "procurement_communication_message",
          entityRef: vendor.id,
          value: null,
          policy: "STRICT",
          reason: "The explicitly linked supplier conversation could not be read.",
          evidenceRefs: [],
        }));
        result.uncertainties.push({
          kind: "request_supplier_conversation_unavailable",
          vendorId: vendor.id,
          message: error instanceof Error ? boundedText(error.message, 500) : "Conversation unavailable.",
        });
      }
    }
  }

  result.currentState.supplier = {
    globalIdentity: globalSupplier ? {
      ...globalSupplier,
      sourceRefs: boundSupplyStateValue(globalSupplier.sourceRefs, { maxArray: 30, maxString: 1_000 }),
      createdAt: safeIso(globalSupplier.createdAt),
      updatedAt: safeIso(globalSupplier.updatedAt),
    } : null,
    companyRelationship: companyRelationship ? {
      ...companyRelationship,
      sourceRefs: boundSupplyStateValue(companyRelationship.sourceRefs, { maxArray: 30, maxString: 1_000 }),
      createdAt: safeIso(companyRelationship.createdAt),
      updatedAt: safeIso(companyRelationship.updatedAt),
    } : null,
    workspaceIntelligence: profile ? {
      profile: {
        ...profile,
        firstSeenAt: safeIso(profile.firstSeenAt),
        lastSeenAt: safeIso(profile.lastSeenAt),
      },
      facts: facts.map((fact) => ({
        ...fact,
        value: boundSupplyStateValue(fact.value, { maxArray: 30, maxString: 2_000 }),
        observedAt: safeIso(fact.observedAt),
        capturedAt: safeIso(fact.capturedAt),
      })),
      priceObservations: observations.map((observation) => ({
        ...observation,
        amount: decimalString(observation.amount),
        minimumQuantity: decimalString(observation.minimumQuantity),
        availableQuantity: decimalString(observation.availableQuantity),
        observedAt: safeIso(observation.observedAt),
        validUntil: safeIso(observation.validUntil),
        capturedAt: safeIso(observation.capturedAt),
      })),
      evidence: evidenceRows.map((evidence) => ({
        ...evidence,
        excerpt: boundedText(evidence.excerpt, 1_000) || null,
        observedAt: safeIso(evidence.observedAt),
        capturedAt: safeIso(evidence.capturedAt),
      })),
    } : null,
    requestSpecificVendor: requestVendor,
    linkedCommunication: communication,
  };
  if (profile?.status === "CANDIDATE") {
    result.openLoops.push({ kind: "supplier_qualification_pending", supplierKey: profile.supplierKey });
  }
  if (requestVendor && requestVendor.quote === null) {
    result.openLoops.push({
      kind: "request_supplier_quote_pending",
      orderId: input.scope.orderId,
      vendorId: input.scope.vendorId,
    });
  }
  result.sourceCounts = {
    canonicalSuppliers: globalSupplier ? 1 : 0,
    companySupplierRelationships: companyRelationship ? 1 : 0,
    supplySupplierProfiles: profile ? 1 : 0,
    supplyProfileFacts: facts.length,
    supplyPriceObservations: observations.length,
    supplyEvidence: evidenceRows.length,
    procurementVendors: requestVendor ? 1 : 0,
    procurementMessages: communication ? 1 : 0,
  };
  return result;
}
