import assert from "node:assert/strict";
import {
  buildChinaUsCustomsDecisionGuide,
  containsShipmentDutyConclusion,
  resolveCustomsRuleTemporalState,
  type ChinaCustomsDecisionGuide,
} from "../src/lib/intel/research/china-customs-guide";
import {
  isSecretFreeSourceUrl,
  resolveIntelSourceUse,
} from "../src/lib/intel/sources";

function authority(
  guide: ChinaCustomsDecisionGuide,
  id: string
) {
  const match = guide.authorities.find((candidate) => candidate.id === id);
  assert.ok(match, `authority ${id} is present`);
  return match;
}

const guide = buildChinaUsCustomsDecisionGuide();
const rebuiltGuide = buildChinaUsCustomsDecisionGuide();
const serialized = JSON.stringify(guide);

assert.deepEqual(
  guide,
  rebuiltGuide,
  "the China customs guide is deterministic"
);
assert.equal(guide.kind, "china_us_customs_decision_guide");
assert.equal(guide.originCountryCode, "5700");
assert.equal(guide.mode, "ocean");
assert.equal(guide.rulesAsOf, "2026-07-27");
assert.equal(guide.rulesAsOfAt, "2026-07-27T19:10:49.000Z");
assert.deepEqual(guide.readiness, {
  freightQuote: "requires_shipment_inputs",
  landedCost: "not_assessable",
  clearanceCommitment: "not_assessable",
});
assert.deepEqual(
  guide.authorityPriority.map((priority) => priority.rank),
  [1, 2, 3, 4],
  "the guide makes source precedence explicit"
);
assert.match(
  guide.authorityPriority[3].use,
  /never to override current authority/i
);
assert.equal(guide.gates.length, 8);
assert.deepEqual(
  guide.gates.map((gate) => gate.sequence),
  [1, 2, 3, 4, 5, 6, 7, 8]
);
assert.equal(
  guide.gates.every(
    (gate) =>
      gate.operatorAction.length > 0 &&
      gate.requiredInputs.length > 0 &&
      gate.authorityIds.length > 0
  ),
  true,
  "every customs gate has evidence, impact, action, and authority"
);
assert.equal(
  guide.gates.some((gate) => gate.assessmentState === "reference_ready"),
  false,
  "aggregate data never clears a shipment customs gate"
);
const operationalCopy = [
  ...guide.gates.flatMap((gate) => [
    gate.title,
    gate.decisionQuestion,
    ...gate.requiredInputs,
    gate.unresolvedEffect,
    gate.operatorAction,
    ...gate.categoryTriggers.flatMap((trigger) => [
      trigger.condition,
      ...trigger.requiredEvidence,
    ]),
  ]),
  ...guide.documentStages.flatMap((stage) => [
    stage.label,
    stage.purpose,
    ...stage.documents,
  ]),
  ...guide.ruleChanges.flatMap((change) => [
    change.title,
    change.operatorEffectAtReview,
  ]),
  ...guide.limitations,
].join("\n");
assert.equal(
  containsShipmentDutyConclusion(operationalCopy),
  false,
  "operational copy does not turn cited tariff actions into a shipment duty conclusion"
);
for (const forbiddenConclusion of [
  "total duty is 37.5%",
  "shipment duty: 37.5%",
  "your import duty rate will be 37.5 percent",
  "landed duty amount = $5,000",
]) {
  assert.equal(
    containsShipmentDutyConclusion(forbiddenConclusion),
    true,
    `the no-duty-conclusion guard rejects: ${forbiddenConclusion}`
  );
}
assert.doesNotMatch(
  serialized,
  /\bcompliant\b/i,
  "the guide never labels an unassessed shipment compliant"
);

const tariffGate = guide.gates.find((gate) => gate.id === "tariff_stack");
const forcedLaborGate = guide.gates.find((gate) => gate.id === "forced_labor");
assert.ok(tariffGate);
assert.ok(forcedLaborGate);
assert.equal(
  tariffGate.authorityIds.includes("dhs-uflpa-list"),
  false,
  "UFLPA is not collapsed into tariff calculation"
);
assert.equal(
  forcedLaborGate.authorityIds.includes("ustr-section-301"),
  false,
  "Section 301 is not collapsed into forced-labor screening"
);
assert.match(
  tariffGate.decisionQuestion,
  /entry date/i,
  "Section 301 and other remedies require an effective-date review"
);

const productGate = guide.gates.find(
  (gate) => gate.id === "product_admissibility"
);
assert.ok(productGate);
assert.equal(
  productGate.categoryTriggers.length,
  12,
  "medical-device, electronic-radiation, nuclear, general hazmat, and FIFRA branches remain separate alongside the other product screens"
);
assert.equal(
  productGate.categoryTriggers.every(
    (trigger) =>
      trigger.categories.length > 0 &&
      trigger.requiredEvidence.length > 0 &&
      trigger.authorityIds.length > 0
  ),
  true
);
const allHardwareCategories = new Set([
  "power_control",
  "factory_process",
  "compute_electronics",
  "medical_lab",
  "drones_aerospace",
]);
assert.equal(
  productGate.categoryTriggers.every(
    (trigger) =>
      trigger.categories.length === allHardwareCategories.size &&
      trigger.categories.every((category) =>
        allHardwareCategories.has(category)
      )
  ),
  true,
  "feature-driven product screens evaluate every hardware category and rely on product facts"
);
const lithiumTrigger = productGate.categoryTriggers.find((trigger) =>
  trigger.authorityIds.includes("phmsa-lithium-batteries")
);
assert.ok(lithiumTrigger);
assert.match(lithiumTrigger.condition, /lithium/i);
assert.equal(lithiumTrigger.requiredEvidence.includes("UN 38.3 test summary"), true);
assert.deepEqual(
  new Set(lithiumTrigger.categories),
  allHardwareCategories
);
for (const authorityId of [
  "fda-qmsr-regulation",
  "fda-radiation-ace-regulation",
  "cpsc-certificate-regulation",
  "phmsa-hmr-general",
  "phmsa-hmr-communication",
  "phmsa-hmr-vessel",
  "nrc-part-110-imports",
  "epa-engine-imports",
  "epa-fifra-import-regulation",
  "epa-hfc-equipment-regulation",
  "epa-ods-equipment-regulation",
  "doe-covered-products",
  "aphis-wood-packaging",
]) {
  assert.ok(
    productGate.categoryTriggers.some((trigger) =>
      trigger.authorityIds.includes(authorityId)
    ),
    `${authorityId} has an explicit product trigger`
  );
}
for (const authorityId of [
  "fda-qmsr-regulation",
  "fda-radiation-ace-regulation",
  "cpsc-certificate-regulation",
  "phmsa-hmr-general",
  "phmsa-hmr-communication",
  "phmsa-hmr-vessel",
  "nrc-part-110-imports",
  "epa-fifra-import-regulation",
  "epa-hfc-equipment-regulation",
  "epa-ods-equipment-regulation",
]) {
  assert.equal(
    authority(guide, authorityId).kind,
    "regulation",
    `${authorityId} is direct regulatory authority`
  );
}

const reasonableCare = authority(guide, "cbp-reasonable-care");
assert.equal(reasonableCare.documentRevisionDate, "2017-09");
assert.equal(reasonableCare.pageModifiedDate, "2026-01-07");
assert.equal(
  reasonableCare.source.reviewedAt,
  "2026-07-24T23:48:00.000Z",
  "document revision, page modification, source review, and guide refresh dates stay separate"
);
assert.equal(reasonableCare.status, "historical_reference");
assert.match(
  reasonableCare.caveat,
  /advisory/i,
  "legacy handbook guidance cannot masquerade as current regulation"
);
assert.deepEqual(
  Object.fromEntries(
    [
      "cbp-classification-handbook",
      "cbp-customs-value-handbook",
      "cbp-entry-handbook",
      "cbp-recordkeeping-handbook",
    ].map((id) => {
      const reference = authority(guide, id);
      assert.equal(reference.status, "historical_reference");
      assert.match(reference.caveat, /current/i);
      return [id, reference.documentRevisionDate];
    })
  ),
  {
    "cbp-classification-handbook": "2004-05",
    "cbp-customs-value-handbook": "2006-07",
    "cbp-entry-handbook": null,
    "cbp-recordkeeping-handbook": "2005-01",
  },
  "specialized CBP handbooks preserve their historical revision dates"
);
assert.equal(authority(guide, "cbp-entry-handbook").publishedAt, "2004-03");
assert.equal(
  authority(guide, "cbp-importing-handbook").documentRevisionDate,
  "2006"
);

const exclusion = authority(guide, "ustr-301-exclusions-2026");
assert.equal(exclusion.status, "time_limited");
assert.equal(exclusion.effectiveFrom, "2025-11-30");
assert.equal(exclusion.effectiveTo, "2026-11-09");
assert.match(exclusion.caveat, /12:01 a\.m\. EST/);
assert.match(exclusion.caveat, /11:59 p\.m\. EDT/);
const currentHts = authority(guide, "usitc-hts-current");
assert.equal(currentHts.publishedAt, "2026-07-21");
assert.equal(currentHts.source.asOf, "Released 2026-07-21");
assert.match(currentHts.source.displayName ?? "", /Revision 12/);
const section122 = authority(guide, "section-122-surcharge-2026");
assert.equal(section122.effectiveFrom, "2026-02-24");
assert.equal(section122.effectiveTo, "2026-07-24");
assert.match(section122.caveat, /12:01 a\.m\. EDT on July 24, 2026/);
assert.match(section122.caveat, /expired at that cutoff/i);
const section122Change = guide.ruleChanges.find(
  (change) => change.id === "section-122-surcharge-2026"
);
assert.ok(section122Change);
assert.equal(section122Change.temporalState, "expired");
assert.equal(section122Change.effectiveToInclusive, false);
assert.match(section122Change.operatorEffectAtReview, /action expired/i);
assert.doesNotMatch(
  section122Change.operatorEffectAtReview,
  /verify whether the action expired/i
);
assert.equal(
  resolveCustomsRuleTemporalState(section122Change, "2026-07-24"),
  "expired"
);
assert.equal(
  resolveCustomsRuleTemporalState(
    section122Change,
    "2026-07-24T04:00:59.000Z"
  ),
  "active",
  "Section 122 remains active one second before the exact EDT cutoff"
);
assert.equal(
  resolveCustomsRuleTemporalState(
    section122Change,
    "2026-07-24T04:01:00.000Z"
  ),
  "expired",
  "Section 122 expires at the exact EDT cutoff"
);
const forcedLabor301 = authority(
  guide,
  "ustr-forced-labor-301-2026"
);
assert.equal(forcedLabor301.status, "current");
assert.equal(forcedLabor301.publishedAt, "2026-07-23");
assert.equal(forcedLabor301.effectiveFrom, "2026-07-24");
assert.match(forcedLabor301.caveat, /9903\.05\.31/);
assert.match(
  forcedLabor301.caveat,
  /9903\.05\.85 through 9903\.05\.92/
);
assert.match(forcedLabor301.caveat, /12\.5 percent/);
assert.match(forcedLabor301.caveat, /July 28, 2026/);
assert.match(forcedLabor301.caveat, /loaded onto a vessel at the port of loading/i);
assert.match(forcedLabor301.caveat, /in transit on the final mode of transit/i);
assert.equal(
  tariffGate.authorityIds.includes("ustr-forced-labor-301-2026"),
  true,
  "the tariff stack includes the July 23 USTR final action"
);
const forcedLabor301Change = guide.ruleChanges.find(
  (change) => change.id === "ustr-forced-labor-301-effective"
);
assert.ok(forcedLabor301Change);
assert.equal(forcedLabor301Change.temporalState, "active");
assert.equal(forcedLabor301Change.operatorAlertPriority, 1);
assert.match(
  forcedLabor301Change.changedRule,
  /9903\.05\.85 through 9903\.05\.92/
);
assert.equal(
  resolveCustomsRuleTemporalState(forcedLabor301Change, "2026-07-24"),
  "active"
);
assert.equal(
  resolveCustomsRuleTemporalState(
    forcedLabor301Change,
    "2026-07-24T04:00:59.000Z"
  ),
  "upcoming",
  "the new Section 301 action remains upcoming one second before the exact EDT cutoff"
);
assert.equal(
  resolveCustomsRuleTemporalState(
    forcedLabor301Change,
    "2026-07-24T04:01:00.000Z"
  ),
  "active",
  "the new Section 301 action becomes active at the exact EDT cutoff"
);
const exclusionChange = guide.ruleChanges.find(
  (change) => change.id === "section-301-exclusions-2026"
);
assert.ok(exclusionChange);
assert.equal(exclusionChange.temporalState, "active");
assert.equal(exclusionChange.effectiveToInclusive, true);
assert.equal(
  resolveCustomsRuleTemporalState(exclusionChange, "2026-11-09"),
  "active"
);
assert.equal(
  resolveCustomsRuleTemporalState(exclusionChange, "2026-11-10"),
  "expired"
);
const cpsc = authority(guide, "cpsc-certificate-efiling");
assert.equal(cpsc.effectiveFrom, "2026-07-08");
const fcc = authority(guide, "fcc-rf-import-conditions");
assert.equal(fcc.effectiveFrom, null);
assert.equal(authority(guide, "fcc-presale-import-2022").effectiveFrom, "2022-04-12");
assert.equal(
  authority(guide, "fcc-covered-equipment-2025").effectiveFrom,
  "2025-12-26"
);
const fccPriorCovered = authority(
  guide,
  "fcc-prior-covered-equipment-import-2026"
);
assert.equal(fccPriorCovered.status, "current");
assert.equal(fccPriorCovered.effectiveFrom, "2026-07-16");
assert.equal(fccPriorCovered.publishedAt, "2026-07-06");
assert.match(fccPriorCovered.caveat, /2024 or earlier/);
assert.match(fccPriorCovered.caveat, /Continued use or operation is not prohibited/);
assert.match(fccPriorCovered.caveat, /2\.1204\(a\)\(3\) through \(11\)/);
assert.match(
  fccPriorCovered.source.sourceUrl,
  /FR-2026-07-06\/pdf\/2026-13518\.pdf/
);
const fccComponentsOrder = authority(
  guide,
  "fcc-covered-components-order-2026"
);
assert.equal(fccComponentsOrder.status, "upcoming");
assert.equal(fccComponentsOrder.effectiveFrom, null);
assert.equal(fccComponentsOrder.publishedAt, "2026-07-23");
assert.match(fccComponentsOrder.caveat, /not yet effective/i);
assert.match(
  fccComponentsOrder.caveat,
  /30 days after Federal Register publication/
);
assert.match(fccComponentsOrder.caveat, /logic-bearing hardware components/);
assert.equal(
  fccComponentsOrder.source.sourceUrl,
  "https://www.fcc.gov/document/fcc-adopts-rules-strengthen-rules-governing-dangerous-gear"
);
const fccCoveredList = authority(guide, "fcc-covered-list");
assert.equal(fccCoveredList.pageModifiedDate, "2026-07-07");
assert.equal(
  fccCoveredList.source.sourceUrl,
  "https://www.fcc.gov/supplychain/coveredlist"
);
assert.equal(fccCoveredList.source.asOf, "Updated 2026-07-07");
assert.match(fccCoveredList.caveat, /Digitalsystem/);
const fccPresaleChange = guide.ruleChanges.find(
  (change) => change.id === "fcc-presale-import-condition"
);
assert.ok(fccPresaleChange);
assert.equal(fccPresaleChange.effectiveDate, "2022-04-12");
const fccCoveredChange = guide.ruleChanges.find(
  (change) => change.id === "fcc-covered-equipment-import-condition"
);
assert.ok(fccCoveredChange);
assert.equal(fccCoveredChange.effectiveDate, "2025-12-26");
assert.match(fccCoveredChange.changedRule, /2\.1204\(a\)\(1\)/);
const fccPriorCoveredChange = guide.ruleChanges.find(
  (change) => change.id === "fcc-prior-covered-equipment-import-effective"
);
assert.ok(fccPriorCoveredChange);
assert.equal(fccPriorCoveredChange.effectiveDate, "2026-07-16");
assert.equal(fccPriorCoveredChange.temporalState, "active");
assert.equal(fccPriorCoveredChange.operatorAlertPriority, 6);
assert.match(fccPriorCoveredChange.changedRule, /2024 or earlier/);
assert.match(
  fccPriorCoveredChange.operatorEffectAtReview,
  /Do not extend this action to equipment added after 2024/
);
for (const authorityId of [
  "fcc-prior-covered-equipment-import-2026",
  "fcc-covered-components-order-2026",
]) {
  assert.equal(
    productGate.authorityIds.includes(authorityId),
    true,
    `${authorityId} is included in the product-admissibility gate`
  );
}
const medicalDeviceTrigger = productGate.categoryTriggers.find((trigger) =>
  trigger.authorityIds.includes("fda-qmsr-regulation")
);
const radiationProductTrigger = productGate.categoryTriggers.find((trigger) =>
  trigger.authorityIds.includes("fda-radiation-ace-regulation")
);
assert.ok(medicalDeviceTrigger);
assert.ok(radiationProductTrigger);
assert.doesNotMatch(medicalDeviceTrigger.condition, /radiation-emitting/i);
assert.match(radiationProductTrigger.condition, /medical or non-medical/i);
assert.match(
  radiationProductTrigger.requiredEvidence.join(" "),
  /Form FDA 2877/i
);
const hazmatTrigger = productGate.categoryTriggers.find((trigger) =>
  trigger.authorityIds.includes("phmsa-hmr-general")
);
assert.ok(hazmatTrigger);
assert.match(hazmatTrigger.condition, /refrigerant or compressed gas/i);
assert.match(hazmatTrigger.requiredEvidence.join(" "), /UN identification/i);
assert.match(hazmatTrigger.requiredEvidence.join(" "), /ocean-carrier acceptance/i);
assert.match(
  authority(guide, "phmsa-refrigerating-machine-interpretation").caveat,
  /12 kg/
);
const nuclearTrigger = productGate.categoryTriggers.find((trigger) =>
  trigger.authorityIds.includes("nrc-part-110-imports")
);
assert.ok(nuclearTrigger);
assert.match(nuclearTrigger.condition, /radioactive source or nuclear material/i);
assert.match(nuclearTrigger.requiredEvidence.join(" "), /consignee authorization/i);
assert.match(nuclearTrigger.requiredEvidence.join(" "), /NRC notifications/i);
const fifraTrigger = productGate.categoryTriggers.find((trigger) =>
  trigger.authorityIds.includes("epa-fifra-import-regulation")
);
assert.ok(fifraTrigger);
assert.match(fifraTrigger.condition, /disinfects, sanitizes, sterilizes/i);
assert.match(fifraTrigger.requiredEvidence.join(" "), /Form 3540-1/i);
assert.match(fifraTrigger.requiredEvidence.join(" "), /producing-establishment/i);
const hfcReconsideration = authority(
  guide,
  "epa-hfc-reconsideration-2026"
);
assert.equal(hfcReconsideration.status, "current");
assert.equal(hfcReconsideration.publishedAt, "2026-05-26");
assert.equal(hfcReconsideration.effectiveFrom, "2026-07-27");
const hfcReconsiderationChange = guide.ruleChanges.find(
  (change) => change.id === "epa-hfc-reconsideration-effective"
);
assert.ok(hfcReconsiderationChange);
assert.equal(hfcReconsiderationChange.temporalState, "active");
assert.equal(
  resolveCustomsRuleTemporalState(hfcReconsiderationChange, "2026-07-27"),
  "active"
);
const refrigerantTrigger = productGate.categoryTriggers.find((trigger) =>
  trigger.authorityIds.includes("epa-hfc-equipment-regulation")
);
assert.ok(refrigerantTrigger);
assert.match(refrigerantTrigger.condition, /refrigeration/i);
assert.match(
  refrigerantTrigger.requiredEvidence.join(" "),
  /bulk refrigerant/i,
  "finished equipment and bulk refrigerant remain separate branches"
);

assert.deepEqual(
  [...guide.ruleChanges].sort((left, right) =>
    left.effectiveDate.localeCompare(right.effectiveDate)
  ),
  guide.ruleChanges,
  "the regulatory timeline is chronological"
);
assert.equal(
  guide.ruleChanges.every(
    (change) =>
      /^\d{4}-\d{2}-\d{2}$/.test(change.effectiveDate) &&
      change.authorityIds.length > 0 &&
      change.operatorEffectAtReview.length > 0
  ),
  true
);

for (const source of guide.sources) {
  assert.equal(isSecretFreeSourceUrl(source.sourceUrl), true);
  assert.doesNotThrow(() => resolveIntelSourceUse(source));
  assert.equal(source.fetchedAt, null);
  assert.ok(source.reviewedAt);
  assert.ok(
    Date.parse(source.reviewedAt) <= Date.parse(guide.rulesReviewedAt),
    "a source review cannot be later than the guide snapshot"
  );
}
for (const authorityId of [
  "usitc-hts-current",
  "section-122-surcharge-2026",
  "ustr-forced-labor-301-2026",
  "epa-hfc-reconsideration-2026",
  "fcc-prior-covered-equipment-import-2026",
  "fcc-covered-components-order-2026",
  "fcc-covered-list",
]) {
  assert.equal(
    authority(guide, authorityId).source.reviewedAt,
    guide.rulesReviewedAt,
    `${authorityId} was rechecked for the July 27 rules snapshot`
  );
}
assert.equal(
  new Set(guide.sources.map((source) => `${source.sourceId}|${source.sourceUrl}`))
    .size,
  guide.sources.length,
  "customs source citations are unique"
);

assert.equal(serialized.includes("\u2014"), false);

console.log(
  JSON.stringify({
    ok: true,
    gateCount: guide.gates.length,
    authorityCount: guide.authorities.length,
    sourceCount: guide.sources.length,
    rulesReviewedAt: guide.rulesReviewedAt,
  })
);
