// Load pre-flight: run a load idea through deterministic customs / compliance /
// insurance / security / equipment / capacity rules and get back what breaks
// ("blocker"), what likely breaks without action ("risk"), and what to keep an
// eye on ("watch") - each with the action to take. Pure domain logic, no LLM,
// no DB: the AI is only used upstream to parse free text into a LoadIdea
// (src/lib/load-check-extract.ts), and the carrier bench is passed in.
//
// Severity is honest, not alarmist: a finding must name the rule or failure
// mode it comes from. These are operator decision aids, not legal advice -
// the "action" is always "verify with the authority that owns the rule".

import { classifyDomesticLocation } from "@/lib/domestic-trucking-pricing";
import { deriveSecurityTier, tierRank, type SecurityTier } from "@/lib/security-sop";

export type LoadIdea = {
  description: string | null;
  commodityCategory: string | null; // COMMODITY_CATEGORY_VALUES from security-sop
  origin: string | null;
  destination: string | null;
  declaredValue: number | null; // USD
  weightLbs: number | null; // cargo weight
  equipmentType: string | null; // DRY_VAN / REEFER / FLATBED / STEP_DECK / BOX_TRUCK / CONTAINER_DRAYAGE
  temperatureSensitive: boolean;
  inboundInternational: boolean; // load starts as an international import leg
  originCountry: string | null; // when inbound, e.g. "China"
  exportBound: boolean; // continues to export after the US leg
  defenseOrSpace: boolean;
  batteriesDamagedOrRecalled: boolean;
  pickupDate: string | null; // YYYY-MM-DD
  transitDays: number | null; // promised door-to-door days for the US truck leg
};

export const EMPTY_LOAD_IDEA: LoadIdea = {
  description: null,
  commodityCategory: null,
  origin: null,
  destination: null,
  declaredValue: null,
  weightLbs: null,
  equipmentType: null,
  temperatureSensitive: false,
  inboundInternational: false,
  originCountry: null,
  exportBound: false,
  defenseOrSpace: false,
  batteriesDamagedOrRecalled: false,
  pickupDate: null,
  transitDays: null,
};

export type CheckSeverity = "blocker" | "risk" | "watch";

export type CheckDomain =
  | "hazmat"
  | "export"
  | "customs"
  | "insurance"
  | "security"
  | "california"
  | "equipment"
  | "capacity"
  | "carrier"
  | "operating";

export type CheckFinding = {
  id: string;
  severity: CheckSeverity;
  domain: CheckDomain;
  title: string;
  detail: string;
  action: string;
};

// Slimmed carrier shape the matcher needs - built from the bench in the action.
export type BenchCarrier = {
  id: string;
  name: string;
  dotNumber: string | null;
  hazmatCertified: boolean;
  lithiumCapable: boolean;
  teamDrivers: boolean;
  airRide: boolean;
  reeferCapable: boolean;
  equipmentTypes: string[];
  serviceStates: string[];
  cargoLimit: number | null;
  cargoInsuranceExpiry: string | null;
};

export type CarrierRequirement = { key: string; label: string };

export type CarrierMatchResult = {
  requirements: CarrierRequirement[];
  matched: Array<{ id: string; name: string; dotNumber: string | null }>;
  approvedOnBench: number;
};

export type LoadCheckResult = {
  securityTier: SecurityTier | null;
  originState: string | null;
  destState: string | null;
  estimatedMiles: number | null;
  findings: CheckFinding[];
  carrierMatch: CarrierMatchResult;
  // Cited numbers from live sources (duty rates, rulings, insurance filings) -
  // filled by src/lib/load-check-enrich.ts after the pure check runs.
  facts: string[];
};

const BATTERY_CATEGORIES = ["batteries_un3480", "batteries_un3481"];
const FRAGILE_TECH = ["servers_gpu", "semicap_tools", "networking", "test_instruments", "medical_devices", "robotics"];
const TECH_CATEGORIES = [...FRAGILE_TECH, "batteries_un3480", "batteries_un3481", "consumer_electronics", "other_tech"];

// HOS reality: a solo driver covers ~500-550 road miles/day sustainably.
export const SOLO_MILES_PER_DAY = 550;
export const TEAM_MILES_PER_DAY = 1000;

const EARTH_RADIUS_MILES = 3958.8;
// State-centroid great-circle distance underestimates road miles.
const ROAD_FACTOR = 1.18;

export function estimateMiles(
  a: { lat: number | null; lon: number | null },
  b: { lat: number | null; lon: number | null }
): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  const gc = 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
  return Math.round(gc * ROAD_FACTOR);
}

function isChina(country: string | null): boolean {
  if (!country) return false;
  const c = country.toLowerCase();
  // "Taiwan, Province of China" and similar must NOT trigger the China rules.
  if (c.includes("taiwan")) return false;
  return c.includes("china") || /\bprc\b/.test(c) || /\bcn\b/.test(c);
}

// Fixed-date holiday windows when organized theft spikes (long unattended
// weekends). Month is 1-based; window is +/- days around the date.
const THEFT_WINDOWS: Array<{ month: number; day: number; span: number; label: string }> = [
  { month: 7, day: 4, span: 3, label: "July 4th" },
  { month: 12, day: 25, span: 4, label: "Christmas" },
  { month: 1, day: 1, span: 3, label: "New Year" },
  { month: 11, day: 26, span: 4, label: "Thanksgiving week" },
];

function parsePickup(pickupDate: string | null): Date | null {
  if (!pickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  const date = new Date(`${pickupDate}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Windows must survive month/year boundaries (Dec 30 is inside the New Year
// window), so compare against anchor dates in adjacent years, not day-of-month
// arithmetic. Anchors sit at 12:00Z to match parsePickup.
function theftWindowLabel(pickup: Date): string | null {
  const t = pickup.getTime();
  const year = pickup.getUTCFullYear();
  for (const w of THEFT_WINDOWS) {
    for (const y of [year - 1, year, year + 1]) {
      const anchor = Date.UTC(y, w.month - 1, w.day, 12);
      if (Math.abs(t - anchor) <= w.span * 86_400_000) return w.label;
    }
  }
  return null;
}

export function checkLoadIdea(
  idea: LoadIdea,
  context: { carriers: BenchCarrier[]; now: Date }
): LoadCheckResult {
  const findings: CheckFinding[] = [];
  const add = (finding: CheckFinding) => findings.push(finding);

  const category = idea.commodityCategory;
  const isBattery = category != null && BATTERY_CATEGORIES.includes(category);
  const isTech = category != null && TECH_CATEGORIES.includes(category);
  const isFragileTech = category != null && FRAGILE_TECH.includes(category);

  const originLoc = classifyDomesticLocation(idea.origin);
  const destLoc = classifyDomesticLocation(idea.destination);
  const originState = originLoc.stateCode;
  const destState = destLoc.stateCode;
  const touchesCa = originState === "CA" || destState === "CA";
  const intrastateCa = originState === "CA" && destState === "CA";
  const estimatedMiles =
    originState && destState && originState !== destState ? estimateMiles(originLoc, destLoc) : null;

  const tier = deriveSecurityTier({ declaredValue: idea.declaredValue, commodityCategory: category });
  const pickup = parsePickup(idea.pickupDate);

  // ── Hazmat / lithium ──────────────────────────────────────────────────────
  if (idea.batteriesDamagedOrRecalled) {
    add({
      id: "damaged_batteries_forbidden",
      severity: "blocker",
      domain: "hazmat",
      title: "Damaged/recalled lithium batteries are forbidden in normal transport",
      detail:
        "DOT forbids damaged, defective, or recalled lithium cells aboard aircraft entirely; ground moves are legal only under 49 CFR 173.185(f) enhanced packaging and handling, and cells at risk of fire or rapid disassembly additionally need PHMSA approval or a special permit.",
      action: "Refuse a standard booking. This needs a specialist DDR-battery handler set up for 173.185(f) packaging - quote only through one.",
    });
  }
  if (category === "batteries_un3480") {
    add({
      id: "un3480_fully_regulated",
      severity: "blocker",
      domain: "hazmat",
      title: "UN3480 standalone lithium-ion - fully regulated Class 9 unless small-cell excepted",
      detail:
        "Cells over 20 Wh or batteries over 100 Wh ship fully regulated Class 9 by ground: UN-spec packaging, Class 9 label + lithium battery mark, shipping papers with emergency contact, hazmat-trained carrier and driver (49 CFR 173.185). At or under those limits, highway moves can use the excepted lithium-battery provisions.",
      action:
        "Get the Wh rating and cell/battery count per package from the shipper first; unless everything is under the excepted limits, book only a hazmat-certified, lithium-experienced carrier from the bench.",
    });
  }
  if (category === "batteries_un3481") {
    add({
      id: "un3481_check_provisions",
      severity: "risk",
      domain: "hazmat",
      title: "UN3481 (batteries in/with equipment) - regulation level depends on Wh",
      detail:
        "Batteries packed with or contained in equipment can move under lighter provisions when cells/batteries are under the Wh limits; above them the shipment is fully regulated Class 9.",
      action: "Get Wh per battery and batteries per package from the shipper to determine excepted vs fully regulated before pricing.",
    });
  }
  if (isBattery && (idea.inboundInternational || idea.exportBound)) {
    add({
      id: "battery_air_leg",
      severity: "risk",
      domain: "hazmat",
      title: "Air legs for lithium batteries are heavily restricted",
      detail:
        "UN3480 is cargo-aircraft-only at ≤30% state of charge under ICAO/IATA rules; UN3481 has its own limits. A casual 'we'll fly it' promise can be illegal.",
      action: "Confirm state of charge and air eligibility with the air forwarder before promising any air leg; otherwise route it ocean/ground.",
    });
  }

  // ── Export control ────────────────────────────────────────────────────────
  if (idea.defenseOrSpace) {
    add({
      id: "itar_park",
      severity: "blocker",
      domain: "export",
      title: "Possible ITAR/USML article - outside current scope",
      detail:
        "Defense/space hardware can be a USML defense article: even on a domestic move, unlicensed foreign-person access to the article or its technical data is a deemed export - criminal exposure, not a fine. Defense shippers demand ITAR-compliant handling (US-person drivers, access controls) and typically ITAR-registered logistics partners.",
      action: "Don't quote. Keep Tier C parked until a specialist ITAR-registered forwarder partner is signed, then co-broker through them.",
    });
  }
  if (category === "servers_gpu" && idea.exportBound) {
    add({
      id: "gpu_export_screen",
      severity: "risk",
      domain: "export",
      title: "AI accelerators/servers heading to export carry EAR license risk",
      detail:
        "High-end GPUs and AI servers fall under advanced-computing export controls; many destinations require a BIS license. The domestic leg is fine - the export leg is where it breaks.",
      action:
        "Get the ECCN, end destination, and end user from the shipper before touching the export leg; screen the consignee against denied-party lists. Never assume EAR99.",
    });
  }
  if (idea.exportBound && !idea.defenseOrSpace) {
    add({
      id: "aes_filing",
      severity: "watch",
      domain: "export",
      title: "Export leg needs EEI/AES filing above $2,500 per Schedule B",
      detail: "Routine, but someone must own it - usually the export forwarder.",
      action: "Confirm who files AES and that Schedule B / ECCN classification is done before the freight hits the port.",
    });
  }

  // ── Customs / inbound ─────────────────────────────────────────────────────
  if (idea.inboundInternational) {
    add({
      id: "cbp_exam_buffer",
      severity: "risk",
      domain: "customs",
      title: "Inbound leg can catch a CBP exam - delivery promises off vessel ETA break",
      detail:
        "Any import container can be flagged for X-ray or intensive exam: days of delay plus exam, demurrage, and detention charges that land on someone.",
      action:
        "Quote the drayage/domestic leg with an exam contingency and explicit demurrage/detention terms; never promise a hard delivery date off the ETA.",
    });
    if (isChina(idea.originCountry)) {
      add({
        id: "china_301_uflpa",
        severity: "risk",
        domain: "customs",
        title: "China-origin electronics: Section 301 tariffs + UFLPA detention risk",
        detail:
          "Most China-origin electronics carry Section 301 duties, and UFLPA makes electronics a top CBP detention category - cargo can sit for weeks while origin/traceability docs are reviewed.",
        action:
          "Confirm HTS + duty math with the customs broker of record; ask the supplier for UFLPA supply-chain traceability docs up front; pad the delivery promise for detention risk.",
      });
    }
    if (category === "networking") {
      add({
        id: "fcc_import",
        severity: "watch",
        domain: "customs",
        title: "RF/networking gear needs FCC authorization at import",
        detail: "Radio-frequency devices require FCC certification or SDoC to enter US commerce.",
        action: "Confirm the importer of record holds the FCC compliance docs for the product.",
      });
    }
    add({
      id: "isf_timing",
      severity: "watch",
      domain: "customs",
      title: "Ocean ISF must be filed 24h before vessel loading",
      detail: "Late or missing ISF = penalties up to $5k and near-certain exam flags.",
      action: "When booking the drayage leg, confirm ISF was filed on time; treat a late-ISF container as exam-likely.",
    });
  }

  // ── Insurance / declared value ────────────────────────────────────────────
  if (idea.declaredValue == null && isTech) {
    add({
      id: "declared_value_missing",
      severity: "risk",
      domain: "insurance",
      title: "No declared value - can't set insurance or the security tier",
      detail: "Every downstream decision (carrier cargo limit, rider, SOP tier, tracking) keys off the value.",
      action: "Get the commercial invoice value from the shipper before quoting.",
    });
  }
  if (idea.declaredValue != null && idea.declaredValue > 250_000) {
    add({
      id: "value_over_250k",
      severity: "blocker",
      domain: "insurance",
      title: `$${Math.round(idea.declaredValue / 1000)}k on one truck - do not book until insurance is verified in writing`,
      detail:
        "Standard motor-carrier cargo policies stop at $100k, and electronics theft exclusions are common. At this value a single stolen trailer is a company-ending claim.",
      action:
        "Written verification of the carrier's cargo limit + high-value rider, or bind a per-load shipper's-interest policy. Consider splitting across two trucks. Security tier: critical SOP mandatory.",
    });
  } else if (idea.declaredValue != null && idea.declaredValue > 100_000) {
    add({
      id: "value_over_100k",
      severity: "risk",
      domain: "insurance",
      title: "Declared value exceeds the standard $100k cargo policy",
      detail: "The default cargo policy most carriers run will not cover this load; electronics sub-limits make it worse.",
      action: "Verify the carrier's actual cargo limit and electronics coverage in writing, or bind shipper's-interest coverage for the load.",
    });
  }

  // ── Security / theft ──────────────────────────────────────────────────────
  if (tier && tierRank(tier) >= tierRank("high_value") && touchesCa) {
    add({
      id: "ca_theft_corridor",
      severity: "risk",
      domain: "security",
      title: "High-value electronics on a CA lane - the national theft epicenter",
      detail:
        "California is ~36-38% of US cargo theft, electronics is the #1 target, and strategic (fake-carrier) theft concentrates around LA and the Inland Empire.",
      action:
        "Vetted bench carrier only, covert tracking live before pickup, no drop yards or weekend dwell, driver/truck/seal verification per the SOP checklist.",
    });
  }
  if (pickup && tier && tierRank(tier) >= tierRank("high_value")) {
    const windowLabel = theftWindowLabel(pickup);
    if (windowLabel) {
      add({
        id: "holiday_theft_window",
        severity: "risk",
        domain: "security",
        title: `Pickup lands in the ${windowLabel} theft window`,
        detail: "Organized cargo theft spikes around long holiday weekends when freight sits unattended.",
        action: "Move pickup outside the window, or guarantee a live unload with no overnight dwell and active tracking.",
      });
    }
    if (pickup.getUTCDay() === 5 && !windowLabel) {
      add({
        id: "friday_pickup_dwell",
        severity: "watch",
        domain: "security",
        title: "Friday pickup of high-value freight usually means weekend dwell",
        detail: "Freight picked up Friday often sits in a yard until Monday - prime theft exposure.",
        action: "Prefer Mon-Wed pickup, or confirm the carrier runs it straight through with team drivers.",
      });
    }
  }

  // ── California specifics ──────────────────────────────────────────────────
  if ((idea.temperatureSensitive || idea.equipmentType === "REEFER") && touchesCa) {
    add({
      id: "carb_tru",
      severity: "risk",
      domain: "california",
      title: "Reefer equipment operating in CA must be CARB TRU-compliant",
      detail: "Non-compliant transport refrigeration units are citable in California, and enforcement is real at ports and DCs.",
      action: "Confirm the carrier's TRU registration/compliance before dispatch - it's a vetting checklist line for reefer carriers.",
    });
  }
  if (intrastateCa) {
    add({
      id: "ab5_intrastate",
      severity: "watch",
      domain: "california",
      title: "CA intrastate move - AB5 owner-operator exposure sits in the chain",
      detail: "Misclassification liability lands mostly on carriers, but broker co-liability optics matter on pure-CA moves.",
      action: "Prefer carriers running employee drivers for CA intrastate freight; note the driver model during vetting.",
    });
  }

  // ── Equipment / physical ──────────────────────────────────────────────────
  if (idea.weightLbs != null && idea.weightLbs > 45_000) {
    add({
      id: "overweight",
      severity: "blocker",
      domain: "equipment",
      title: `${Math.round(idea.weightLbs / 1000)}k lbs cargo is over legal payload for a standard 5-axle`,
      detail: "80k lbs gross vehicle weight caps practical payload around 44-45k lbs; axle limits bite earlier with dense freight.",
      action: "Split across trucks, or price an overweight-permit routing (slower and lane-restricted).",
    });
  } else if (idea.weightLbs != null && idea.weightLbs > 42_000) {
    add({
      id: "weight_axle_margin",
      severity: "watch",
      domain: "equipment",
      title: "Payload is tight against axle limits",
      detail: "Dense pallets near the payload ceiling fail at the scale even when gross is legal.",
      action: "Get the load plan / pallet spread confirmed before dispatch.",
    });
  }
  if (category === "semicap_tools") {
    add({
      id: "semicap_whiteglove",
      severity: "risk",
      domain: "equipment",
      title: "Semicap tools are a white-glove move, not a dry-van commodity",
      detail:
        "Fab tools ship crated on air-ride with climate control and shock/tilt indicators; a standard dry van move can void OEM warranty and service contracts.",
      action:
        "Air-ride + blanket-wrap carrier, riggers booked at both ends, tilt/shock loggers on the crates, and the OEM's transport spec in hand before quoting.",
    });
  }
  if (isFragileTech && (idea.equipmentType === "FLATBED" || idea.equipmentType === "STEP_DECK")) {
    add({
      id: "open_deck_mismatch",
      severity: "risk",
      domain: "equipment",
      title: "Open-deck equipment for sensitive electronics",
      detail: "Flatbed/step-deck exposes electronics to weather, road shock, and eyes - usually the wrong tool unless it's crated machinery.",
      action: "Move it enclosed air-ride unless the OEM crate spec explicitly allows open deck with tarping.",
    });
  }
  if (isFragileTech) {
    add({
      id: "dock_liftgate",
      severity: "watch",
      domain: "equipment",
      title: "Hardware companies often have no dock",
      detail: "Startup labs and offices routinely need liftgate + inside delivery; finding out at the door costs a redelivery.",
      action: "Confirm dock access, liftgate, and inside-delivery needs at both ends when quoting.",
    });
  }
  if (
    isFragileTech &&
    !idea.temperatureSensitive &&
    idea.equipmentType !== "REEFER" &&
    pickup != null &&
    [6, 7, 8, 9].includes(pickup.getUTCMonth() + 1) &&
    originState != null &&
    destState != null &&
    originState !== destState &&
    (touchesCa || ["AZ", "NV", "TX", "NM"].includes(destState) || ["AZ", "NV", "TX", "NM"].includes(originState))
  ) {
    add({
      id: "desert_heat",
      severity: "risk",
      domain: "equipment",
      title: "Summer desert crossing - trailer interiors hit 130-150°F",
      detail: "Servers, instruments, and batteries have storage temp ceilings well below a parked trailer in the Mojave in July.",
      action: "Check the product's storage temp spec; if it's under ~60°C, use temp-controlled equipment or a team running nights.",
    });
  }

  // ── Capacity / timing ─────────────────────────────────────────────────────
  let teamRequired = false;
  if (estimatedMiles != null && idea.transitDays != null && idea.transitDays > 0) {
    const milesPerDay = estimatedMiles / idea.transitDays;
    if (milesPerDay > TEAM_MILES_PER_DAY) {
      add({
        id: "transit_impossible",
        severity: "blocker",
        domain: "capacity",
        title: `~${estimatedMiles} mi in ${idea.transitDays} day(s) is not drivable`,
        detail: `That needs ${Math.round(milesPerDay)} mi/day; even team drivers cap out around ${TEAM_MILES_PER_DAY} mi/day under HOS.`,
        action: "Reset the transit promise, or move the time-critical part by air freight.",
      });
    } else if (milesPerDay > SOLO_MILES_PER_DAY) {
      teamRequired = true;
      add({
        id: "team_required",
        severity: "risk",
        domain: "capacity",
        title: `~${estimatedMiles} mi in ${idea.transitDays} day(s) needs team drivers`,
        detail: `A solo driver covers ~${SOLO_MILES_PER_DAY} mi/day under HOS; this lane needs ~${Math.round(milesPerDay)} mi/day.`,
        action: "Quote with a team-driver carrier (also the right answer for high-value theft exposure) - price accordingly.",
      });
    }
  }

  // ── Operating reality (until authority is sorted) ─────────────────────────
  add({
    id: "broker_authority",
    severity: "watch",
    domain: "operating",
    title: "Booking as broker of record needs active authority + bond",
    detail: "Property-broker MC, $75k BMC-84 bond, and contingent cargo insurance are prerequisites to book in our own name.",
    action: "Until our MC is active, run booked loads through the partner broker's authority; quote freely either way.",
  });

  // ── Carrier bench match ───────────────────────────────────────────────────
  const requirements: CarrierRequirement[] = [];
  if (isBattery) {
    requirements.push({ key: "hazmat", label: "Hazmat certified" });
    requirements.push({ key: "lithium", label: "Lithium (UN3480/3481) experience" });
  }
  if (idea.temperatureSensitive || idea.equipmentType === "REEFER") {
    requirements.push({ key: "reefer", label: "Reefer / temp control" });
  }
  if (teamRequired) requirements.push({ key: "team", label: "Team drivers" });
  if (isFragileTech) requirements.push({ key: "air_ride", label: "Air ride" });
  if (idea.equipmentType) requirements.push({ key: "equipment", label: `Runs ${idea.equipmentType.replaceAll("_", " ").toLowerCase()}` });
  if (idea.declaredValue != null) {
    requirements.push({ key: "cargo_limit", label: `Cargo limit ≥ $${Math.round(idea.declaredValue / 1000)}k` });
  }
  const laneStates = [originState, destState].filter((s): s is string => s != null);
  if (laneStates.length > 0) requirements.push({ key: "lane", label: `Serves ${laneStates.join(" + ")}` });

  const matched = context.carriers.filter((carrier) => {
    if (isBattery && !(carrier.hazmatCertified && carrier.lithiumCapable)) return false;
    if ((idea.temperatureSensitive || idea.equipmentType === "REEFER") && !carrier.reeferCapable) return false;
    if (teamRequired && !carrier.teamDrivers) return false;
    if (isFragileTech && !carrier.airRide) return false;
    if (idea.equipmentType && carrier.equipmentTypes.length > 0 && !carrier.equipmentTypes.includes(idea.equipmentType)) return false;
    if (idea.declaredValue != null && carrier.cargoLimit != null && carrier.cargoLimit < idea.declaredValue) return false;
    if (idea.declaredValue != null && carrier.cargoLimit == null) return false;
    if (
      laneStates.length > 0 &&
      carrier.serviceStates.length > 0 &&
      !laneStates.every((s) => carrier.serviceStates.includes(s))
    ) {
      return false;
    }
    if (carrier.cargoInsuranceExpiry) {
      const expiry = new Date(carrier.cargoInsuranceExpiry);
      if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < context.now.getTime()) return false;
    }
    return true;
  });

  if (matched.length === 0 && requirements.length > 0) {
    add({
      id: "no_bench_carrier",
      severity: context.carriers.length === 0 ? "risk" : "blocker",
      domain: "carrier",
      title:
        context.carriers.length === 0
          ? "No approved carriers on the bench yet"
          : "No approved bench carrier meets this load's requirements",
      detail:
        context.carriers.length === 0
          ? "The vetted bench is empty - every load currently depends on ad-hoc capacity, which is exactly the deceptive-pickup attack surface."
          : `None of the ${context.carriers.length} approved carrier(s) satisfy: ${requirements.map((r) => r.label).join(", ")}.`,
      action:
        "Vet a matching carrier before committing (the FMCSA pool has ~1,160 CA hazmat carriers in the 5-100 truck band), or co-broker this one to a trusted specialist.",
    });
  }

  const severityOrder: Record<CheckSeverity, number> = { blocker: 0, risk: 1, watch: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    securityTier: tier,
    originState,
    destState,
    estimatedMiles,
    findings,
    carrierMatch: {
      requirements,
      matched: matched.slice(0, 5).map((c) => ({ id: c.id, name: c.name, dotNumber: c.dotNumber })),
      approvedOnBench: context.carriers.length,
    },
    facts: [],
  };
}

// Render a pre-flight result as text: `notes` is the compact form for
// Inquiry.notes; `report` is the full form for the RFQ content panel
// (rawEmailBody). Pure - the caller stamps dates/references.
export function formatPreflightReport(idea: LoadIdea, result: LoadCheckResult): { notes: string; report: string } {
  const blockers = result.findings.filter((f) => f.severity === "blocker");
  const risks = result.findings.filter((f) => f.severity === "risk");
  const watch = result.findings.filter((f) => f.severity === "watch");
  const tierText = result.securityTier ?? "unset";
  const laneText =
    result.originState && result.destState
      ? `${result.originState} → ${result.destState}${result.estimatedMiles != null ? ` (~${result.estimatedMiles} mi)` : ""}`
      : null;

  const notes = [
    `Pre-flight: ${blockers.length} blocker(s), ${risks.length} risk(s), ${watch.length} watch - security tier ${tierText}.`,
    ...blockers.map((f) => `✗ ${f.title} → ${f.action}`),
    ...risks.map((f) => `! ${f.title} → ${f.action}`),
  ].join("\n");

  const section = (label: string, group: CheckFinding[]): string[] =>
    group.length === 0
      ? []
      : [label, ...group.map((f, i) => `${i + 1}. ${f.title}\n   ${f.detail}\n   → ${f.action}`), ""];

  const facts = [
    idea.description ? `Idea: ${idea.description}` : null,
    laneText ? `Lane: ${laneText}` : null,
    idea.declaredValue != null ? `Declared value: $${idea.declaredValue.toLocaleString("en-US")}` : null,
    idea.weightLbs != null ? `Weight: ${idea.weightLbs.toLocaleString("en-US")} lbs` : null,
    idea.equipmentType ? `Equipment: ${idea.equipmentType}` : null,
    idea.pickupDate ? `Pickup: ${idea.pickupDate}` : null,
    idea.transitDays != null ? `Transit promise: ${idea.transitDays} day(s)` : null,
    `Security tier: ${tierText}`,
  ].filter((line): line is string => line != null);

  const bench =
    result.carrierMatch.matched.length > 0
      ? `Matching approved carriers: ${result.carrierMatch.matched.map((c) => c.name).join(", ")}`
      : `No matching approved carrier (${result.carrierMatch.approvedOnBench} approved on the bench). Requirements: ${
          result.carrierMatch.requirements.map((r) => r.label).join(", ") || "none"
        }`;

  const report = [
    "LOAD PRE-FLIGHT REPORT",
    ...facts,
    "",
    ...(result.facts.length > 0 ? [`CITED FACTS (${result.facts.length})`, ...result.facts.map((line) => `• ${line}`), ""] : []),
    ...section(`BLOCKERS (${blockers.length})`, blockers),
    ...section(`RISKS (${risks.length})`, risks),
    ...section(`WATCH (${watch.length})`, watch),
    "CARRIER BENCH",
    bench,
  ].join("\n");

  return { notes, report };
}

// Coerce whatever the AI extractor (or a client form) produced into a safe
// LoadIdea. Unknown enum values become null; numbers are sanitized.
export function coerceLoadIdea(raw: unknown, commodityValues: readonly string[], equipmentValues: readonly string[]): LoadIdea {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
    if (typeof v !== "string") return null;
    const cleaned = v.replace(/[$,\s]/g, "");
    if (!cleaned) return null; // Number("") === 0 - an empty string is missing, not zero
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const bool = (v: unknown): boolean => v === true || v === "true";
  const oneOf = (v: unknown, allowed: readonly string[]): string | null =>
    typeof v === "string" && allowed.includes(v) ? v : null;
  const date = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;

  return {
    description: text(obj.description),
    commodityCategory: oneOf(obj.commodityCategory, commodityValues),
    origin: text(obj.origin),
    destination: text(obj.destination),
    declaredValue: num(obj.declaredValue),
    weightLbs: num(obj.weightLbs),
    equipmentType: oneOf(obj.equipmentType, equipmentValues),
    temperatureSensitive: bool(obj.temperatureSensitive),
    inboundInternational: bool(obj.inboundInternational),
    originCountry: text(obj.originCountry),
    exportBound: bool(obj.exportBound),
    defenseOrSpace: bool(obj.defenseOrSpace),
    batteriesDamagedOrRecalled: bool(obj.batteriesDamagedOrRecalled),
    pickupDate: date(obj.pickupDate),
    transitDays: num(obj.transitDays),
  };
}
