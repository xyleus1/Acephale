import assert from "node:assert/strict";
import { buyerRecommendation } from "../src/lib/supply-os/buyer-agent";

const base = {
  id: "case-1",
  result: { stage: "COMMERCIAL_CONFIRMATION" },
} as any;

assert.equal(buyerRecommendation(base).nextAction, "Review quote");
assert.equal(buyerRecommendation({ ...base, result: { stage: "PURCHASE_READY" } }).nextAction, "Prepare order");
assert.equal(buyerRecommendation({ ...base, purchaseAction: { approval: { status: "APPROVED" } } }).state, "READY_TO_ISSUE");
assert.equal(buyerRecommendation({ ...base, purchaseAction: { result: { state: "RELEASED" } } }).state, "AWAITING_ACKNOWLEDGMENT");
assert.equal(buyerRecommendation({ ...base, purchaseAction: { result: { state: "PARTIALLY_ACKNOWLEDGED", remainingQuantity: "4", unitOfMeasure: "EA" } } }).nextAction, "Follow up with supplier");
assert.equal(buyerRecommendation({ ...base, purchaseAction: { result: { state: "ACKNOWLEDGED" } } }).canCreatePaymentHandoff, true);
assert.equal(buyerRecommendation({ ...base, purchaseAction: { result: { state: "RELEASED", supplierOrderExceptions: [{ status: "OPEN_REVIEW" }] } } }).state, "EXCEPTION_REVIEW");

console.log("Supply OS buyer-agent guidance tests passed.");
