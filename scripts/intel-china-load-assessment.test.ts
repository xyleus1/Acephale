import {
  CHINA_IMPORT_AGENCY_FEATURES,
  EMPTY_CHINA_HARDWARE_LOAD_INPUT,
  assessChinaUsHardwareShipment,
  coerceChinaHardwareLoadInput,
  containsUnsafeChinaLoadConclusion,
  type ChinaHardwareLoadInputV1,
} from "../src/lib/intel/preflight/china-import";
import { buildChinaUsCustomsDecisionGuide } from "../src/lib/intel/research/china-customs-guide";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

const guide = buildChinaUsCustomsDecisionGuide();
const assessedAt = new Date("2026-07-27T19:15:00.000Z");

function cloneInput(): ChinaHardwareLoadInputV1 {
  return structuredClone(EMPTY_CHINA_HARDWARE_LOAD_INPUT);
}

function confirm(
  input: ChinaHardwareLoadInputV1,
  ...paths: string[]
): ChinaHardwareLoadInputV1 {
  for (const path of paths) {
    input.fieldProvenance[path] = {
      basis: "operator_confirmed",
      evidenceIds: [],
    };
  }
  return input;
}

function temporal(
  assessment: ReturnType<typeof assessChinaUsHardwareShipment>,
  ruleId: string
) {
  return assessment.timeSensitiveActions.find(
    (action) => action.ruleId === ruleId
  );
}

const empty = assessChinaUsHardwareShipment(
  EMPTY_CHINA_HARDWARE_LOAD_INPUT,
  guide,
  assessedAt
);
check(
  "empty input fails closed",
  empty.executiveDecision.state === "insufficient_input" &&
    empty.readiness.freightQuote === "insufficient_input" &&
    empty.readiness.landedCost === "not_assessable" &&
    empty.readiness.clearanceCommitment === "not_assessable"
);
check(
  "empty input keeps every product screen unresolved",
  empty.agencyScreens.every((screen) => screen.state === "unresolved")
);
check(
  "assessment uses the post-cutoff rules review",
  empty.rulesSnapshot.freshness === "current_for_assessment"
);
const preHfcSnapshot = structuredClone(guide);
preHfcSnapshot.rulesReviewedAt = "2026-07-24T23:48:00.000Z";
preHfcSnapshot.rulesAsOf = "2026-07-24";
preHfcSnapshot.rulesAsOfAt = "2026-07-24T23:48:00.000Z";
const afterDateOnlyBoundary = assessChinaUsHardwareShipment(
  EMPTY_CHINA_HARDWARE_LOAD_INPUT,
  preHfcSnapshot,
  assessedAt
);
check(
  "date-only regulatory boundaries invalidate an older rules snapshot",
  afterDateOnlyBoundary.rulesSnapshot.freshness ===
    "boundary_crossed_since_review"
);
check(
  "operator questions are role-labeled and preserve agency screens",
  empty.nextQuestions.every((question) =>
    /^(?:Mert|Supplier|Broker\/importer):/.test(question)
  ) &&
    empty.nextQuestions.some((question) => question.includes("FCC")) &&
    empty.nextQuestions.some((question) => question.includes("lithium")) &&
    empty.nextQuestions.some((question) => question.includes("UFLPA")) &&
    empty.nextQuestions.some((question) => question.includes("ISF"))
);
const referencedAuthorityIds = [
  ...new Set([
    ...empty.customsGates.flatMap((gate) => gate.authorityIds),
    ...empty.agencyScreens.flatMap((screen) => screen.authorityIds),
    ...empty.timeSensitiveActions.flatMap((action) => action.authorityIds),
  ]),
].sort();
check(
  "authority context exactly matches the assessment references",
  JSON.stringify(
    empty.authorities.map((authority) => authority.authorityId).sort()
  ) === JSON.stringify(referencedAuthorityIds) &&
    empty.authorities.every(
      (authority) =>
        authority.label.length > 0 &&
        authority.kind.length > 0 &&
        authority.status.length > 0 &&
        authority.caveat.length > 0 &&
        authority.source.sourceId.length > 0 &&
        authority.source.sourceUrl.startsWith("https://") &&
        "reviewedAt" in authority.source &&
        "asOf" in authority.source &&
        authority.claimContexts.length > 0
    )
);
check(
  "authority claim context identifies the deciding report sections",
  empty.authorities.some(
    (authority) =>
      authority.authorityId === "epa-hfc-reconsideration-2026" &&
      authority.status === "current" &&
      authority.effectiveFrom === "2026-07-27" &&
      authority.claimContexts.some(
        (claim) =>
          claim.kind === "agency_screen" &&
          claim.id === "refrigerant_equipment"
      ) &&
      authority.claimContexts.some(
        (claim) =>
          claim.kind === "temporal_action" &&
          claim.id === "epa-hfc-reconsideration-effective"
      )
  )
);

const airInput = cloneInput();
airInput.route.mode = "air";
airInput.product.description = "Industrial controller";
airInput.route.customsCountryOfOrigin = "China";
confirm(
  airInput,
  "product.description",
  "route.customsCountryOfOrigin"
);
const airAssessment = assessChinaUsHardwareShipment(
  airInput,
  guide,
  assessedAt
);
check(
  "explicit air input stays outside the ocean workflow",
  coerceChinaHardwareLoadInput(airInput).route.mode === "air" &&
    airAssessment.scope.supported === false &&
    airAssessment.scope.reasons.some((reason) =>
      reason.includes("ocean imports only")
    )
);

const aiNegative = cloneInput();
aiNegative.agencyScreens.rf_device = "no";
aiNegative.fieldProvenance["agencyScreens.rf_device"] = {
  basis: "ai_extracted",
  evidenceIds: [],
};
const aiNegativeAssessment = assessChinaUsHardwareShipment(
  aiNegative,
  guide,
  assessedAt
);
check(
  "AI-extracted no remains unresolved",
  aiNegativeAssessment.agencyScreens.find(
    (screen) => screen.featureId === "rf_device"
  )?.state === "unresolved"
);

const operatorNegative = cloneInput();
operatorNegative.agencyScreens.rf_device = "no";
confirm(operatorNegative, "agencyScreens.rf_device");
const operatorNegativeAssessment = assessChinaUsHardwareShipment(
  operatorNegative,
  guide,
  assessedAt
);
check(
  "operator-confirmed no can close one product screen",
  operatorNegativeAssessment.agencyScreens.find(
    (screen) => screen.featureId === "rf_device"
    )?.state === "not_indicated_by_confirmed_facts"
);

const unconfirmedBatteryClaim = cloneInput();
unconfirmedBatteryClaim.agencyScreens.lithium_battery = "yes";
unconfirmedBatteryClaim.product.marketingClaims = [
  "Includes a defective lithium battery",
];
confirm(
  unconfirmedBatteryClaim,
  "agencyScreens.lithium_battery"
);
unconfirmedBatteryClaim.fieldProvenance["product.marketingClaims"] = {
  basis: "ai_extracted",
  evidenceIds: [],
};
const unconfirmedBatteryAssessment = assessChinaUsHardwareShipment(
  unconfirmedBatteryClaim,
  guide,
  assessedAt
);
check(
  "unconfirmed battery damage claim cannot create a confirmed blocker",
  unconfirmedBatteryAssessment.executiveDecision.state !==
    "confirmed_operational_blocker"
);
confirm(unconfirmedBatteryClaim, "product.marketingClaims");
const confirmedBatteryAssessment = assessChinaUsHardwareShipment(
  unconfirmedBatteryClaim,
  guide,
  assessedAt
);
check(
  "confirmed battery damage claim creates the operational blocker",
  confirmedBatteryAssessment.executiveDecision.state ===
    "confirmed_operational_blocker"
);

const dateOnly = cloneInput();
dateOnly.timing.entryEvent = "entry_for_consumption";
dateOnly.timing.expectedEntryAt = "2026-07-24";
confirm(dateOnly, "timing.entryEvent", "timing.expectedEntryAt");
const dateOnlyAssessment = assessChinaUsHardwareShipment(
  dateOnly,
  guide,
  assessedAt
);
check(
  "date-only July 24 input remains indeterminate",
  temporal(dateOnlyAssessment, "ustr-forced-labor-301-effective")
    ?.temporalStateAtEntry === "indeterminate" &&
    dateOnlyAssessment.inputReview.boundaryAmbiguities.length === 1
);

const beforeCutoff = cloneInput();
beforeCutoff.timing.entryEvent = "entry_for_consumption";
beforeCutoff.timing.expectedEntryAt = "2026-07-24T04:00:59Z";
confirm(
  beforeCutoff,
  "timing.entryEvent",
  "timing.expectedEntryAt"
);
const beforeAssessment = assessChinaUsHardwareShipment(
  beforeCutoff,
  guide,
  assessedAt
);
check(
  "one second before cutoff keeps new USTR action upcoming",
  temporal(beforeAssessment, "ustr-forced-labor-301-effective")
    ?.temporalStateAtEntry === "upcoming"
);
check(
  "one second before cutoff keeps Section 122 active",
  temporal(beforeAssessment, "section-122-surcharge-2026")
    ?.temporalStateAtEntry === "active"
);

const atCutoff = cloneInput();
atCutoff.timing.entryEvent = "entry_for_consumption";
atCutoff.timing.expectedEntryAt = "2026-07-24T04:01:00Z";
atCutoff.route.customsCountryOfOrigin = "China";
confirm(
  atCutoff,
  "timing.entryEvent",
  "timing.expectedEntryAt",
  "route.customsCountryOfOrigin"
);
const atAssessment = assessChinaUsHardwareShipment(
  atCutoff,
  guide,
  assessedAt
);
check(
  "exact cutoff activates the new USTR action",
  temporal(atAssessment, "ustr-forced-labor-301-effective")
    ?.temporalStateAtEntry === "active"
);
check(
  "exact cutoff expires Section 122",
  temporal(atAssessment, "section-122-surcharge-2026")
    ?.temporalStateAtEntry === "expired"
);
check(
  "missing in-transit timestamps fail closed",
  temporal(atAssessment, "ustr-forced-labor-301-effective")
    ?.applicability === "exception_facts_incomplete"
);
check(
  "active action copy does not retain an upcoming label",
  !temporal(
    atAssessment,
    "ustr-forced-labor-301-effective"
  )?.action.includes("Upcoming")
);

const exceptionFacts = structuredClone(atCutoff);
exceptionFacts.timing.expectedEntryAt = "2026-07-27T12:00:00Z";
exceptionFacts.timing.loadedOnVesselAtPortOfLoadingAt =
  "2026-07-24T03:30:00Z";
exceptionFacts.timing.finalModeTransitStartedAt =
  "2026-07-24T03:45:00Z";
confirm(
  exceptionFacts,
  "timing.loadedOnVesselAtPortOfLoadingAt",
  "timing.finalModeTransitStartedAt"
);
const exceptionAssessment = assessChinaUsHardwareShipment(
  exceptionFacts,
  guide,
  assessedAt
);
check(
  "complete in-transit timing still requires authority review",
  temporal(exceptionAssessment, "ustr-forced-labor-301-effective")
    ?.applicability === "authority_review_required"
);

const exceptionEnd = structuredClone(exceptionFacts);
exceptionEnd.timing.expectedEntryAt = "2026-07-28T04:01:00Z";
const exceptionEndAssessment = assessChinaUsHardwareShipment(
  exceptionEnd,
  guide,
  assessedAt
);
check(
  "entry exactly at the exception end does not qualify for the exception review path",
  temporal(exceptionEndAssessment, "ustr-forced-labor-301-effective")
    ?.applicability === "potentially_applicable"
);

const afterException = structuredClone(atCutoff);
afterException.timing.expectedEntryAt = "2026-07-31T10:00:00-04:00";
const afterExceptionAssessment = assessChinaUsHardwareShipment(
  afterException,
  guide,
  assessedAt
);
check(
  "post-July 28 entry does not request expired in-transit exception facts",
  temporal(
    afterExceptionAssessment,
    "ustr-forced-labor-301-effective"
  )?.applicability === "potentially_applicable" &&
    !temporal(
      afterExceptionAssessment,
      "ustr-forced-labor-301-effective"
    )?.missingFacts.includes("Vessel loading time at port of loading")
);
check(
  "active EPA timing copy does not retain the older upcoming label",
  !temporal(
    afterExceptionAssessment,
    "epa-hfc-reconsideration-effective"
  )?.action.includes("Upcoming")
);
const fccPriorCoveredAction = temporal(
  afterExceptionAssessment,
  "fcc-prior-covered-equipment-import-effective"
);
check(
  "the July 16 FCC prohibition reaches the load timing review as current authority",
  fccPriorCoveredAction?.temporalStateAtEntry === "active" &&
    fccPriorCoveredAction.applicability === "authority_review_required" &&
    fccPriorCoveredAction.authorityIds.includes(
      "fcc-prior-covered-equipment-import-2026"
    ) &&
    fccPriorCoveredAction.sources.some((source) =>
      source.sourceUrl.includes("2026-13518")
    )
);
const productAdmissibilityGate = empty.customsGates.find(
  (gate) => gate.gateId === "product_admissibility"
);
check(
  "the load product gate carries both the current and adopted FCC actions",
  productAdmissibilityGate?.authorityIds.includes(
    "fcc-prior-covered-equipment-import-2026"
  ) === true &&
    productAdmissibilityGate.authorityIds.includes(
      "fcc-covered-components-order-2026"
    ) &&
    productAdmissibilityGate.sources.some(
      (source) =>
        source.sourceUrl ===
        "https://www.fcc.gov/document/fcc-adopts-rules-strengthen-rules-governing-dangerous-gear"
    )
);

const chinaFromVietnam = cloneInput();
chinaFromVietnam.route.countryOfExport = "Vietnam";
chinaFromVietnam.route.customsCountryOfOrigin = "China";
confirm(
  chinaFromVietnam,
  "route.countryOfExport",
  "route.customsCountryOfOrigin"
);
const chinaFromVietnamAssessment = assessChinaUsHardwareShipment(
  chinaFromVietnam,
  guide,
  assessedAt
);
check(
  "customs origin controls the China scope even when country of export differs",
  !chinaFromVietnamAssessment.scope.reasons.some((reason) =>
    reason.includes("China customs origin")
  )
);

const taiwan = cloneInput();
taiwan.route.customsCountryOfOrigin = "Taiwan, Province of China";
confirm(taiwan, "route.customsCountryOfOrigin");
const taiwanAssessment = assessChinaUsHardwareShipment(
  taiwan,
  guide,
  assessedAt
);
check(
  "Taiwan does not match China by substring",
  taiwanAssessment.scope.reasons.some((reason) =>
    reason.includes("China customs origin")
  )
);

const fdaDual = cloneInput();
fdaDual.agencyScreens.medical_device = "yes";
fdaDual.agencyScreens.radiation_emitting_product = "yes";
confirm(
  fdaDual,
  "agencyScreens.medical_device",
  "agencyScreens.radiation_emitting_product"
);
const fdaDualAssessment = assessChinaUsHardwareShipment(
  fdaDual,
  guide,
  assessedAt
);
check(
  "medical and radiation FDA branches trigger independently",
  fdaDualAssessment.agencyScreens.filter(
    (screen) => screen.agency === "FDA" && screen.state === "triggered"
  ).length === 2
);

const nrc = cloneInput();
nrc.agencyScreens.radioactive_or_nuclear_material = "yes";
confirm(nrc, "agencyScreens.radioactive_or_nuclear_material");
const nrcAssessment = assessChinaUsHardwareShipment(
  nrc,
  guide,
  assessedAt
);
const nrcScreen = nrcAssessment.agencyScreens.find(
  (screen) => screen.featureId === "radioactive_or_nuclear_material"
);
check(
  "radioactive equipment carries NRC and PHMSA authorities",
  nrcScreen?.state === "triggered" &&
    nrcScreen.authorityIds.includes("nrc-part-110-imports") &&
    nrcScreen.authorityIds.includes("phmsa-hmr-general")
);

check(
  "every gate and screen has claim-local sources",
  empty.customsGates.every(
    (gate) => gate.authorityIds.length > 0 && gate.sources.length > 0
  ) &&
    empty.agencyScreens.every(
      (screen) =>
        screen.authorityIds.length > 0 && screen.sources.length > 0
    )
);
check(
  "all twelve product features are represented",
  empty.agencyScreens.length === CHINA_IMPORT_AGENCY_FEATURES.length &&
    empty.agencyScreens.length === 12
);

const dirtyInput = coerceChinaHardwareLoadInput({
  route: { grossWeightKg: "0", customsCountryOfOrigin: " China " },
  timing: {
    expectedEntryAt: "2026-07-24T04:01:00",
    actualEntryAt: "2026-07-24T04:01:00Z",
  },
  agencyScreens: { rf_device: false, medical_device: "yes" },
});
check(
  "coercion rejects negative weight and timestamps without a timezone",
  dirtyInput.route.grossWeightKg === null &&
    dirtyInput.timing.expectedEntryAt === null &&
    dirtyInput.timing.actualEntryAt === "2026-07-24T04:01:00Z"
);
const dottedHts = coerceChinaHardwareLoadInput({
  product: { proposedHts10: "8517.62.0090" },
});
check(
  "coercion accepts and normalizes a dotted 10-digit HTS",
  dottedHts.product.proposedHts10 === "8517620090"
);

const lateIsf = cloneInput();
lateIsf.timing.loadedOnVesselAtPortOfLoadingAt =
  "2026-08-01T12:00:00+08:00";
lateIsf.oceanFiling.isfFiledAt = "2026-08-01T11:00:00+08:00";
lateIsf.oceanFiling.isfFiler = "Example filer";
lateIsf.oceanFiling.containerStuffingLocation = "Shenzhen";
lateIsf.oceanFiling.consolidator = "Example consolidator";
lateIsf.oceanFiling.invoiceAvailable = "yes";
lateIsf.oceanFiling.packingListAvailable = "yes";
lateIsf.oceanFiling.billOfLadingAvailable = "yes";
confirm(
  lateIsf,
  "timing.loadedOnVesselAtPortOfLoadingAt",
  "oceanFiling.isfFiledAt",
  "oceanFiling.isfFiler",
  "oceanFiling.containerStuffingLocation",
  "oceanFiling.consolidator",
  "oceanFiling.invoiceAvailable",
  "oceanFiling.packingListAvailable",
  "oceanFiling.billOfLadingAvailable"
);
const lateIsfGate = assessChinaUsHardwareShipment(
  lateIsf,
  guide,
  assessedAt
).customsGates.find((gate) => gate.gateId === "ocean_filing");
check(
  "late ISF filing cannot make the ocean filing gate ready",
  lateIsfGate?.state === "action_required" &&
    lateIsfGate.issues.some((issue) => issue.includes("less than 24 hours"))
);
check(
  "coercion preserves unknown instead of treating false as no",
  dirtyInput.agencyScreens.rf_device === "unknown"
);

check(
  "dangerous shipment conclusions are rejected by the guard",
  containsUnsafeChinaLoadConclusion("GO with actions") &&
    containsUnsafeChinaLoadConclusion("This shipment is cleared") &&
    containsUnsafeChinaLoadConclusion("Total duty is 37.5%") &&
    !containsUnsafeChinaLoadConclusion("Operator action required")
);

const deterministicOne = JSON.stringify(
  assessChinaUsHardwareShipment(exceptionFacts, guide, assessedAt)
);
const deterministicTwo = JSON.stringify(
  assessChinaUsHardwareShipment(exceptionFacts, guide, assessedAt)
);
check(
  "same input, guide, and assessment time produce identical JSON",
  deterministicOne === deterministicTwo
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log("\nAll China load assessment checks passed");
