import type { SupplyWorldStatePacket } from "../state-runtime/types";

export const SUPPLY_SEMANTIC_FACT_ADAPTER_VERSION = "supply-semantic-facts-v1" as const;

export type SurfacedSupplySemanticFact = {
  key: string;
  value: unknown;
  adapterVersion: typeof SUPPLY_SEMANTIC_FACT_ADAPTER_VERSION;
  sourcePath: string;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function records(value: unknown) {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const parsed = record(entry);
    return parsed ? [parsed] : [];
  }) : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedNumber(value: number) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function paymentTerm(value: unknown) {
  const candidate = text(value)?.toUpperCase();
  if (!candidate?.startsWith("NET_")) return null;
  const days = Number(candidate.slice("NET_".length));
  return Number.isInteger(days) && days >= 0 && days <= 365 ? `NET_${days}` : null;
}

function paymentTermFromFact(fact: UnknownRecord) {
  if (text(fact.factType)?.toUpperCase() !== "PAYMENT_TERMS") return null;
  const value = fact.value;
  const structured = record(value);
  const term = paymentTerm(
    structured?.paymentTerms
      ?? structured?.payment_terms
      ?? structured?.terms
      ?? (structured ? null : value),
  );
  if (!term) return null;
  return {
    term,
    observedAt: text(fact.observedAt) ?? text(fact.capturedAt) ?? "",
  };
}

function planningAvailability(derivedState: UnknownRecord) {
  const candidates = [
    ...records(derivedState.itemPlanning),
    ...records(derivedState.planning),
  ];
  for (const row of candidates) {
    const output = record(row.output);
    if (!output) continue;
    const available = finiteNumber(output.availableAfterDemand ?? output.available_after_demand);
    const shortage = finiteNumber(output.shortage ?? output.shortageQuantity ?? output.shortage_quantity);
    if (available === null || shortage === null || shortage < 0) continue;
    return { available: boundedNumber(available), shortage: boundedNumber(shortage) };
  }
  return null;
}

function inventoryAvailability(itemSupply: UnknownRecord) {
  const inventory = records(itemSupply.inventory);
  const openDemands = records(itemSupply.demands).filter((demand) => (
    (text(demand.status) ?? "OPEN").toUpperCase() === "OPEN"
  ));
  if (!inventory.length || !openDemands.length) return null;

  let knownSupply = 0;
  for (const position of inventory) {
    const onHand = finiteNumber(position.quantityOnHand);
    const allocated = finiteNumber(position.quantityAllocated);
    const inTransit = finiteNumber(position.quantityInTransit);
    const onOrder = finiteNumber(position.quantityOnOrder);
    if ([onHand, allocated, inTransit, onOrder].some((value) => value === null)) return null;
    if ([onHand, allocated, inTransit, onOrder].some((value) => value! < 0)) return null;
    knownSupply += onHand! - allocated! + inTransit! + onOrder!;
  }

  let demandQuantity = 0;
  for (const demand of openDemands) {
    const quantity = finiteNumber(demand.quantity);
    if (quantity === null || quantity < 0) return null;
    demandQuantity += quantity;
  }
  const available = boundedNumber(knownSupply - demandQuantity);
  return { available, shortage: boundedNumber(Math.max(0, -available)) };
}

/**
 * Surfaces only semantic facts explicitly represented by typed commercial
 * state. It never reads a query, benchmark case, gold label, or evidence prose.
 */
export function surfaceSupplySemanticFacts(packet: SupplyWorldStatePacket) {
  const facts = new Map<string, SurfacedSupplySemanticFact>();
  const add = (key: string, value: unknown, sourcePath: string) => {
    if (value === undefined || facts.has(key)) return;
    facts.set(key, {
      key,
      value,
      adapterVersion: SUPPLY_SEMANTIC_FACT_ADAPTER_VERSION,
      sourcePath,
    });
  };

  const currentState = record(packet.currentState) ?? {};
  const derivedState = record(packet.derivedState) ?? {};

  const supplier = record(currentState.supplier);
  if (supplier) {
    const intelligence = record(supplier.workspaceIntelligence);
    const identity = record(supplier.globalIdentity) ?? record(intelligence?.profile);
    const identityPath = supplier.globalIdentity
      ? "currentState.supplier.globalIdentity"
      : "currentState.supplier.workspaceIntelligence.profile";
    const name = text(identity?.name) ?? text(identity?.companyName);
    const domain = text(identity?.domain) ?? text(identity?.websiteDomain);
    if (name) add("supplier.identity.name", name, `${identityPath}.name`);
    if (domain) add("supplier.identity.domain", domain.toLowerCase(), `${identityPath}.domain`);

    const terms = records(intelligence?.facts)
      .flatMap((fact) => {
        const parsed = paymentTermFromFact(fact);
        return parsed ? [parsed] : [];
      })
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    const currentTerm = terms.at(-1)?.term;
    if (currentTerm) {
      add(
        "supplier.payment_terms.current",
        currentTerm,
        "currentState.supplier.workspaceIntelligence.facts[PAYMENT_TERMS]",
      );
      const previous = [...new Set(terms.slice(0, -1).map((entry) => entry.term))];
      if (previous.length) {
        add(
          "supplier.payment_terms.previous",
          previous,
          "currentState.supplier.workspaceIntelligence.facts[PAYMENT_TERMS]",
        );
      }
    }
  }

  const request = record(currentState.procurementRequest);
  if (request) {
    const requestContext = record(request.requestContext);
    const procurementContext = record(requestContext?.procurementContext)
      ?? record(requestContext?.procurement_context);
    const source = record(requestContext?.source);
    const serviceLevel = text(procurementContext?.serviceLevel)
      ?? text(procurementContext?.service_level);
    if (serviceLevel) {
      add(
        "procurement.request.service_level",
        serviceLevel.toUpperCase(),
        "currentState.procurementRequest.requestContext.procurementContext.service_level",
      );
    }
    const rush = procurementContext?.rush;
    if (typeof rush === "boolean") {
      add(
        "procurement.request.rush",
        rush,
        "currentState.procurementRequest.requestContext.procurementContext.rush",
      );
    }
    const rfq = text(source?.rfq);
    if (rfq) add("procurement.identifiers.rfq", rfq, "currentState.procurementRequest.requestContext.source.rfq");

    const routedConversations = records(request.vendors).flatMap((vendor) => {
      const conversation = record(vendor.conversation);
      return conversation?.available === true && finiteNumber(conversation.messageCount) !== null
        && finiteNumber(conversation.messageCount)! > 0
        ? [conversation]
        : [];
    });
    const accountEmails = [...new Set(routedConversations
      .map((conversation) => text(conversation.accountEmail)?.toLowerCase())
      .filter((value): value is string => Boolean(value)))];
    if (accountEmails.length === 1) {
      add(
        "email.routing.account_email",
        accountEmails[0],
        "currentState.procurementRequest.vendors[].conversation.accountEmail",
      );
    }
    const routingAssertions = routedConversations
      .map((conversation) => record(conversation.routing)?.ambiguousIncluded)
      .filter((value): value is boolean => typeof value === "boolean");
    if (routingAssertions.length === routedConversations.length && routingAssertions.length > 0) {
      add(
        "email.routing.ambiguous_included",
        routingAssertions.some(Boolean),
        "currentState.procurementRequest.vendors[].conversation.routing.ambiguousIncluded",
      );
    }
  }

  const workspaceSupply = record(currentState.workspaceSupply);
  const itemSupply = record(currentState.itemSupply);
  const snapshot = record(workspaceSupply?.currentSnapshot) ?? record(itemSupply?.currentSnapshot);
  const snapshotVersion = finiteNumber(snapshot?.version);
  if (snapshotVersion !== null) {
    add("workspace.current_snapshot.version", snapshotVersion, "currentState.*Supply.currentSnapshot.version");
  }
  if (text(snapshot?.publishedAt)) {
    add("workspace.current_snapshot.published", true, "currentState.*Supply.currentSnapshot.publishedAt");
  }

  if (itemSupply) {
    const availability = planningAvailability(derivedState) ?? inventoryAvailability(itemSupply);
    if (availability) {
      add("item.supply.shortage", availability.shortage, "derivedState.itemPlanning.output|currentState.itemSupply");
      add(
        "item.supply.available_after_demand",
        availability.available,
        "derivedState.itemPlanning.output|currentState.itemSupply",
      );
    }
  }

  return [...facts.values()];
}
