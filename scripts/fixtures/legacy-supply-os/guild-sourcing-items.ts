import type { SupplyInventoryItem } from "../../../src/lib/supply-os/inventory-item";

export type GuildSourcingClassification = "SUPPLIER_SEARCH" | "CLARIFICATION_REQUIRED" | "REQUIREMENT_ONLY";

type GuildSourcingLineInput = {
  item: string;
  name: string;
  specification: string;
  quantity: number | null;
  requirement: string;
  unit: string | null;
  deliverable: string;
};

export type GuildSourcingLine = GuildSourcingLineInput & {
  sku: string;
  classification: GuildSourcingClassification;
};

const GUILD_SOURCING_LINE_INPUTS: GuildSourcingLineInput[] = [
  { item: "001", name: "Main cylindrical structural skin stock", specification: "Aluminum alloy 6061-T6 sheet, 2.0 mm nominal thickness, mill finish, cut-to-size blanks per released drawing", quantity: 4, requirement: "4 blanks", unit: "blanks", deliverable: "Material certificate showing alloy and temper; heat or lot traceability" },
  { item: "002", name: "Internal equipment-deck plate stock", specification: "6061-T651 aluminum plate, 6.35 mm nominal, precision-sawn blanks", quantity: 3, requirement: "3 blanks", unit: "blanks", deliverable: "Material certificate and dimensional inspection report" },
  { item: "003", name: "Removable access-panel stock", specification: "5052-H32 aluminum sheet, 1.6 mm nominal, deburred edges", quantity: 6, requirement: "6 blanks", unit: "blanks", deliverable: "Certificate of conformance" },
  { item: "004", name: "Structural bracket stock", specification: "6061-T6 aluminum angle or extrusion, machining stock, cut to drawing", quantity: 12, requirement: "12 pieces", unit: "pieces", deliverable: "Material lot trace and certificate of conformance" },
  { item: "005", name: "Non-flight nose-shell/mockup laminate", specification: "G10/FR-4 glass-epoxy laminate, 2.4 mm nominal, flame-retardant grade; GROUND TEST ONLY", quantity: 2, requirement: "2 sheets", unit: "sheets", deliverable: "Material datasheet and certificate of conformance" },
  { item: "006", name: "Electronics mounting isolators", specification: "Silicone-elastomer vibration isolator mounts, stainless inserts, 40 to 60 Shore A hardness", quantity: 16, requirement: "16 mounts", unit: "mounts", deliverable: "Manufacturer datasheet and batch trace" },
  { item: "007", name: "General removable fasteners", specification: "A2/304 stainless-steel socket-head cap screws, M4 x 0.7 and M5 x 0.8 families; passivated", quantity: 100, requirement: "100 assorted", unit: "pieces", deliverable: "Certificate of conformance and supplier lot number" },
  { item: "008", name: "Structural washers", specification: "304 stainless flat washers matched to M4 and M5 hardware", quantity: 150, requirement: "150 washers", unit: "washers", deliverable: "Certificate of conformance" },
  { item: "009", name: "Locking nuts", specification: "304 stainless prevailing-torque locknuts, M4 and M5; non-energetic mechanical locking feature", quantity: 50, requirement: "50 locknuts", unit: "locknuts", deliverable: "Certificate of conformance" },
  { item: "010", name: "Threaded inserts", specification: "Stainless helical-thread inserts for M4 and M5 aluminum threads", quantity: 40, requirement: "40 inserts", unit: "inserts", deliverable: "Certificate of conformance and manufacturer part identification" },
  { item: "011", name: "Bonding epoxy", specification: "3M Scotch-Weld DP420 two-part structural epoxy or equivalent, room-temperature curing", quantity: 4, requirement: "4 cartridges", unit: "cartridges", deliverable: "Shelf-life remaining, lot number, and safety data sheet" },
  { item: "012", name: "Flexible electronics adhesive", specification: "DOWSIL 3145 RTV silicone adhesive or sealant, or equivalent electronics-grade neutral-cure material", quantity: 4, requirement: "4 tubes", unit: "tubes", deliverable: "Lot or date code and technical datasheet" },
  { item: "013", name: "Surface-preparation solvent", specification: "High-purity isopropyl alcohol, at least 99 percent, electronics or manufacturing grade", quantity: 4, requirement: "4 L", unit: "liters", deliverable: "Safety data sheet and lot identification" },
  { item: "014", name: "Primer system", specification: "Two-part corrosion-resistant epoxy primer compatible with aluminum, aerospace or industrial grade", quantity: 2, requirement: "2 kits", unit: "kits", deliverable: "Technical datasheet, batch number, and expiration date" },
  { item: "015", name: "Exterior finish", specification: "Two-component polyurethane topcoat, matte finish, customer-specified color", quantity: 2, requirement: "2 kits", unit: "kits", deliverable: "Color and batch certificate plus technical datasheet" },
  { item: "016", name: "Equipment mounting rail", specification: "Hard-anodized 6061 aluminum instrumentation rail, machined to released drawing", quantity: 4, requirement: "4 rails", unit: "rails", deliverable: "Dimensional report and anodize process certification" },
  { item: "017", name: "Electrical hookup wire", specification: "22 AWG stranded copper wire with ETFE insulation, 600 V class, multiple identification colors", quantity: 300, requirement: "300 m total", unit: "meters", deliverable: "Manufacturer and date code plus certificate of conformance" },
  { item: "018", name: "Higher-current test wiring", specification: "18 AWG stranded copper wire with ETFE insulation", quantity: 50, requirement: "50 m", unit: "meters", deliverable: "Manufacturer and date code plus certificate of conformance" },
  { item: "019", name: "Shielded instrumentation cable", specification: "2-conductor twisted shielded cable, 22 to 24 AWG conductors, fluoropolymer jacket", quantity: 100, requirement: "100 m", unit: "meters", deliverable: "Cable construction datasheet and lot number" },
  { item: "020", name: "Cable identification", specification: "Heat-shrink printable identification sleeves, fluoropolymer or polyolefin, permanent thermal-transfer marking", quantity: 500, requirement: "500 sleeves", unit: "sleeves", deliverable: "Manufacturer datasheet" },
  { item: "021", name: "Harness protection", specification: "Abrasion-resistant braided expandable sleeving, nominal 6, 10, and 15 mm diameters", quantity: 50, requirement: "50 m assorted", unit: "meters", deliverable: "Certificate of conformance" },
  { item: "022", name: "Heat-shrink tubing", specification: "Dual-wall adhesive-lined heat shrink, 3:1 shrink ratio, assorted diameters", quantity: 30, requirement: "30 m assorted", unit: "meters", deliverable: "Manufacturer datasheet" },
  { item: "023", name: "Ground-test circular connectors", specification: "Industrial or aerospace-quality multipole circular connectors, metallic shell, positive locking, 8 to 12 contacts; test and instrumentation use only", quantity: 8, requirement: "8 pairs", unit: "pairs", deliverable: "Mating-pair identification and contact insertion or extraction tooling identification" },
  { item: "024", name: "Internal electronics enclosure", specification: "Machined 6061-T6 aluminum enclosure, removable lid, conductive gasket provision; blank enclosure only", quantity: 3, requirement: "3 enclosures", unit: "enclosures", deliverable: "Dimensional inspection and material certificate" },
  { item: "025", name: "Printed circuit board carrier", specification: "FR-4 laminate, 1.6 mm nominal, no active flight-control circuitry", quantity: 6, requirement: "6 carriers", unit: "carriers", deliverable: "Fabrication certificate of conformance" },
  { item: "026", name: "Electrical standoffs", specification: "M3 threaded nylon or PEEK standoffs, assorted 10 to 25 mm heights", quantity: 50, requirement: "50 standoffs", unit: "standoffs", deliverable: "Material identification" },
  { item: "027", name: "Inert subsystem mass simulator", specification: "Machined aluminum or steel ballast blocks sized solely to reproduce specified test mass; permanently engraved INERT MASS SIMULATOR", quantity: null, requirement: "Quantity and unit require clarification", unit: null, deliverable: "Actual measured mass and serial number" },
  { item: "028", name: "Temperature instrumentation", specification: "100 ohm platinum resistance temperature detector, PT100 RTD, 3-wire, adhesive or surface-mount style", quantity: 12, requirement: "12 sensors", unit: "sensors", deliverable: "Calibration certificate" },
  { item: "029", name: "Structural test strain gauges", specification: "Foil strain gauges, 350 ohm nominal, general-purpose aluminum-compatible gauge", quantity: 16, requirement: "16 gauges", unit: "gauges", deliverable: "Manufacturer lot and gauge factor documentation" },
  { item: "030", name: "Ground-test accelerometer", specification: "Industrial triaxial accelerometer, low-voltage output, used only for vibration or handling qualification", quantity: 3, requirement: "3 accelerometers", unit: "accelerometers", deliverable: "Calibration certificate and serial number" },
  { item: "031", name: "Ground data-acquisition harness", specification: "Bench-test harness assembled from items 017 to 023; no flight-command capability", quantity: 2, requirement: "2 harnesses", unit: "harnesses", deliverable: "Continuity test, pin-to-pin report, and insulation inspection" },
  { item: "032", name: "Bonding straps", specification: "Tinned-copper braided grounding straps with crimped ring terminals", quantity: 12, requirement: "12 straps", unit: "straps", deliverable: "Resistance and continuity inspection" },
  { item: "033", name: "Protective edge trim", specification: "Silicone or EPDM edge trim for access openings", quantity: 10, requirement: "10 m", unit: "meters", deliverable: "Material identification" },
  { item: "034", name: "Thermal interface pad", specification: "Electrically insulating silicone thermal pad, approximately 1 to 2 mm thickness", quantity: 10, requirement: "10 sheets", unit: "sheets", deliverable: "Thermal and material datasheet" },
  { item: "035", name: "Identification plates", specification: "Laser-etched anodized-aluminum nameplates with part number, serial number, revision, and GROUND TEST ARTICLE marking", quantity: 12, requirement: "12 plates", unit: "plates", deliverable: "Artwork approval and serialization record" },
  { item: "036", name: "Tamper/witness marking", specification: "Industrial torque-seal or witness lacquer", quantity: 6, requirement: "6 tubes", unit: "tubes", deliverable: "Batch or date code" },
  { item: "037", name: "Protective transit caps/plugs", specification: "Antistatic polymer caps and connector dust covers", quantity: 30, requirement: "30 pieces", unit: "pieces", deliverable: "Certificate of conformance" },
  { item: "038", name: "Shipping protection", specification: "Closed-cell polyethylene foam, antistatic bags, humidity indicators, and reusable shipping case", quantity: 1, requirement: "1 set", unit: "set", deliverable: "Packaging compliance checklist" },
  { item: "039", name: "Supplier documentation package", specification: "Material certificates, certificates of conformance, inspection records, calibration certificates, deviation reports, and lot or serial traceability", quantity: 1, requirement: "1 lot", unit: "lot", deliverable: "Delivered digitally against BOM item numbers" },
  { item: "040", name: "First-article inspection package", specification: "Measurement report against released drawing for first production unit", quantity: 1, requirement: "1 package", unit: "package", deliverable: "Signed inspection record and nonconformance disposition" },
];

export const GUILD_SOURCING_LINES: GuildSourcingLine[] = GUILD_SOURCING_LINE_INPUTS.map((line) => ({
  ...line,
  sku: `GUILD-${line.item}`,
  classification: line.item === "027"
    ? "CLARIFICATION_REQUIRED"
    : line.item === "039"
      ? "REQUIREMENT_ONLY"
      : "SUPPLIER_SEARCH",
}));

export const GUILD_SOURCING_ITEMS: SupplyInventoryItem[] = GUILD_SOURCING_LINES.map((line) => ({
  sku: line.sku,
  name: line.name,
  specification: line.specification,
  quantityPerRobot: 0,
  onHand: 0,
  allocated: 0,
  confirmedInbound: 0,
  location: "Program sourcing",
  // Keep clarification lines visible in the demo queue without treating the
  // display placeholder as a researchable requested quantity.
  targetStock: line.quantity ?? 1,
  candidates: [],
  requirementLabel: line.requirement,
  ...(line.quantity === null ? {} : { requestedQuantity: line.quantity }),
  ...(line.unit === null ? {} : { requestedUnit: line.unit }),
  requiredQuantity: line.quantity,
  supplierDeliverable: line.deliverable,
  needByDate: "2026-09-30",
  deliveryLocation: "Austin, TX, United States",
}));

export const GUILD2_SOURCING_ITEMS: SupplyInventoryItem[] = GUILD_SOURCING_ITEMS.map((item) => ({
  ...item,
  sku: item.sku.replace(/^GUILD-/, "GUILD2-"),
}));
