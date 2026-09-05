import "server-only";

import Gpt56Client, { DERYA_AI_MODEL } from "@/lib/gpt56-client";
import { procurementWorkflowDatabase, procurementOfficeIdFromServerMetadata } from "@/lib/procurement-workflow";
import {
  parseSourcingProfileEnrichment,
  type SourcingProfileEnrichment,
} from "@/lib/supply-os/supplier-sourcing-profile";
import type { BulkRfqOrder } from "@/lib/procurement-bulk-rfq";

export const SOURCING_PROFILE_ENRICHMENT_PROMPT = [
  "Suggest concise supplier-search enrichment for one procurement request.",
  "Return only strict JSON with exactly these arrays: queries, synonyms, disqualifierTerms.",
  "Use short phrases, no markdown, no explanations, and no em dash characters.",
  "Do not invent certifications, locations, quantities, or supplier facts.",
].join(" ");

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function messageText(value: { content: Array<{ type: string; text?: string }> }) {
  return value.content.find((block) => block.type === "text" && typeof block.text === "string")?.text ?? "";
}

async function requestContext(order: BulkRfqOrder) {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{ requestContext: unknown }>>(`
    SELECT orders.request_context AS "requestContext"
    FROM orders
    WHERE orders.id = $1::uuid
      AND orders.customer_id = $2::uuid
    LIMIT 1
  `, order.orderId, order.customerId);
  return record(rows.at(0)?.requestContext);
}

async function persistEnrichment(
  order: BulkRfqOrder,
  officeId: string,
  enrichment: SourcingProfileEnrichment,
) {
  if (order.officeId !== officeId) return false;
  if (procurementOfficeIdFromServerMetadata(order.customerId) !== officeId) return false;
  const sourcingProfile = {
    enrichment,
    source: "model",
    model: DERYA_AI_MODEL,
    createdAt: new Date().toISOString(),
  };
  const updated = await procurementWorkflowDatabase().$executeRawUnsafe(`
    UPDATE orders
    SET request_context = jsonb_set(
          coalesce(request_context, '{}'::jsonb),
          '{sourcingProfile}',
          $3::jsonb,
          true
        ),
        updated_at = now()
    WHERE orders.id = $1::uuid
      AND orders.customer_id = $2::uuid
  `, order.orderId, order.customerId, JSON.stringify(sourcingProfile));
  return updated === 1;
}

export async function loadOrProposeSourcingProfileEnrichment(args: {
  order: BulkRfqOrder;
  officeId: string;
}): Promise<SourcingProfileEnrichment | null> {
  try {
    if (
      args.order.officeId !== args.officeId
      || procurementOfficeIdFromServerMetadata(args.order.customerId) !== args.officeId
    ) return null;
    const context = await requestContext(args.order);
    const persisted = parseSourcingProfileEnrichment(record(context.sourcingProfile).enrichment);
    if (persisted) return persisted;

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return null;
    const client = new Gpt56Client({ apiKey });
    const response = await client.messages.create({
      max_tokens: 400,
      system: SOURCING_PROFILE_ENRICHMENT_PROMPT,
      messages: [{
        role: "user",
        content: JSON.stringify({
          material: args.order.material,
          specification: args.order.specification,
          notes: args.order.notes,
          deliveryLocation: args.order.deliveryLocation ?? null,
          targetCountry: args.order.targetCountry ?? null,
        }),
      }],
    });
    const enrichment = parseSourcingProfileEnrichment(JSON.parse(messageText(response)));
    if (!enrichment) return null;
    if (!await persistEnrichment(args.order, args.officeId, enrichment)) return null;
    return enrichment;
  } catch {
    return null;
  }
}
