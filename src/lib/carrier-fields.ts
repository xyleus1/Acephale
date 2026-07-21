// Row/detail shapes + serializers for the carrier bench (client + server safe).
// Vocabulary and gate logic live in src/lib/carrier-vetting.ts.

import { CARRIER_VETTING_CHECKLIST } from "./carrier-vetting";

export type CarrierCapabilityBooleans = {
  airRide: boolean;
  liftgate: boolean;
  blanketWrap: boolean;
  teamDrivers: boolean;
  hazmatCertified: boolean;
  lithiumCapable: boolean;
  reeferCapable: boolean;
};

// [field, short badge code, full label] - badge codes keep the sheet column compact.
export const CARRIER_CAPABILITY_BADGES: Array<[keyof CarrierCapabilityBooleans, string, string]> = [
  ["airRide", "AR", "Air ride"],
  ["liftgate", "LG", "Liftgate"],
  ["blanketWrap", "BW", "Blanket wrap"],
  ["teamDrivers", "TM", "Team drivers"],
  ["hazmatCertified", "HZ", "Hazmat certified"],
  ["lithiumCapable", "LI", "Lithium UN3480/3481"],
  ["reeferCapable", "RF", "Reefer"],
];

export type CarrierBadge = { code: string; label: string };

export function carrierBadges(flags: CarrierCapabilityBooleans): CarrierBadge[] {
  return CARRIER_CAPABILITY_BADGES.filter(([field]) => flags[field]).map(([, code, label]) => ({ code, label }));
}

// One row of the carriers sheet, serialized for the client.
export type CarrierRow = {
  id: string;
  name: string;
  mcNumber: string | null;
  dotNumber: string | null;
  vettingStatus: string;
  badges: CarrierBadge[];
  cargoLimit: number | null;
  cargoInsuranceExpiry: string | null;
  homeBase: string | null;
  scorecardScore: number | null;
  loadsCompleted: number;
  active: boolean;
};

// The Prisma selection the sheet reads (kept in sync with SHEET_SELECT in the
// carriers actions/page).
export type CarrierSheetRecord = CarrierCapabilityBooleans & {
  id: string;
  name: string;
  mcNumber: string | null;
  dotNumber: string | null;
  vettingStatus: string;
  cargoLimit: number | null;
  cargoInsuranceExpiry: Date | null;
  homeBase: string | null;
  scorecardScore: number | null;
  loadsCompleted: number;
  active: boolean;
};

export function toCarrierRow(carrier: CarrierSheetRecord): CarrierRow {
  return {
    id: carrier.id,
    name: carrier.name,
    mcNumber: carrier.mcNumber,
    dotNumber: carrier.dotNumber,
    vettingStatus: carrier.vettingStatus,
    badges: carrierBadges(carrier),
    cargoLimit: carrier.cargoLimit,
    cargoInsuranceExpiry: carrier.cargoInsuranceExpiry ? carrier.cargoInsuranceExpiry.toISOString() : null,
    homeBase: carrier.homeBase,
    scorecardScore: carrier.scorecardScore,
    loadsCompleted: carrier.loadsCompleted,
    active: carrier.active,
  };
}

export type CarrierChecklistRow = {
  id: string;
  key: string;
  label: string;
  status: string;
  note: string | null;
  evidenceUrl: string | null;
  checkedAt: string | null;
};

// Full detail for /dashboard/carriers/[carrierId] - dates as ISO strings,
// Json columns as plain string arrays.
export type CarrierDetail = CarrierCapabilityBooleans & {
  id: string;
  name: string;
  legalName: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
  scac: string | null;
  dispatchEmail: string | null;
  dispatchPhone: string | null;
  verifiedPhone: string | null;
  emailDomain: string | null;
  emailDomainVerified: boolean;
  factoringCompany: string | null;
  authorityFirstActive: string | null;
  identityVerifiedAt: string | null;
  authorityStatus: string | null;
  insuranceProducer: string | null;
  autoLiabilityLimit: number | null;
  cargoLimit: number | null;
  autoInsuranceExpiry: string | null;
  cargoInsuranceExpiry: string | null;
  coiUrl: string | null;
  highValueApprovedLimit: number | null;
  equipmentTypes: string[];
  securityFeatures: string[];
  serviceStates: string[];
  homeBase: string | null;
  vettingStatus: string;
  vettingNotes: string | null;
  vettedAt: string | null;
  nextReviewAt: string | null;
  loadsCompleted: number;
  onTimePickupPct: number | null;
  onTimeDeliveryPct: number | null;
  claimCount: number;
  incidentCount: number;
  scorecardScore: number | null;
  scorecardAt: string | null;
  active: boolean;
  notes: string | null;
  checklist: CarrierChecklistRow[];
};

type ChecklistRecord = {
  id: string;
  key: string;
  label: string;
  status: string;
  note: string | null;
  evidenceUrl: string | null;
  checkedAt: Date | null;
};

export type CarrierDetailRecord = CarrierCapabilityBooleans & {
  id: string;
  name: string;
  legalName: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
  scac: string | null;
  dispatchEmail: string | null;
  dispatchPhone: string | null;
  verifiedPhone: string | null;
  emailDomain: string | null;
  emailDomainVerified: boolean;
  factoringCompany: string | null;
  authorityFirstActive: Date | null;
  identityVerifiedAt: Date | null;
  authorityStatus: string | null;
  insuranceProducer: string | null;
  autoLiabilityLimit: number | null;
  cargoLimit: number | null;
  autoInsuranceExpiry: Date | null;
  cargoInsuranceExpiry: Date | null;
  coiUrl: string | null;
  highValueApprovedLimit: number | null;
  equipmentTypes: unknown;
  securityFeatures: unknown;
  serviceStates: unknown;
  homeBase: string | null;
  vettingStatus: string;
  vettingNotes: string | null;
  vettedAt: Date | null;
  nextReviewAt: Date | null;
  loadsCompleted: number;
  onTimePickupPct: number | null;
  onTimeDeliveryPct: number | null;
  claimCount: number;
  incidentCount: number;
  scorecardScore: number | null;
  scorecardAt: Date | null;
  active: boolean;
  notes: string | null;
  checklist: ChecklistRecord[];
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// Checklist rows render in template order (unknown keys sink to the bottom).
const CHECKLIST_ORDER = new Map(CARRIER_VETTING_CHECKLIST.map((item, index) => [item.key, index]));

export function toCarrierDetail(carrier: CarrierDetailRecord): CarrierDetail {
  const checklist = [...carrier.checklist]
    .sort((a, b) => (CHECKLIST_ORDER.get(a.key) ?? 99) - (CHECKLIST_ORDER.get(b.key) ?? 99))
    .map((item) => ({
      id: item.id,
      key: item.key,
      label: item.label,
      status: item.status,
      note: item.note,
      evidenceUrl: item.evidenceUrl,
      checkedAt: iso(item.checkedAt),
    }));

  return {
    id: carrier.id,
    name: carrier.name,
    legalName: carrier.legalName,
    mcNumber: carrier.mcNumber,
    dotNumber: carrier.dotNumber,
    scac: carrier.scac,
    airRide: carrier.airRide,
    liftgate: carrier.liftgate,
    blanketWrap: carrier.blanketWrap,
    teamDrivers: carrier.teamDrivers,
    hazmatCertified: carrier.hazmatCertified,
    lithiumCapable: carrier.lithiumCapable,
    reeferCapable: carrier.reeferCapable,
    dispatchEmail: carrier.dispatchEmail,
    dispatchPhone: carrier.dispatchPhone,
    verifiedPhone: carrier.verifiedPhone,
    emailDomain: carrier.emailDomain,
    emailDomainVerified: carrier.emailDomainVerified,
    factoringCompany: carrier.factoringCompany,
    authorityFirstActive: iso(carrier.authorityFirstActive),
    identityVerifiedAt: iso(carrier.identityVerifiedAt),
    authorityStatus: carrier.authorityStatus,
    insuranceProducer: carrier.insuranceProducer,
    autoLiabilityLimit: carrier.autoLiabilityLimit,
    cargoLimit: carrier.cargoLimit,
    autoInsuranceExpiry: iso(carrier.autoInsuranceExpiry),
    cargoInsuranceExpiry: iso(carrier.cargoInsuranceExpiry),
    coiUrl: carrier.coiUrl,
    highValueApprovedLimit: carrier.highValueApprovedLimit,
    equipmentTypes: stringArray(carrier.equipmentTypes),
    securityFeatures: stringArray(carrier.securityFeatures),
    serviceStates: stringArray(carrier.serviceStates),
    homeBase: carrier.homeBase,
    vettingStatus: carrier.vettingStatus,
    vettingNotes: carrier.vettingNotes,
    vettedAt: iso(carrier.vettedAt),
    nextReviewAt: iso(carrier.nextReviewAt),
    loadsCompleted: carrier.loadsCompleted,
    onTimePickupPct: carrier.onTimePickupPct,
    onTimeDeliveryPct: carrier.onTimeDeliveryPct,
    claimCount: carrier.claimCount,
    incidentCount: carrier.incidentCount,
    scorecardScore: carrier.scorecardScore,
    scorecardAt: iso(carrier.scorecardAt),
    active: carrier.active,
    notes: carrier.notes,
    checklist,
  };
}

export function carrierRowFromDetail(detail: CarrierDetail): CarrierRow {
  return {
    id: detail.id,
    name: detail.name,
    mcNumber: detail.mcNumber,
    dotNumber: detail.dotNumber,
    vettingStatus: detail.vettingStatus,
    badges: carrierBadges(detail),
    cargoLimit: detail.cargoLimit,
    cargoInsuranceExpiry: detail.cargoInsuranceExpiry,
    homeBase: detail.homeBase,
    scorecardScore: detail.scorecardScore,
    loadsCompleted: detail.loadsCompleted,
    active: detail.active,
  };
}
