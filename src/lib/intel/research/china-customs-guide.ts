import {
  dedupeIntelSourceUses,
  manualSourceUse,
  resolveIntelSourceUse,
  type IntelSourceUse,
} from "../sources";
import type { StartupHardwareCategory } from "./ocean-hardware";

export const CHINA_CUSTOMS_RULES_REVIEWED_AT =
  "2026-07-27T19:10:49.000Z";
export const CHINA_CUSTOMS_RULES_AS_OF = "2026-07-27";
export const CHINA_CUSTOMS_RULES_AS_OF_AT =
  "2026-07-27T19:10:49.000Z";

const PREVIOUS_CHINA_CUSTOMS_SOURCE_REVIEWED_AT =
  "2026-07-24T23:48:00.000Z";

export type CustomsAssessmentState =
  | "missing_input"
  | "conditional_screen"
  | "authority_review_required"
  | "reference_ready";

export type CustomsQuoteEffect =
  | "blocks_landed_cost"
  | "blocks_clearance_commitment"
  | "changes_duty"
  | "changes_timing"
  | "post_entry_control";

export type CustomsDecisionStage =
  | "before_quote"
  | "before_booking"
  | "before_loading"
  | "before_entry"
  | "after_release";

export type CustomsAuthorityKind =
  | "tariff_schedule"
  | "regulation"
  | "agency_action"
  | "agency_guidance"
  | "ruling_system"
  | "handbook";

export type CustomsAuthorityReference = {
  id: string;
  label: string;
  kind: CustomsAuthorityKind;
  status:
    | "current"
    | "historical_reference"
    | "time_limited"
    | "upcoming";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  publishedAt: string | null;
  documentRevisionDate: string | null;
  pageModifiedDate: string | null;
  caveat: string;
  source: IntelSourceUse;
};

export type ChinaCustomsCategoryTrigger = {
  categories: StartupHardwareCategory[];
  condition: string;
  requiredEvidence: string[];
  authorityIds: string[];
};

export type ChinaCustomsDecisionGate = {
  id:
    | "classification"
    | "origin_marking"
    | "valuation"
    | "tariff_stack"
    | "product_admissibility"
    | "forced_labor"
    | "importer_entry"
    | "ocean_filing";
  sequence: number;
  stage: CustomsDecisionStage;
  title: string;
  decisionQuestion: string;
  requiredInputs: string[];
  unresolvedEffect: string;
  operatorAction: string;
  assessmentState: CustomsAssessmentState;
  quoteEffects: CustomsQuoteEffect[];
  authorityIds: string[];
  categoryTriggers: ChinaCustomsCategoryTrigger[];
};

export type CustomsDocumentStage = {
  stage: CustomsDecisionStage;
  label: string;
  purpose: string;
  documents: string[];
  gateIds: ChinaCustomsDecisionGate["id"][];
};

export type ChinaCustomsRuleChange = {
  id: string;
  effectiveDate: string;
  effectiveAt: string | null;
  effectiveTo: string | null;
  effectiveToAt: string | null;
  effectiveToInclusive: boolean;
  affectedGateIds: ChinaCustomsDecisionGate["id"][];
  title: string;
  changedRule: string;
  operatorEffectAtReview: string;
  status: "current" | "historical_context" | "time_limited";
  temporalState: "active" | "upcoming" | "expired" | "historical";
  operatorAlertPriority: number | null;
  authorityIds: string[];
};

export type CustomsAuthorityPriority = {
  rank: 1 | 2 | 3 | 4;
  label: string;
  use: string;
};

export type ChinaCustomsDecisionGuide = {
  kind: "china_us_customs_decision_guide";
  originCountryCode: "5700";
  originCountryName: "China";
  destinationCountryCode: "US";
  mode: "ocean";
  rulesReviewedAt: string;
  rulesAsOf: string;
  rulesAsOfAt: string;
  readiness: {
    freightQuote: "requires_shipment_inputs";
    landedCost: "not_assessable";
    clearanceCommitment: "not_assessable";
  };
  authorityPriority: CustomsAuthorityPriority[];
  gates: ChinaCustomsDecisionGate[];
  documentStages: CustomsDocumentStage[];
  ruleChanges: ChinaCustomsRuleChange[];
  authorities: CustomsAuthorityReference[];
  sources: IntelSourceUse[];
  limitations: string[];
};

const reviewedSource = (
  sourceId: Parameters<typeof manualSourceUse>[0],
  sourceUrl: string,
  displayName: string,
  asOf: string | null = null,
  reviewedAt = PREVIOUS_CHINA_CUSTOMS_SOURCE_REVIEWED_AT
): IntelSourceUse => ({
  ...manualSourceUse(
    sourceId,
    sourceUrl,
    reviewedAt,
    asOf
  ),
  displayName,
});

type CustomsAuthorityInput = Omit<
  CustomsAuthorityReference,
  "publishedAt" | "documentRevisionDate" | "pageModifiedDate"
> &
  Partial<
    Pick<
      CustomsAuthorityReference,
      "publishedAt" | "documentRevisionDate" | "pageModifiedDate"
    >
  >;

const AUTHORITIES: CustomsAuthorityInput[] = [
  {
    id: "usitc-hts-current",
    label: "Current Harmonized Tariff Schedule",
    kind: "tariff_schedule",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: "2026-07-21",
    caveat:
      "Use the revision in force on the entry date. Revision 12 was released before USTR's July 23 final action, so do not assume it contains the later Chapter 99 instruction. The four-digit research basket is not an entry classification.",
    source: reviewedSource(
      "usitc_hts",
      "https://www.usitc.gov/2026_hts_revision_12",
      "2026 Harmonized Tariff Schedule Revision 12",
      "Released 2026-07-21",
      CHINA_CUSTOMS_RULES_REVIEWED_AT
    ),
  },
  {
    id: "cbp-cross",
    label: "CBP Customs Rulings Online Search System",
    kind: "ruling_system",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "A ruling applies to its stated facts. Search results are research inputs, not a substitute for a binding ruling on a different product.",
    source: reviewedSource(
      "cbp_cross",
      "https://rulings.cbp.gov/",
      "CBP CROSS classification and origin rulings"
    ),
  },
  {
    id: "cfr-origin-marking",
    label: "19 CFR Part 134, country of origin marking",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Origin and marking depend on the finished article and the relevant transformation facts, not merely the shipment country.",
    source: reviewedSource(
      "ecfr_customs",
      "https://www.ecfr.gov/current/title-19/chapter-I/part-134",
      "19 CFR Part 134",
      "Up to date through 2026-07-22"
    ),
  },
  {
    id: "cfr-customs-value",
    label: "19 CFR Part 152, classification and appraisement",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Transaction value may require additions and related-party analysis. Freight and insurance treatment must match the actual invoice and terms.",
    source: reviewedSource(
      "ecfr_customs",
      "https://www.ecfr.gov/current/title-19/chapter-I/part-152",
      "19 CFR Part 152",
      "Up to date through 2026-07-22"
    ),
  },
  {
    id: "cbp-importing-handbook",
    label: "CBP commercial importer handbook",
    kind: "handbook",
    status: "historical_reference",
    effectiveFrom: null,
    effectiveTo: null,
    documentRevisionDate: "2006",
    caveat:
      "Last revised in 2006. Use for process orientation and reasonable-care questions only, then verify every rule against current authority.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/sites/default/files/documents/Importing%20into%20the%20U.S.pdf",
      "Importing into the United States",
      "Last revision 2006"
    ),
  },
  {
    id: "cbp-reasonable-care",
    label: "CBP reasonable care guidance",
    kind: "handbook",
    status: "historical_reference",
    effectiveFrom: null,
    effectiveTo: null,
    documentRevisionDate: "2017-09",
    pageModifiedDate: "2026-01-07",
    caveat:
      "The checklist is advisory and fact-specific. Broker involvement does not remove the importer of record's responsibility.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/document/publications/reasonable-care",
      "CBP Reasonable Care",
      "Handbook revised 2017-09"
    ),
  },
  {
    id: "cbp-classification-handbook",
    label: "CBP tariff classification handbook",
    kind: "handbook",
    status: "historical_reference",
    effectiveFrom: null,
    effectiveTo: null,
    documentRevisionDate: "2004-05",
    caveat:
      "This handbook explains classification method as of its 2004 revision. Use the HTS edition in force on the entry date and current CBP rulings for an actual product.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/document/publications/tariff-classification",
      "CBP Tariff Classification handbook",
      "Handbook revised 2004-05"
    ),
  },
  {
    id: "cbp-customs-value-handbook",
    label: "CBP customs value handbook",
    kind: "handbook",
    status: "historical_reference",
    effectiveFrom: null,
    effectiveTo: null,
    documentRevisionDate: "2006-07",
    caveat:
      "This handbook explains valuation concepts as of its 2006 revision. Current 19 CFR Part 152 and shipment-specific transaction facts control the assessment.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/document/publications/customs-value",
      "CBP Customs Value handbook",
      "Handbook revised 2006-07"
    ),
  },
  {
    id: "cbp-entry-handbook",
    label: "CBP entry handbook",
    kind: "handbook",
    status: "historical_reference",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: "2004-03",
    caveat:
      "This handbook describes entry concepts as of its 2004 publication. Verify current entry, bond, broker, and partner-agency requirements before shipment.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/document/publications/entry",
      "CBP Entry handbook",
      "Handbook published 2004-03"
    ),
  },
  {
    id: "cbp-recordkeeping-handbook",
    label: "CBP recordkeeping handbook",
    kind: "handbook",
    status: "historical_reference",
    effectiveFrom: null,
    effectiveTo: null,
    documentRevisionDate: "2005-01",
    caveat:
      "This handbook reflects CBP guidance as of its 2005 revision. Confirm current recordkeeping rules and any longer agency-specific retention requirement.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/document/publications/recordkeeping",
      "CBP Recordkeeping handbook",
      "Handbook revised 2005-01"
    ),
  },
  {
    id: "cbp-import-basics",
    label: "CBP basic importing and exporting guidance",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Commodity-specific requirements can involve partner government agencies and must be resolved before a clearance commitment.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/trade/basic-import-export",
      "CBP basic importing and exporting"
    ),
  },
  {
    id: "ustr-section-301",
    label: "China Section 301 tariff actions",
    kind: "agency_action",
    status: "current",
    effectiveFrom: "2018-07-06",
    effectiveTo: null,
    caveat:
      "Section 301 is not a blanket rate for Chinese goods. Applicability follows exact origin, classification, entry date, Chapter 99 instructions, and any exclusion text.",
    source: reviewedSource(
      "ustr_china_tariffs",
      "https://ustr.gov/issue-areas/enforcement/section-301-investigations/tariff-actions",
      "USTR China Section 301 tariff actions"
    ),
  },
  {
    id: "ustr-301-exclusions-2026",
    label: "Time-limited Section 301 exclusions",
    kind: "agency_action",
    status: "time_limited",
    effectiveFrom: "2025-11-30",
    effectiveTo: "2026-11-09",
    publishedAt: "2025-12-01",
    caveat:
      "The extension covers 178 enumerated exclusions only, from 12:01 a.m. EST on November 30, 2025 through 11:59 p.m. EDT on November 9, 2026. Match the exact exclusion description and entry date before applying it.",
    source: reviewedSource(
      "ustr_china_tariffs",
      "https://www.govinfo.gov/content/pkg/FR-2025-12-01/pdf/2025-21671.pdf",
      "Federal Register notice extending 178 Section 301 exclusions",
      "Effective through 2026-11-09 23:59 EDT"
    ),
  },
  {
    id: "section-122-surcharge-2026",
    label: "Proclamation 11012 temporary Section 122 surcharge",
    kind: "agency_action",
    status: "time_limited",
    effectiveFrom: "2026-02-24",
    effectiveTo: "2026-07-24",
    publishedAt: "2026-02-25",
    caveat:
      "The published window ran from 12:01 a.m. EST on February 24, 2026 through 12:01 a.m. EDT on July 24, 2026 and expired at that cutoff. No official extension or replacement was found through the review timestamp. Enumerated product exemptions and the Section 232 interaction still require exact HTS review for pre-cutoff entries, and filing-time confirmation must check for any later amendment or replacement.",
    source: reviewedSource(
      "federal_register_tariff_actions",
      "https://www.federalregister.gov/documents/2026/02/25/2026-03824/imposing-a-temporary-import-surcharge-to-address-fundamental-international-payments-problems",
      "Proclamation 11012 temporary import surcharge",
      "Effective before 2026-07-24 00:01 EDT",
      CHINA_CUSTOMS_RULES_REVIEWED_AT
    ),
  },
  {
    id: "ustr-forced-labor-301-2026",
    label: "USTR forced-labor Section 301 final action",
    kind: "agency_action",
    status: "current",
    effectiveFrom: "2026-07-24",
    effectiveTo: null,
    publishedAt: "2026-07-23",
    caveat:
      "For products of China entered for consumption or withdrawn from warehouse at or after 12:01 a.m. EDT on July 24, 2026, the pre-publication notice establishes HTSUS 9903.05.31 at 12.5 percent, except for products described in HTSUS subheadings 9903.05.85 through 9903.05.92 under U.S. note 52 and the notice annexes. The in-transit exception requires goods to be loaded onto a vessel at the port of loading and in transit on the final mode of transit before that cutoff, then entered for consumption or withdrawn from warehouse for consumption before 12:01 a.m. EDT on July 28, 2026. Verify the filed Federal Register notice, current HTS revision, exact product exception, entry date, and transit facts before applying it.",
    source: reviewedSource(
      "ustr_china_tariffs",
      "https://ustr.gov/sites/default/files/files/Press/Releases/2026/FLIP%20301%20Investigation%20Final%20Action%20FRN%207-23-26%20FINAL.pdf",
      "USTR forced-labor Section 301 final action notice",
      "Published 2026-07-23; effective 2026-07-24 00:01 EDT",
      CHINA_CUSTOMS_RULES_REVIEWED_AT
    ),
  },
  {
    id: "cbp-section-301-faq",
    label: "CBP Section 301 filing guidance",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "CBP states that Section 301 follows country of origin, not country of export. Product exclusions require exact scope review.",
    source: reviewedSource(
      "cbp_importing_guide",
      "https://www.cbp.gov/trade/programs-administration/entry-summary/section-301-trade-remedies/faqs",
      "CBP Section 301 trade remedies FAQ",
      "Last modified 2025-04-14"
    ),
  },
  {
    id: "commerce-adcvd",
    label: "Commerce AD/CVD proceedings and scope resources",
    kind: "agency_action",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "AD/CVD scope can turn on written product descriptions and scope rulings, not an HTS number alone.",
    source: reviewedSource(
      "trade_adcvd",
      "https://www.trade.gov/us-antidumping-and-countervailing-duties-home-page",
      "Commerce AD/CVD proceedings"
    ),
  },
  {
    id: "dhs-uflpa-list",
    label: "DHS UFLPA Entity List",
    kind: "agency_action",
    status: "current",
    effectiveFrom: "2022-06-21",
    effectiveTo: null,
    caveat:
      "An entity-list screen is necessary but not sufficient. UFLPA also reaches goods mined, produced, or manufactured wholly or in part in Xinjiang.",
    source: reviewedSource(
      "dhs_uflpa",
      "https://www.dhs.gov/uflpa-entity-list",
      "DHS UFLPA Entity List"
    ),
  },
  {
    id: "cbp-forced-labor-faq",
    label: "CBP forced labor importer guidance",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Supply-chain tracing evidence must be shipment-specific. The aggregate China corridor report contains none of that evidence.",
    source: reviewedSource(
      "cbp_forced_labor",
      "https://www.cbp.gov/trade/forced-labor/frequently-asked-questions",
      "CBP forced labor FAQ",
      "Last modified 2025-02-04"
    ),
  },
  {
    id: "fcc-rf-import-conditions",
    label: "47 CFR 2.1204, RF device import conditions",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Section 2.1204 contains multiple import pathways with different effective histories. An FCC ID alone is not a complete screen. Confirm the applicable condition, authorization status, product model, quantity, labeling, and Covered List exposure.",
    source: reviewedSource(
      "fcc_equipment_authorization",
      "https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-2/subpart-K/section-2.1204",
      "47 CFR 2.1204",
      "Up to date through 2026-07-22"
    ),
  },
  {
    id: "fcc-presale-import-2022",
    label: "FCC pre-sale RF import condition effective-date rule",
    kind: "regulation",
    status: "current",
    effectiveFrom: "2022-04-12",
    effectiveTo: null,
    publishedAt: "2022-04-12",
    caveat:
      "The amendments to 47 CFR 2.1204(a)(11) became effective April 12, 2022. Apply the current codified quantity, testing, labeling, ownership, retrieval, and recordkeeping conditions rather than relying on the historical notice alone.",
    source: reviewedSource(
      "fcc_equipment_authorization",
      "https://www.govinfo.gov/content/pkg/FR-2022-04-12/pdf/2022-07607.pdf",
      "87 FR 21579, pre-sale RF import condition effective date",
      "Effective 2022-04-12"
    ),
  },
  {
    id: "fcc-covered-equipment-2025",
    label: "FCC covered-equipment authorization limitation rule",
    kind: "regulation",
    status: "current",
    effectiveFrom: "2025-12-26",
    effectiveTo: null,
    publishedAt: "2025-11-25",
    caveat:
      "The 2025 final rule revised 47 CFR 2.1204(a)(1) so a valid equipment authorization must not have been limited under 47 CFR 2.939(e). This is separate from the 2022 pre-sale pathway in paragraph (a)(11).",
    source: reviewedSource(
      "fcc_equipment_authorization",
      "https://www.govinfo.gov/content/pkg/FR-2025-11-25/pdf/2025-21001.pdf",
      "90 FR 53227, covered-equipment authorization limitation rule",
      "Published 2025-11-25; effective 2025-12-26"
    ),
  },
  {
    id: "fcc-prior-covered-equipment-import-2026",
    label: "FCC previously authorized covered-equipment import prohibition",
    kind: "agency_action",
    status: "current",
    effectiveFrom: "2026-07-16",
    effectiveTo: null,
    publishedAt: "2026-07-06",
    caveat:
      "Effective July 16, 2026, the FCC bureaus prohibited continued importation and marketing of previously authorized covered equipment added to the Covered List in 2024 or earlier. Continued use or operation is not prohibited, and the import conditions in 47 CFR 2.1204(a)(3) through (11) remain available. Use-based Hytera, Hikvision, and Dahua restrictions apply only to covered uses. At the July 27 review, the physical-security-surveillance restriction for critical infrastructure remained suspended because the FCC 26-50 definition was not yet effective. Verify the model, producer, Covered List addition date, authorization history, intended use, applicable import condition, and any later FCC action.",
    source: reviewedSource(
      "fcc_equipment_authorization",
      "https://www.govinfo.gov/content/pkg/FR-2026-07-06/pdf/2026-13518.pdf",
      "91 FR 41023, previously authorized covered-equipment prohibition",
      "Published 2026-07-06; effective 2026-07-16",
      CHINA_CUSTOMS_RULES_REVIEWED_AT
    ),
  },
  {
    id: "fcc-covered-components-order-2026",
    label: "FCC 26-50 logic-bearing hardware and marketplace order",
    kind: "agency_action",
    status: "upcoming",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: "2026-07-23",
    caveat:
      "FCC 26-50 was adopted July 22 and released July 23, 2026, but was not yet effective at the July 27 review because Federal Register publication had not occurred. Appendix A generally becomes effective 30 days after Federal Register publication, with later staged FCC ID display requirements. The order prospectively limits new authorizations for logic-bearing hardware components produced by producer/provider-based Covered List entities and devices incorporating those components, clarifies online-marketplace marketing duties, requires full certification for modifications by Covered List entities, and defines critical infrastructure. It does not automatically extend the component rule to production-location entries such as foreign-produced routers or UAS. Verify Federal Register publication and the exact effective date before applying the new rules.",
    source: reviewedSource(
      "fcc_equipment_authorization",
      "https://www.fcc.gov/document/fcc-adopts-rules-strengthen-rules-governing-dangerous-gear",
      "FCC 26-50 Third Report and Order",
      "Adopted 2026-07-22; released 2026-07-23; not yet effective",
      CHINA_CUSTOMS_RULES_REVIEWED_AT
    ),
  },
  {
    id: "fcc-covered-list",
    label: "FCC Covered List",
    kind: "agency_action",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    pageModifiedDate: "2026-07-07",
    caveat:
      "The reviewed July 7 list includes communications equipment, video surveillance equipment, foreign-produced routers, foreign-produced UAS and UAS critical components subject to stated exceptions, and covered services. The July 7 addition concerns Digitalsystem international telecommunications services, not a new hardware category. Recheck the live list, affiliates, and conditional approvals for the transaction date.",
    source: reviewedSource(
      "fcc_equipment_authorization",
      "https://www.fcc.gov/supplychain/coveredlist",
      "FCC Covered List, updated July 7, 2026",
      "Updated 2026-07-07",
      CHINA_CUSTOMS_RULES_REVIEWED_AT
    ),
  },
  {
    id: "fda-device-imports",
    label: "FDA medical device import requirements",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Intended use and device classification determine requirements. Verify establishment registration, listing, marketing authorization or exemption, labeling, and ACE data.",
    source: reviewedSource(
      "fda_device_imports",
      "https://www.fda.gov/medical-devices/importing-and-exporting-medical-devices/importing-medical-devices-and-radiation-emitting-electronic-products-us",
      "FDA medical device import guidance"
    ),
  },
  {
    id: "fda-radiation-ace-regulation",
    label: "21 CFR 1.77, radiation-product ACE declarations",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "For products subject to the radiation performance standards in 21 CFR parts 1020 through 1050, the ACE filer must submit the Form FDA 2877 declarations electronically at entry.",
    source: reviewedSource(
      "fda_device_imports",
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-1/subpart-D/section-1.77",
      "21 CFR 1.77, radiation-emitting electronic products",
      "Up to date through 2026-07-21"
    ),
  },
  {
    id: "fda-radiation-imports",
    label: "FDA radiation-emitting product import guidance",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Radiation-emitting electronic products may be medical or non-medical. All require the applicable radiation-safety review; medical products also require the separate medical-device review.",
    source: reviewedSource(
      "fda_device_imports",
      "https://www.fda.gov/industry/importing-fda-regulated-products/importing-radiation-emitting-electronic-products",
      "FDA radiation-emitting electronic product import guidance",
      "Reviewed 2026-07-23"
    ),
  },
  {
    id: "fda-qmsr-2026",
    label: "FDA Quality Management System Regulation",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: "2026-02-02",
    effectiveTo: null,
    caveat:
      "Relevant to covered medical device manufacturers. It does not establish that a product is a medical device or that an entry is admissible.",
    source: reviewedSource(
      "fda_device_imports",
      "https://www.fda.gov/medical-devices/postmarket-requirements-devices/quality-management-system-regulation-qmsr",
      "FDA Quality Management System Regulation",
      "Effective 2026-02-02"
    ),
  },
  {
    id: "fda-qmsr-regulation",
    label: "21 CFR Part 820, Quality Management System Regulation",
    kind: "regulation",
    status: "current",
    effectiveFrom: "2026-02-02",
    effectiveTo: null,
    caveat:
      "This regulation applies to covered device manufacturers. Product status, exemptions, registration, listing, authorization, labeling, and entry data remain separate screens.",
    source: reviewedSource(
      "ecfr_federal_regulations",
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-820",
      "21 CFR Part 820",
      "Current eCFR reviewed 2026-07-23"
    ),
  },
  {
    id: "cpsc-certificate-efiling",
    label: "CPSC certificates and eFiling",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: "2026-07-08",
    effectiveTo: null,
    caveat:
      "Applies only to imported consumer products subject to a CPSC certification requirement. Foreign Trade Zone entries have a later January 8, 2027 effective date.",
    source: reviewedSource(
      "cpsc_certificates",
      "https://www.cpsc.gov/Business--Manufacturing/Business-Education/Business-Guidance/Certificates",
      "CPSC certificates and eFiling",
      "Imported products effective 2026-07-08"
    ),
  },
  {
    id: "cpsc-certificate-regulation",
    label: "16 CFR Part 1110, certificates of compliance",
    kind: "regulation",
    status: "current",
    effectiveFrom: "2026-07-08",
    effectiveTo: null,
    caveat:
      "The revised rule applies only where a CPSC certification requirement exists. Foreign Trade Zone entries have a later January 8, 2027 effective date.",
    source: reviewedSource(
      "ecfr_federal_regulations",
      "https://www.ecfr.gov/current/title-16/chapter-II/subchapter-B/part-1110",
      "16 CFR Part 1110",
      "Current eCFR reviewed 2026-07-23"
    ),
  },
  {
    id: "phmsa-lithium-batteries",
    label: "PHMSA lithium battery transport requirements",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "This is a transport and booking screen, not a customs duty rule. Carrier and IMDG requirements may add stricter ocean conditions.",
    source: reviewedSource(
      "phmsa_lithium",
      "https://www.phmsa.dot.gov/lithiumbatteries",
      "PHMSA transporting lithium batteries"
    ),
  },
  {
    id: "phmsa-hmr-general",
    label: "49 CFR Part 173, hazardous materials shipment requirements",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Equipment can contain regulated gases, liquids, residues, aerosols, corrosives, or other hazardous materials. Classification and any exception depend on the material, quantity, configuration, packaging, and mode.",
    source: reviewedSource(
      "ecfr_federal_regulations",
      "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-C/part-173",
      "49 CFR Part 173",
      "Up to date through 2026-07-22"
    ),
  },
  {
    id: "phmsa-hmr-communication",
    label: "49 CFR Part 172, hazardous materials table and communication",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Use the current Hazardous Materials Table, special provisions, shipping-paper, marking, labeling, placarding, emergency-response, and training rules for the exact material and mode.",
    source: reviewedSource(
      "ecfr_federal_regulations",
      "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-C/part-172",
      "49 CFR Part 172",
      "Up to date through 2026-07-22"
    ),
  },
  {
    id: "phmsa-hmr-vessel",
    label: "49 CFR Part 176, vessel carriage of hazardous materials",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Vessel documentation, inspection, acceptance, stowage, segregation, and class-specific carriage depend on the exact material and shipment configuration.",
    source: reviewedSource(
      "ecfr_federal_regulations",
      "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-C/part-176",
      "49 CFR Part 176",
      "Up to date through 2026-07-22"
    ),
  },
  {
    id: "phmsa-refrigerating-machine-interpretation",
    label: "PHMSA Interpretation 24-0057",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: "2024-10-24",
    caveat:
      "The interpretation confirms a fact-specific, non-air exception for isolated refrigerating circuits containing no more than 12 kg of flammable, non-toxic gas. It does not exempt a different gas, charge, circuit, or mode.",
    source: reviewedSource(
      "phmsa_hazmat",
      "https://www.phmsa.dot.gov/regulations/title49/interp/24-0057",
      "PHMSA Interpretation 24-0057",
      "Published 2024-10-24"
    ),
  },
  {
    id: "nrc-part-110-imports",
    label: "10 CFR Part 110, nuclear equipment and material imports",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "NRC import authority depends on the exact equipment or material, isotope, form, quantity, destination, consignee authorization, and any general-license condition, exception, exclusion, or notification.",
    source: reviewedSource(
      "ecfr_federal_regulations",
      "https://www.ecfr.gov/current/title-10/chapter-I/part-110",
      "10 CFR Part 110",
      "Up to date through 2026-07-13"
    ),
  },
  {
    id: "nrc-import-license-guidance",
    label: "NRC export-import license types",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    pageModifiedDate: "2021-01-13",
    caveat:
      "Unless a transaction falls within a specific 10 CFR 110 exception, it requires an appropriate general or specific NRC license. This guide cannot determine the license from a product category.",
    source: reviewedSource(
      "nrc_imports",
      "https://www.nrc.gov/about-nrc/ip/export-import/license-types",
      "NRC export-import license types",
      "Last reviewed 2021-01-13"
    ),
  },
  {
    id: "epa-engine-imports",
    label: "EPA vehicle and engine import declarations",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Apply only when the shipment contains a covered vehicle, engine, or engine installed in equipment. The correct declaration, certificate, label, or exemption depends on product facts.",
    source: reviewedSource(
      "epa_imports",
      "https://www.epa.gov/importing-vehicles-and-engines/publications-and-forms-importing-vehicles-and-engines",
      "EPA vehicle and engine import forms"
    ),
  },
  {
    id: "epa-fifra-import-regulation",
    label: "19 CFR 12.110 through 12.117, pesticide and device imports",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "These import controls apply to FIFRA-regulated pesticides and devices, including hardware whose claims or function make it a pesticidal device. Product identity and claims must be resolved before entry.",
    source: reviewedSource(
      "ecfr_customs",
      "https://www.ecfr.gov/current/title-19/chapter-I/part-12/subpart-B",
      "19 CFR Part 12 Subpart B, pesticides and devices",
      "Current eCFR reviewed 2026-07-23"
    ),
  },
  {
    id: "epa-fifra-import-guidance",
    label: "EPA pesticide and pesticidal-device import guidance",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    pageModifiedDate: "2026-02-12",
    caveat:
      "All imported FIFRA pesticides and devices require a registered producing establishment and labeling that satisfies applicable requirements. An EPA Notice of Arrival on Form 3540-1 or its ACE equivalent is required before arrival. Registration or an exception is product-specific.",
    source: reviewedSource(
      "epa_imports",
      "https://www.epa.gov/compliance/importing-and-exporting-pesticides-and-devices",
      "EPA importing pesticides and devices guidance",
      "Last updated 2026-02-12"
    ),
  },
  {
    id: "epa-hfc-equipment-regulation",
    label: "40 CFR Part 84, HFC product and equipment controls",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Resolve the exact subsector, product versus field-assembled system versus component, refrigerant, GWP, charge, manufacturing date, and import date. Factory-charged equipment is not a bulk HFC import merely because it contains refrigerant.",
    source: reviewedSource(
      "epa_refrigerants",
      "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-84/subpart-B",
      "40 CFR Part 84 Subpart B, Technology Transitions",
      "Current eCFR reviewed 2026-07-23"
    ),
  },
  {
    id: "epa-ods-equipment-regulation",
    label: "40 CFR Part 82, ozone-depleting substance controls",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Use this branch for older or used equipment that may contain a CFC or HCFC, for required warning labels, or for actual bulk ODS. Do not apply bulk-substance controls automatically to refrigerant contained in equipment.",
    source: reviewedSource(
      "epa_refrigerants",
      "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-82",
      "40 CFR Part 82, ozone protection regulations",
      "Current eCFR reviewed 2026-07-23"
    ),
  },
  {
    id: "epa-hfc-reconsideration-2026",
    label: "EPA Technology Transitions reconsideration final rule",
    kind: "agency_action",
    status: "current",
    effectiveFrom: "2026-07-27",
    effectiveTo: null,
    publishedAt: "2026-05-26",
    caveat:
      "Effective July 27, 2026. Resolve the exact Part 84 subsector, equipment type, refrigerant, GWP, manufacturing date, import date, and installation facts. The Federal Register source gives an effective date, not an exact effective timestamp.",
    source: reviewedSource(
      "epa_refrigerants",
      "https://www.govinfo.gov/content/pkg/FR-2026-05-26/pdf/2026-10387.pdf",
      "EPA Technology Transitions reconsideration final rule",
      "Effective 2026-07-27",
      CHINA_CUSTOMS_RULES_REVIEWED_AT
    ),
  },
  {
    id: "doe-covered-products",
    label: "DOE conservation standards for importers",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Importer obligations apply only to covered products and equipment. Coverage, test procedure, standard, certification, and records must be resolved at the basic-model level.",
    source: reviewedSource(
      "doe_efficiency",
      "https://www.energy.gov/gc/conservation-standards-enforcement-importer-qas",
      "DOE conservation standards importer Q&A"
    ),
  },
  {
    id: "aphis-wood-packaging",
    label: "APHIS wood packaging material requirements",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    pageModifiedDate: "2026-06-03",
    caveat:
      "This screen applies to regulated solid wood packaging, not every pallet or crate material. Nonconforming packaging can prevent shipment entry even when the product itself is admissible.",
    source: reviewedSource(
      "aphis_wood_packaging",
      "https://www.aphis.usda.gov/plant-imports/wood-packaging-material/import",
      "APHIS ISPM 15 wood packaging import guidance"
    ),
  },
  {
    id: "cbp-isf-guidance",
    label: "CBP Importer Security Filing guidance",
    kind: "agency_guidance",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: "2025-11-04",
    caveat:
      "For covered U.S.-bound ocean cargo, most ISF data is due before vessel loading. Exact filing treatment belongs with the broker or filer.",
    source: reviewedSource(
      "cbp_import_security",
      "https://www.help.cbp.gov/s/article/Article-1868",
      "CBP Importer Security Filing timing",
      "Published 2025-11-04"
    ),
  },
  {
    id: "cfr-isf",
    label: "19 CFR Part 149, Importer Security Filing",
    kind: "regulation",
    status: "current",
    effectiveFrom: null,
    effectiveTo: null,
    caveat:
      "Use the current regulation for filing responsibility, timing, data elements, and exceptions.",
    source: reviewedSource(
      "ecfr_customs",
      "https://www.ecfr.gov/current/title-19/chapter-I/part-149",
      "19 CFR Part 149",
      "Up to date through 2026-07-22"
    ),
  },
];

const ALL_HARDWARE_CATEGORIES: StartupHardwareCategory[] = [
  "power_control",
  "factory_process",
  "compute_electronics",
  "medical_lab",
  "drones_aerospace",
];

const GATES: ChinaCustomsDecisionGate[] = [
  {
    id: "classification",
    sequence: 1,
    stage: "before_quote",
    title: "Product identity and 10-digit classification",
    decisionQuestion:
      "What exactly is the imported article, and which current 10-digit HTS provision fits its facts?",
    requiredInputs: [
      "Technical specification and principal function",
      "Materials and component breakdown",
      "Model, configuration, and intended use",
      "Proposed 10-digit HTS with classification rationale",
    ],
    unresolvedEffect:
      "Base duty, trade remedies, admissibility flags, and filing data cannot be calculated.",
    operatorAction:
      "Obtain the product packet, document the proposed classification, search relevant CROSS rulings, and escalate uncertainty for a binding ruling or customs specialist review.",
    assessmentState: "missing_input",
    quoteEffects: [
      "blocks_landed_cost",
      "blocks_clearance_commitment",
      "changes_duty",
    ],
    authorityIds: [
      "usitc-hts-current",
      "cbp-cross",
      "cbp-classification-handbook",
      "cbp-reasonable-care",
    ],
    categoryTriggers: [],
  },
  {
    id: "origin_marking",
    sequence: 2,
    stage: "before_quote",
    title: "Country of origin and marking",
    decisionQuestion:
      "Is China the customs country of origin for the finished article, and how must the article or container be marked?",
    requiredInputs: [
      "Manufacturing locations by component and operation",
      "Bill of materials and transformation steps",
      "Country-of-origin marking artwork and placement",
      "Any prior origin ruling or legal analysis",
    ],
    unresolvedEffect:
      "China-specific duties and origin marking treatment cannot be established from supplier location or country of export.",
    operatorAction:
      "Document the substantial-transformation basis, verify marking against 19 CFR Part 134, and keep the origin conclusion separate from shipment origin.",
    assessmentState: "missing_input",
    quoteEffects: [
      "blocks_landed_cost",
      "blocks_clearance_commitment",
      "changes_duty",
    ],
    authorityIds: [
      "cfr-origin-marking",
      "cbp-cross",
      "cbp-section-301-faq",
    ],
    categoryTriggers: [],
  },
  {
    id: "valuation",
    sequence: 3,
    stage: "before_quote",
    title: "Customs value",
    decisionQuestion:
      "What declared value method applies, and which additions or deductions are supported?",
    requiredInputs: [
      "Commercial invoice and currency",
      "Incoterm and international freight or insurance split",
      "Packing, assists, royalties, commissions, and proceeds",
      "Related-party status and transfer-pricing support",
    ],
    unresolvedEffect:
      "Duty, merchandise processing fee, harbor maintenance fee, and bond exposure cannot be quoted reliably.",
    operatorAction:
      "Reconcile the invoice to the actual sale and valuation additions, record every assumption, and have the broker validate the entry value basis.",
    assessmentState: "missing_input",
    quoteEffects: ["blocks_landed_cost", "changes_duty"],
    authorityIds: [
      "cfr-customs-value",
      "cbp-customs-value-handbook",
      "cbp-reasonable-care",
      "cbp-importing-handbook",
    ],
    categoryTriggers: [],
  },
  {
    id: "tariff_stack",
    sequence: 4,
    stage: "before_quote",
    title: "Full tariff and trade-remedy stack",
    decisionQuestion:
      "Which base rate, Chapter 99 action, Section 301 treatment, exclusion, and AD/CVD scope apply on the expected entry date?",
    requiredInputs: [
      "Validated 10-digit HTS classification",
      "Validated customs country of origin",
      "Expected entry or withdrawal date",
      "Exact exclusion language and AD/CVD scope facts",
    ],
    unresolvedEffect:
      "A landed-cost number would be fabricated. A four-digit Census category cannot determine the duty stack.",
    operatorAction:
      "Resolve the current HTS and Chapter 99 sequence, test any exclusion word for word, and complete a product-scope AD/CVD review before pricing duties.",
    assessmentState: "authority_review_required",
    quoteEffects: ["blocks_landed_cost", "changes_duty"],
    authorityIds: [
      "usitc-hts-current",
      "section-122-surcharge-2026",
      "ustr-forced-labor-301-2026",
      "ustr-section-301",
      "ustr-301-exclusions-2026",
      "commerce-adcvd",
    ],
    categoryTriggers: [],
  },
  {
    id: "product_admissibility",
    sequence: 5,
    stage: "before_booking",
    title: "Product admissibility and agency requirements",
    decisionQuestion:
      "Do the product, power source, material, engine, efficiency class, packaging, intended use, marketing claim, or customer market trigger a named agency or transport review?",
    requiredInputs: [
      "Intended use and marketing claims",
      "Radio, electronic-radiation, radioactive-source, laser, battery, engine, refrigerant, hazardous-material, pesticidal-claim, and consumer-use features",
      "Solid wood packaging, crate, and pallet construction",
      "Model-level authorizations, registrations, listings, and certificates",
      "Manufacturer and initial-importer identities",
    ],
    unresolvedEffect:
      "The product may be held, refused, or require additional ACE data even if the customs classification and duty are correct.",
    operatorAction:
      "Run feature-based agency screens, collect model-level evidence, and pass the resulting filing codes and certificates to the customs broker before booking.",
    assessmentState: "conditional_screen",
    quoteEffects: ["blocks_clearance_commitment", "changes_timing"],
    authorityIds: [
      "cbp-import-basics",
      "fcc-rf-import-conditions",
      "fcc-presale-import-2022",
      "fcc-covered-equipment-2025",
      "fcc-prior-covered-equipment-import-2026",
      "fcc-covered-components-order-2026",
      "fcc-covered-list",
      "fda-device-imports",
      "fda-radiation-ace-regulation",
      "fda-radiation-imports",
      "fda-qmsr-regulation",
      "cpsc-certificate-efiling",
      "cpsc-certificate-regulation",
      "phmsa-lithium-batteries",
      "phmsa-hmr-general",
      "phmsa-hmr-communication",
      "phmsa-hmr-vessel",
      "phmsa-refrigerating-machine-interpretation",
      "nrc-part-110-imports",
      "nrc-import-license-guidance",
      "epa-engine-imports",
      "epa-fifra-import-regulation",
      "epa-fifra-import-guidance",
      "epa-hfc-equipment-regulation",
      "epa-ods-equipment-regulation",
      "epa-hfc-reconsideration-2026",
      "doe-covered-products",
      "aphis-wood-packaging",
    ],
    categoryTriggers: [
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The finished product contains an intentional or unintentional radio-frequency device, router, video-surveillance function, UAS, or UAS component.",
        requiredEvidence: [
          "Applicable FCC import condition",
          "Equipment authorization status",
          "Covered List screen",
          "Producer and logic-bearing hardware component bill of materials for new or modified authorization",
          "Model, quantity, labeling, and consignee records",
        ],
        authorityIds: [
          "fcc-rf-import-conditions",
          "fcc-presale-import-2022",
          "fcc-covered-equipment-2025",
          "fcc-prior-covered-equipment-import-2026",
          "fcc-covered-components-order-2026",
          "fcc-covered-list",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The intended use makes the article a medical device or in vitro diagnostic.",
        requiredEvidence: [
          "FDA product code and device classification",
          "Registration and listing",
          "Marketing authorization or exemption",
          "Applicable affirmation-of-compliance codes",
        ],
        authorityIds: [
          "fda-device-imports",
          "fda-qmsr-regulation",
          "fda-qmsr-2026",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The product emits electronic radiation, whether it is medical or non-medical.",
        requiredEvidence: [
          "Radiation-emitting product type and model",
          "Applicable performance standard or documented no-standard basis",
          "Certification label and radiation-safety product report",
          "FDA accession number when applicable",
          "Form FDA 2877 declaration and ACE affirmation codes when applicable",
          "Separate medical-device evidence when the product is also a medical device",
        ],
        authorityIds: [
          "fda-radiation-ace-regulation",
          "fda-radiation-imports",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The finished article is a consumer product subject to a CPSC rule that requires certification.",
        requiredEvidence: [
          "Applicable product safety rule",
          "Children's Product Certificate or General Certificate of Conformity",
          "CPSC eFiling data for the imported entry",
        ],
        authorityIds: [
          "cpsc-certificate-regulation",
          "cpsc-certificate-efiling",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The shipment contains standalone lithium cells or batteries, batteries packed with equipment, or batteries contained in equipment.",
        requiredEvidence: [
          "Cell or battery chemistry, configuration, and rated energy",
          "UN 38.3 test summary",
          "Hazardous-material classification and exception basis",
          "Packaging, marks, labels, documents, and carrier acceptance",
          "Damaged, defective, recalled, prototype, and state-of-charge status",
        ],
        authorityIds: ["phmsa-lithium-batteries"],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The product contains or may retain a regulated refrigerant or compressed gas, fuel or oil residue, aerosol, corrosive, chemical, or another non-radioactive hazardous material.",
        requiredEvidence: [
          "Material identity, concentration, quantity, and location in the equipment",
          "Proper shipping name, UN identification number, hazard class, and packing group",
          "Applicable exception, special provision, or documented non-regulated basis",
          "Packaging, marks, labels, placards, and shipping-paper requirements",
          "Mode-specific requirements and ocean-carrier acceptance",
        ],
        authorityIds: [
          "phmsa-hmr-general",
          "phmsa-hmr-communication",
          "phmsa-hmr-vessel",
          "phmsa-refrigerating-machine-interpretation",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The product contains a radioactive source or nuclear material, or is nuclear equipment within NRC import authority.",
        requiredEvidence: [
          "Material or equipment identity, isotope, form, activity, quantity, and intended use",
          "NRC jurisdiction, exception, exclusion, or general or specific import-license basis",
          "U.S. consignee authorization to receive and possess the material",
          "Required NRC notifications, records, and license conditions",
          "Separate hazardous-material transport classification and carrier acceptance",
        ],
        authorityIds: [
          "nrc-part-110-imports",
          "nrc-import-license-guidance",
          "phmsa-hmr-general",
          "phmsa-hmr-communication",
          "phmsa-hmr-vessel",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The product is a vehicle, nonroad or stationary engine, generator, or equipment containing a covered engine.",
        requiredEvidence: [
          "Engine type, fuel, power, build date, and equipment application",
          "EPA certificate and emissions label, or exact exemption basis",
          "Applicable EPA declaration and ACE data",
        ],
        authorityIds: ["epa-engine-imports"],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The product or its marketing claims that it prevents, destroys, repels, disinfects, sanitizes, sterilizes, or mitigates a pest, pathogen, fungus, or other microorganism.",
        requiredEvidence: [
          "Pesticide, pesticidal-device, or outside-scope determination",
          "EPA registration number or exact registration exception when required",
          "EPA-registered foreign producing-establishment number",
          "Final product label and substantiated pesticidal claims",
          "EPA Notice of Arrival Form 3540-1 or ACE equivalent",
        ],
        authorityIds: [
          "epa-fifra-import-regulation",
          "epa-fifra-import-guidance",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The product may be covered consumer, commercial, or industrial equipment under DOE energy or water conservation standards.",
        requiredEvidence: [
          "DOE covered-product determination",
          "Basic model and applicable test procedure",
          "Current standard, certification, and underlying test data",
        ],
        authorityIds: ["doe-covered-products"],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The shipment contains air-conditioning, heat-pump, refrigeration, freezer, chiller, dehumidifier, ice-making, vending, refrigerated-transport, or similar equipment or components that contain or are designed for refrigerant.",
        requiredEvidence: [
          "Exact model, intended end use, and new or used status",
          "Product, field-assembled system, specified component, or bulk refrigerant determination",
          "Refrigerant identity, blend composition, GWP, and full charge",
          "Manufacturing and import dates plus applicable capacity or temperature facts",
          "Permanent and packaging labels, SNAP treatment, and manufacturer compliance evidence",
          "Allowance or exception basis only when the shipment is actually bulk refrigerant",
        ],
        authorityIds: [
          "epa-hfc-equipment-regulation",
          "epa-ods-equipment-regulation",
          "epa-hfc-reconsideration-2026",
        ],
      },
      {
        categories: ALL_HARDWARE_CATEGORIES,
        condition:
          "The shipment uses regulated solid wood pallets, crates, dunnage, or other wood packaging material.",
        requiredEvidence: [
          "Packaging material and construction statement",
          "Pest-free, debarked, and treatment evidence",
          "Legible ISPM 15 mark on each regulated wood packaging unit",
        ],
        authorityIds: ["aphis-wood-packaging"],
      },
    ],
  },
  {
    id: "forced_labor",
    sequence: 6,
    stage: "before_booking",
    title: "UFLPA and supply-chain traceability",
    decisionQuestion:
      "Can the importer trace the product and high-risk inputs through every relevant production tier and screen the current UFLPA sources?",
    requiredInputs: [
      "Supplier and sub-supplier legal identities",
      "Facility addresses and production records",
      "Bills of materials and material origin",
      "Purchase, payment, transport, and inventory chain",
    ],
    unresolvedEffect:
      "A clean entity-name search cannot support a clearance promise, and a detention response may require shipment-specific tracing evidence.",
    operatorAction:
      "Screen the current DHS list, map the supply chain beyond the direct seller, collect transaction and production evidence, and escalate high-risk sourcing before booking.",
    assessmentState: "missing_input",
    quoteEffects: ["blocks_clearance_commitment", "changes_timing"],
    authorityIds: ["dhs-uflpa-list", "cbp-forced-labor-faq"],
    categoryTriggers: [],
  },
  {
    id: "importer_entry",
    sequence: 7,
    stage: "before_booking",
    title: "Importer, broker, bond, and entry ownership",
    decisionQuestion:
      "Who is importer of record, who files the entry, and is the bond and power-of-attorney package ready?",
    requiredInputs: [
      "Importer-of-record legal identity and importer number",
      "Licensed broker and signed power of attorney",
      "Continuous or single-entry bond decision",
      "Incoterm, seller, buyer, consignee, and ultimate consignee",
    ],
    unresolvedEffect:
      "The shipment may have freight space but no accountable entry party or adequate bond.",
    operatorAction:
      "Confirm importer responsibility in writing, validate broker authority and bond sufficiency, and keep DDP commercial language aligned with the actual importer arrangement.",
    assessmentState: "missing_input",
    quoteEffects: ["blocks_clearance_commitment", "changes_timing"],
    authorityIds: [
      "cbp-import-basics",
      "cbp-entry-handbook",
      "cbp-importing-handbook",
    ],
    categoryTriggers: [],
  },
  {
    id: "ocean_filing",
    sequence: 8,
    stage: "before_loading",
    title: "Ocean filing, entry packet, and release",
    decisionQuestion:
      "Are the ISF data, commercial documents, entry data, and exception handling owners complete before their deadlines?",
    requiredInputs: [
      "Seller, buyer, importer, consignee, manufacturer, and ship-to party",
      "Country of origin and HTS data",
      "Container stuffing location and consolidator",
      "Invoice, packing list, bill of lading, arrival, and entry packet",
    ],
    unresolvedEffect:
      "Late or inaccurate filings can change timing, create damages exposure, and block an honest clearance estimate.",
    operatorAction:
      "Assign each ISF and entry data element to a named owner, transmit through the broker or filer on time, and track holds, exams, corrections, and post-entry records.",
    assessmentState: "missing_input",
    quoteEffects: [
      "blocks_clearance_commitment",
      "changes_timing",
      "post_entry_control",
    ],
    authorityIds: [
      "cbp-isf-guidance",
      "cfr-isf",
      "cbp-recordkeeping-handbook",
    ],
    categoryTriggers: [],
  },
];

const AUTHORITY_PRIORITY: CustomsAuthorityPriority[] = [
  {
    rank: 1,
    label: "Current controlling authority",
    use:
      "Start with the HTS, statutes, regulations, Federal Register actions, and enforceable agency orders effective on the expected entry date.",
  },
  {
    rank: 2,
    label: "Applicable ruling or scope decision",
    use:
      "Use a binding ruling or scope decision only for the facts, merchandise, and party treatment it actually covers.",
  },
  {
    rank: 3,
    label: "Current implementation guidance",
    use:
      "Use current agency instructions, lists, and FAQs to execute the review, but not as legal precedence over controlling authority.",
  },
  {
    rank: 4,
    label: "Handbook context",
    use:
      "Use legacy CBP handbooks to understand process, never to override current authority.",
  },
];

const DOCUMENT_STAGES: CustomsDocumentStage[] = [
  {
    stage: "before_quote",
    label: "Before landed-cost quote",
    purpose: "Prove the product, origin, value basis, and duty stack.",
    documents: [
      "Technical product and model specification",
      "Bill of materials and manufacturing-flow statement",
      "Proposed 10-digit HTS classification memo",
      "Origin and marking memo",
      "Commercial invoice assumptions and valuation additions",
      "Current tariff, exclusion, and AD/CVD scope review",
    ],
    gateIds: ["classification", "origin_marking", "valuation", "tariff_stack"],
  },
  {
    stage: "before_booking",
    label: "Before booking",
    purpose: "Confirm admissibility and accountable entry parties.",
    documents: [
      "PGA authorization, registration, listing, certificate, or exemption evidence",
      "Battery test summary, dangerous-goods classification, and carrier acceptance",
      "Engine, DOE covered-product, and wood-packaging evidence when triggered",
      "UFLPA supplier map and traceability packet",
      "Importer number, broker power of attorney, and bond confirmation",
      "Final Incoterm and importer-of-record responsibility",
    ],
    gateIds: ["product_admissibility", "forced_labor", "importer_entry"],
  },
  {
    stage: "before_loading",
    label: "Before vessel loading",
    purpose: "Complete the ocean security filing and commercial packet.",
    documents: [
      "Ten ISF importer data elements with named owners",
      "Container stuffing location and consolidator",
      "Commercial invoice and packing list",
      "Booking confirmation and bill-of-lading instructions",
    ],
    gateIds: ["ocean_filing"],
  },
  {
    stage: "after_release",
    label: "After release",
    purpose: "Preserve the evidence needed for corrections, liquidation, and audit.",
    documents: [
      "Entry summary and release messages",
      "Exam, hold, and agency correspondence",
      "Post-summary correction or protest decision",
      "Classification, value, origin, and admissibility record set",
    ],
    gateIds: [
      "classification",
      "origin_marking",
      "valuation",
      "tariff_stack",
      "product_admissibility",
      "forced_labor",
      "importer_entry",
      "ocean_filing",
    ],
  },
];

type ChinaCustomsRuleChangeInput = Omit<
  ChinaCustomsRuleChange,
  "temporalState" | "effectiveAt" | "effectiveToAt"
> &
  Partial<
    Pick<ChinaCustomsRuleChange, "effectiveAt" | "effectiveToAt">
  >;

const RULE_CHANGES: ChinaCustomsRuleChangeInput[] = [
  {
    id: "section-301-start",
    effectiveDate: "2018-07-06",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["origin_marking", "tariff_stack"],
    title: "China Section 301 actions began",
    changedRule:
      "Additional duties began applying to enumerated China-origin products through Chapter 99 actions and later modifications.",
    operatorEffectAtReview:
      "Do not use a blanket China percentage. Resolve exact origin, 10-digit HTS, Chapter 99 instructions, entry date, and exclusions.",
    status: "historical_context",
    operatorAlertPriority: null,
    authorityIds: ["ustr-section-301", "cbp-section-301-faq"],
  },
  {
    id: "fcc-presale-import-condition",
    effectiveDate: "2022-04-12",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["product_admissibility"],
    title: "FCC pre-sale RF import condition became effective",
    changedRule:
      "The limited pre-sale pathway in 47 CFR 2.1204(a)(11) became effective with testing, quantity, labeling, ownership, retrieval, and recordkeeping conditions.",
    operatorEffectAtReview:
      "Identify the exact current import condition and evidence package. Do not treat an expected FCC ID as authorization.",
    status: "current",
    operatorAlertPriority: null,
    authorityIds: ["fcc-presale-import-2022", "fcc-rf-import-conditions"],
  },
  {
    id: "uflpa-effective",
    effectiveDate: "2022-06-21",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["forced_labor"],
    title: "UFLPA rebuttable presumption took effect",
    changedRule:
      "Covered Xinjiang-linked goods and listed-entity goods are presumed prohibited unless the applicable legal standard is met.",
    operatorEffectAtReview:
      "Collect production-tier traceability before booking. A direct-supplier screen alone is not enough.",
    status: "current",
    operatorAlertPriority: null,
    authorityIds: ["dhs-uflpa-list", "cbp-forced-labor-faq"],
  },
  {
    id: "section-301-exclusions-2026",
    effectiveDate: "2025-11-30",
    effectiveAt: "2025-11-30T00:01:00-05:00",
    effectiveTo: "2026-11-09",
    effectiveToAt: "2026-11-09T23:59:59.999-04:00",
    effectiveToInclusive: true,
    affectedGateIds: ["tariff_stack"],
    title: "Certain Section 301 exclusions extended",
    changedRule:
      "USTR extended 178 enumerated exclusions through 11:59 p.m. EDT on November 9, 2026.",
    operatorEffectAtReview:
      "Treat the exclusion as time-limited and description-specific. Recheck at the expected entry date.",
    status: "time_limited",
    operatorAlertPriority: 3,
    authorityIds: ["ustr-301-exclusions-2026"],
  },
  {
    id: "fcc-covered-equipment-import-condition",
    effectiveDate: "2025-12-26",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["product_admissibility"],
    title: "FCC covered-equipment import condition changed",
    changedRule:
      "The FCC revised 47 CFR 2.1204(a)(1) so a valid equipment authorization must not have been limited through the covered-equipment procedures in 47 CFR 2.939(e).",
    operatorEffectAtReview:
      "Verify both the current authorization and whether an FCC limitation prohibits continued importation. Keep this separate from the pre-sale pathway in paragraph (a)(11).",
    status: "current",
    operatorAlertPriority: 7,
    authorityIds: [
      "fcc-covered-equipment-2025",
      "fcc-rf-import-conditions",
      "fcc-covered-list",
    ],
  },
  {
    id: "fda-qmsr-effective",
    effectiveDate: "2026-02-02",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["product_admissibility"],
    title: "FDA Quality Management System Regulation became effective",
    changedRule:
      "FDA's amended medical-device quality system requirements became effective for covered manufacturers.",
    operatorEffectAtReview:
      "For medical devices, verify the current manufacturer quality-system posture alongside registration, listing, authorization, labeling, and entry data.",
    status: "current",
    operatorAlertPriority: null,
    authorityIds: [
      "fda-qmsr-regulation",
      "fda-device-imports",
      "fda-qmsr-2026",
    ],
  },
  {
    id: "section-122-surcharge-2026",
    effectiveDate: "2026-02-24",
    effectiveAt: "2026-02-24T00:01:00-05:00",
    effectiveTo: "2026-07-24",
    effectiveToAt: "2026-07-24T00:01:00-04:00",
    effectiveToInclusive: false,
    affectedGateIds: ["tariff_stack"],
    title: "Temporary Section 122 import surcharge",
    changedRule:
      "Proclamation 11012 added a temporary import surcharge subject to enumerated product exemptions, goods-in-transit treatment, and interaction with Section 232 actions.",
    operatorEffectAtReview:
      "The action expired at its published 12:01 a.m. EDT July 24, 2026 cutoff. For a pre-cutoff entry, resolve the HTS provision, exemption list, entry timing, and Section 232 interaction. For an entry at or after the cutoff, do not apply this action unless later authority amended or replaced it, and confirm that filing-time result.",
    status: "time_limited",
    operatorAlertPriority: 2,
    authorityIds: ["section-122-surcharge-2026", "usitc-hts-current"],
  },
  {
    id: "cpsc-efiling-effective",
    effectiveDate: "2026-07-08",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["product_admissibility"],
    title: "CPSC certificate eFiling became effective",
    changedRule:
      "Importers of covered consumer products must electronically file required certificate data for general imported entries.",
    operatorEffectAtReview:
      "Determine whether a CPSC certification rule applies and place the certificate data into the entry workflow before shipment.",
    status: "current",
    operatorAlertPriority: 5,
    authorityIds: [
      "cpsc-certificate-regulation",
      "cpsc-certificate-efiling",
    ],
  },
  {
    id: "fcc-prior-covered-equipment-import-effective",
    effectiveDate: "2026-07-16",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["product_admissibility"],
    title: "FCC prior-authorized covered-equipment prohibition took effect",
    changedRule:
      "The FCC prohibited continued importation and marketing of previously authorized covered equipment added to the Covered List in 2024 or earlier, subject to the stated use limits and import-condition exceptions.",
    operatorEffectAtReview:
      "Active from July 16, 2026. Screen the exact model and producer, Covered List addition date, authorization history, intended use, and applicable 47 CFR 2.1204 import condition. Do not extend this action to equipment added after 2024 or treat it as a ban on continued possession or use.",
    status: "current",
    operatorAlertPriority: 6,
    authorityIds: [
      "fcc-prior-covered-equipment-import-2026",
      "fcc-covered-equipment-2025",
      "fcc-rf-import-conditions",
      "fcc-covered-list",
    ],
  },
  {
    id: "ustr-forced-labor-301-effective",
    effectiveDate: "2026-07-24",
    effectiveAt: "2026-07-24T00:01:00-04:00",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["tariff_stack"],
    title: "China forced-labor Section 301 action takes effect",
    changedRule:
      "USTR's July 23 final action adds a 12.5 percent Section 301 duty under HTSUS 9903.05.31 for products of China, except products described in HTSUS subheadings 9903.05.85 through 9903.05.92.",
    operatorEffectAtReview:
      "Active as of July 24, 2026. For an entry at or after 12:01 a.m. EDT on July 24, resolve HTSUS 9903.05.31, subheadings 9903.05.85 through 9903.05.92, U.S. note 52, and the current HTS revision. The in-transit exception requires goods to be loaded onto a vessel at the port of loading and in transit on the final mode before that cutoff, then entered for consumption or withdrawn from warehouse for consumption before 12:01 a.m. EDT on July 28.",
    status: "current",
    operatorAlertPriority: 1,
    authorityIds: [
      "ustr-forced-labor-301-2026",
      "usitc-hts-current",
    ],
  },
  {
    id: "epa-hfc-reconsideration-effective",
    effectiveDate: "2026-07-27",
    effectiveTo: null,
    effectiveToInclusive: false,
    affectedGateIds: ["product_admissibility"],
    title: "EPA HFC Technology Transitions reconsideration becomes effective",
    changedRule:
      "The final rule changes several refrigeration and air-conditioning provisions, including selected subsector, component, installation, and compliance schedules.",
    operatorEffectAtReview:
      "Active as of July 27, 2026. Re-resolve the exact Part 84 subsector rule for affected entries or installations. The source states an effective date but does not provide an exact effective timestamp.",
    status: "current",
    operatorAlertPriority: 4,
    authorityIds: [
      "epa-hfc-reconsideration-2026",
      "epa-hfc-equipment-regulation",
    ],
  },
];

const LIMITATIONS = [
  "This guide organizes research and document collection. It is not legal advice, a customs ruling, a broker filing instruction, or a compliance determination.",
  "The Census hardware basket uses four-digit and selected six-digit groups. It cannot establish a shipment's 10-digit HTS classification, duty, trade remedy, agency jurisdiction, or admissibility.",
  "Rules and tariff actions can change after the review timestamp. Recheck effective authority for the expected entry date before quoting landed cost or clearance.",
  "Historical and handbook references explain process or change over time. They never override the current HTS, regulations, agency actions, or shipment-specific rulings.",
  "BIS export controls are not treated as U.S. import duties in this guide. Separate export-control, sanctions, and end-use reviews may still be required for the broader transaction.",
] as const;

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
}

function assertIsoInstant(value: string, label: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} must be an ISO timestamp with a time zone`);
  }
}

function assertDatePrecision(value: string, label: string): void {
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) {
    throw new Error(`${label} must use YYYY, YYYY-MM, or YYYY-MM-DD`);
  }
}

const SHIPMENT_DUTY_CONCLUSION_PATTERN =
  /\b(?:(?:estimated|recommended|landed|total|shipment|your)\s+(?:import\s+)?dut(?:y|ies)|dut(?:y|ies)\s+for\s+(?:this|the)\s+shipment)(?:\s+(?:rate|amount))?\s*(?::|=|\bis\b|\bare\b|\bwill be\b)?\s*(?:\$\s*\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:,\d{3})*(?:\.\d+)?\s*(?:%|percent\b|dollars?\b))/i;

export function containsShipmentDutyConclusion(value: string): boolean {
  return SHIPMENT_DUTY_CONCLUSION_PATTERN.test(value);
}

export function resolveCustomsRuleTemporalState(
  change: Pick<
    ChinaCustomsRuleChange,
    "effectiveDate" | "effectiveTo" | "effectiveToInclusive" | "status"
  > &
    Partial<
      Pick<ChinaCustomsRuleChange, "effectiveAt" | "effectiveToAt">
    >,
  rulesAsOf: string
): ChinaCustomsRuleChange["temporalState"] {
  const usesExactInstant = rulesAsOf.includes("T");
  if (usesExactInstant) {
    assertIsoInstant(rulesAsOf, "China customs rules as-of instant");
  } else {
    assertIsoDate(rulesAsOf, "China customs rules as-of date");
  }
  if (change.status === "historical_context") return "historical";
  if (usesExactInstant && change.effectiveAt) {
    assertIsoInstant(change.effectiveAt, `${change.effectiveDate} effective instant`);
    if (Date.parse(rulesAsOf) < Date.parse(change.effectiveAt)) return "upcoming";
  } else {
    const comparisonDate = usesExactInstant
      ? new Date(rulesAsOf).toISOString().slice(0, 10)
      : rulesAsOf;
    if (comparisonDate < change.effectiveDate) return "upcoming";
  }
  if (usesExactInstant && change.effectiveToAt) {
    assertIsoInstant(
      change.effectiveToAt,
      `${change.effectiveTo ?? change.effectiveDate} end instant`
    );
    const comparison = Date.parse(rulesAsOf);
    const boundary = Date.parse(change.effectiveToAt);
    if (
      change.effectiveToInclusive
        ? comparison > boundary
        : comparison >= boundary
    ) {
      return "expired";
    }
    return "active";
  }
  const comparisonDate = usesExactInstant
    ? new Date(rulesAsOf).toISOString().slice(0, 10)
    : rulesAsOf;
  if (
    change.effectiveTo &&
    (change.effectiveToInclusive
      ? comparisonDate > change.effectiveTo
      : comparisonDate >= change.effectiveTo)
  ) {
    return "expired";
  }
  return "active";
}

function validateGuide(
  guide: ChinaCustomsDecisionGuide
): ChinaCustomsDecisionGuide {
  assertIsoDate(guide.rulesAsOf, "China customs rules as-of date");
  assertIsoInstant(guide.rulesAsOfAt, "China customs rules as-of instant");
  assertIsoInstant(guide.rulesReviewedAt, "China customs rules review timestamp");
  const authorityIds = new Set(guide.authorities.map((authority) => authority.id));
  if (authorityIds.size !== guide.authorities.length) {
    throw new Error("China customs guide has duplicate authority IDs");
  }
  for (const authority of guide.authorities) {
    resolveIntelSourceUse(authority.source);
    if (authority.effectiveFrom) {
      assertIsoDate(authority.effectiveFrom, authority.id);
    }
    if (authority.effectiveTo) {
      assertIsoDate(authority.effectiveTo, authority.id);
    }
    if (
      authority.effectiveFrom &&
      authority.effectiveTo &&
      authority.effectiveFrom > authority.effectiveTo
    ) {
      throw new Error(`${authority.id} has an inverted effective range`);
    }
    if (
      authority.status === "upcoming" &&
      authority.effectiveFrom &&
      authority.effectiveFrom <= guide.rulesAsOf
    ) {
      throw new Error(
        `${authority.id} must begin after the customs rules as-of date`
      );
    }
    if (authority.status === "time_limited" && !authority.effectiveTo) {
      throw new Error(`${authority.id} needs a time-limited end date`);
    }
    if (authority.publishedAt) {
      assertDatePrecision(authority.publishedAt, `${authority.id} publication`);
    }
    if (authority.documentRevisionDate) {
      assertDatePrecision(
        authority.documentRevisionDate,
        `${authority.id} document revision`
      );
    }
    if (authority.pageModifiedDate) {
      assertIsoDate(
        authority.pageModifiedDate,
        `${authority.id} page modification`
      );
    }
  }
  const gateIds = new Set<ChinaCustomsDecisionGate["id"]>();
  if (
    guide.authorityPriority.length !== 4 ||
    guide.authorityPriority.some(
      (priority, index) => priority.rank !== index + 1
    )
  ) {
    throw new Error("China customs authority priority must be complete and ordered");
  }
  for (const [index, gate] of guide.gates.entries()) {
    if (gate.sequence !== index + 1 || gateIds.has(gate.id)) {
      throw new Error("China customs guide gates must be unique and ordered");
    }
    gateIds.add(gate.id);
    if (
      gate.requiredInputs.length === 0 ||
      gate.operatorAction.trim().length === 0 ||
      gate.authorityIds.length === 0
    ) {
      throw new Error(`China customs gate ${gate.id} is incomplete`);
    }
    for (const authorityId of gate.authorityIds) {
      if (!authorityIds.has(authorityId)) {
        throw new Error(
          `China customs gate ${gate.id} has unknown authority ${authorityId}`
        );
      }
    }
    for (const trigger of gate.categoryTriggers) {
      if (trigger.categories.length === 0 || trigger.requiredEvidence.length === 0) {
        throw new Error(`China customs gate ${gate.id} has an empty category trigger`);
      }
      for (const authorityId of trigger.authorityIds) {
        if (!authorityIds.has(authorityId)) {
          throw new Error(
            `China customs trigger ${gate.id} has unknown authority ${authorityId}`
          );
        }
      }
    }
  }
  for (const stage of guide.documentStages) {
    if (stage.gateIds.length === 0 || stage.documents.length === 0) {
      throw new Error(`China customs document stage ${stage.stage} is incomplete`);
    }
    for (const gateId of stage.gateIds) {
      if (!gateIds.has(gateId)) {
        throw new Error(
          `China customs document stage ${stage.stage} has unknown gate ${gateId}`
        );
      }
    }
  }
  const ruleChangeIds = new Set<string>();
  const operatorAlertPriorities = new Set<number>();
  let priorEffectiveDate: string | null = null;
  for (const change of guide.ruleChanges) {
    if (ruleChangeIds.has(change.id)) {
      throw new Error(`China customs rule change ${change.id} is duplicated`);
    }
    ruleChangeIds.add(change.id);
    if (change.operatorAlertPriority != null) {
      if (
        !Number.isInteger(change.operatorAlertPriority) ||
        change.operatorAlertPriority <= 0 ||
        operatorAlertPriorities.has(change.operatorAlertPriority)
      ) {
        throw new Error(
          `China customs rule change ${change.id} has an invalid alert priority`
        );
      }
      operatorAlertPriorities.add(change.operatorAlertPriority);
    }
    assertIsoDate(change.effectiveDate, change.id);
    if (change.effectiveTo) assertIsoDate(change.effectiveTo, change.id);
    if (change.effectiveAt) {
      assertIsoInstant(change.effectiveAt, `${change.id} effective instant`);
      if (!change.effectiveAt.startsWith(change.effectiveDate)) {
        throw new Error(
          `${change.id} effective date and exact instant must use the same stated date`
        );
      }
    }
    if (change.effectiveToAt) {
      assertIsoInstant(change.effectiveToAt, `${change.id} end instant`);
      if (
        !change.effectiveTo ||
        !change.effectiveToAt.startsWith(change.effectiveTo)
      ) {
        throw new Error(
          `${change.id} end date and exact instant must use the same stated date`
        );
      }
    }
    if (
      change.effectiveTo &&
      change.effectiveDate > change.effectiveTo
    ) {
      throw new Error(`China customs rule change ${change.id} has an inverted range`);
    }
    if (change.status === "time_limited" && !change.effectiveTo) {
      throw new Error(`China customs rule change ${change.id} lacks an end date`);
    }
    if (
      change.temporalState !==
      resolveCustomsRuleTemporalState(change, guide.rulesAsOfAt)
    ) {
      throw new Error(`China customs rule change ${change.id} has a stale temporal state`);
    }
    if (priorEffectiveDate && change.effectiveDate < priorEffectiveDate) {
      throw new Error("China customs rule changes must be chronological");
    }
    priorEffectiveDate = change.effectiveDate;
    for (const gateId of change.affectedGateIds) {
      if (!gateIds.has(gateId)) {
        throw new Error(
          `China customs rule change ${change.id} has unknown gate ${gateId}`
        );
      }
    }
    for (const authorityId of change.authorityIds) {
      if (!authorityIds.has(authorityId)) {
        throw new Error(
          `China customs rule change ${change.id} has unknown authority ${authorityId}`
        );
      }
    }
  }
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
  if (containsShipmentDutyConclusion(operationalCopy)) {
    throw new Error(
      "China customs operational copy contains a shipment-level duty conclusion"
    );
  }
  return guide;
}

export function buildChinaUsCustomsDecisionGuide(): ChinaCustomsDecisionGuide {
  const authorities = AUTHORITIES.map((authority) => ({
    ...authority,
    publishedAt: authority.publishedAt ?? null,
    documentRevisionDate: authority.documentRevisionDate ?? null,
    pageModifiedDate: authority.pageModifiedDate ?? null,
    source: { ...authority.source },
  }));
  const ruleChanges: ChinaCustomsRuleChange[] = RULE_CHANGES.map((change) => {
    const normalizedChange = {
      ...change,
      effectiveAt: change.effectiveAt ?? null,
      effectiveToAt: change.effectiveToAt ?? null,
    };
    return {
      ...normalizedChange,
      temporalState: resolveCustomsRuleTemporalState(
        normalizedChange,
        CHINA_CUSTOMS_RULES_AS_OF_AT
      ),
      affectedGateIds: [...normalizedChange.affectedGateIds],
      authorityIds: [...normalizedChange.authorityIds],
    };
  });
  return validateGuide({
    kind: "china_us_customs_decision_guide",
    originCountryCode: "5700",
    originCountryName: "China",
    destinationCountryCode: "US",
    mode: "ocean",
    rulesReviewedAt: CHINA_CUSTOMS_RULES_REVIEWED_AT,
    rulesAsOf: CHINA_CUSTOMS_RULES_AS_OF,
    rulesAsOfAt: CHINA_CUSTOMS_RULES_AS_OF_AT,
    readiness: {
      freightQuote: "requires_shipment_inputs",
      landedCost: "not_assessable",
      clearanceCommitment: "not_assessable",
    },
    authorityPriority: AUTHORITY_PRIORITY.map((priority) => ({
      ...priority,
    })),
    gates: GATES.map((gate) => ({
      ...gate,
      requiredInputs: [...gate.requiredInputs],
      quoteEffects: [...gate.quoteEffects],
      authorityIds: [...gate.authorityIds],
      categoryTriggers: gate.categoryTriggers.map((trigger) => ({
        ...trigger,
        categories: [...trigger.categories],
        requiredEvidence: [...trigger.requiredEvidence],
        authorityIds: [...trigger.authorityIds],
      })),
    })),
    documentStages: DOCUMENT_STAGES.map((stage) => ({
      ...stage,
      documents: [...stage.documents],
      gateIds: [...stage.gateIds],
    })),
    ruleChanges,
    authorities,
    sources: dedupeIntelSourceUses(
      authorities.map((authority) => authority.source)
    ),
    limitations: [...LIMITATIONS],
  });
}
