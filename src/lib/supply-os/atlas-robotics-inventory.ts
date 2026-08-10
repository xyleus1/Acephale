export type AtlasInventoryStatus = "covered" | "watch" | "shortage";

export type AtlasSourcingCandidate = {
  id: string;
  name: string;
  location: string;
  role: "Manufacturer" | "Distributor" | "Contract manufacturer";
  leadTimeDays: number;
  minimumOrderQuantity: number;
  modeledUnitCostUsd: number;
  fit: string;
};

export type AtlasInventoryItem = {
  sku: string;
  name: string;
  specification: string;
  quantityPerRobot: number;
  onHand: number;
  allocated: number;
  confirmedInbound: number;
  location: string;
  targetStock: number;
  candidates: AtlasSourcingCandidate[];
};

export const ATLAS_ROBOT_DEMAND = 24;

export const ATLAS_ROBOTICS_INVENTORY: AtlasInventoryItem[] = [
  {
    sku: "SEN-LDR-220",
    name: "Safety LiDAR scanner",
    specification: "270 degree field, dual protective fields, PL d / SIL 2 capable",
    quantityPerRobot: 2,
    onHand: 36,
    allocated: 4,
    confirmedInbound: 6,
    location: "Austin / safety stock",
    targetStock: 58,
    candidates: [
      { id: "northstar-sensing", name: "Northstar Sensing", location: "Osaka, Japan", role: "Manufacturer", leadTimeDays: 35, minimumOrderQuantity: 4, modeledUnitCostUsd: 1880, fit: "Closest technical match; validation sample and safety file required." },
      { id: "motion-controls-west", name: "Motion Controls West", location: "Irvine, CA", role: "Distributor", leadTimeDays: 18, minimumOrderQuantity: 2, modeledUnitCostUsd: 2075, fit: "Faster bridge supply; allocation and serial traceability remain unconfirmed." },
    ],
  },
  {
    sku: "VIS-DPT-410",
    name: "Stereo depth camera",
    specification: "Global shutter, 87 degree horizontal field, industrial USB-C",
    quantityPerRobot: 4,
    onHand: 88,
    allocated: 8,
    confirmedInbound: 12,
    location: "Austin / controlled electronics",
    targetStock: 112,
    candidates: [
      { id: "formosa-machine-vision", name: "Formosa Machine Vision", location: "Hsinchu, Taiwan", role: "Manufacturer", leadTimeDays: 29, minimumOrderQuantity: 20, modeledUnitCostUsd: 438, fit: "Meets mechanical envelope; optical calibration evidence is still missing." },
      { id: "vector-vision-supply", name: "Vector Vision Supply", location: "San Jose, CA", role: "Distributor", leadTimeDays: 14, minimumOrderQuantity: 4, modeledUnitCostUsd: 485, fit: "Low-MOQ bridge option; long-term allocation is not committed." },
    ],
  },
  {
    sku: "CMP-IPC-180",
    name: "Fanless industrial computer",
    specification: "8-core x86, 32 GB RAM, dual LAN, TPM 2.0, -20 to 60 C",
    quantityPerRobot: 1,
    onHand: 18,
    allocated: 2,
    confirmedInbound: 4,
    location: "Austin / secure cage",
    targetStock: 30,
    candidates: [
      { id: "prairie-edge-compute", name: "Prairie Edge Compute", location: "Chicago, IL", role: "Contract manufacturer", leadTimeDays: 24, minimumOrderQuantity: 5, modeledUnitCostUsd: 1260, fit: "Compatible I/O set; thermal and image qualification are required." },
      { id: "pacific-industrial-computing", name: "Pacific Industrial Computing", location: "Fremont, CA", role: "Distributor", leadTimeDays: 11, minimumOrderQuantity: 1, modeledUnitCostUsd: 1395, fit: "Bridge stock candidate; exact processor revision must be locked." },
    ],
  },
  {
    sku: "DRV-MCU-220",
    name: "Dual-channel motor controller",
    specification: "48 V, 80 A peak per channel, CANopen, regenerative braking",
    quantityPerRobot: 2,
    onHand: 52,
    allocated: 6,
    confirmedInbound: 0,
    location: "Austin / line-side electronics",
    targetStock: 58,
    candidates: [
      { id: "rhein-motion-controls", name: "Rhein Motion Controls", location: "Stuttgart, Germany", role: "Manufacturer", leadTimeDays: 31, minimumOrderQuantity: 10, modeledUnitCostUsd: 735, fit: "Electrical match; firmware behavior and EMC evidence need review." },
      { id: "automation-parts-central", name: "Automation Parts Central", location: "Dallas, TX", role: "Distributor", leadTimeDays: 12, minimumOrderQuantity: 2, modeledUnitCostUsd: 810, fit: "Fast bridge option; manufacturer authorization is unverified." },
    ],
  },
  {
    sku: "PWR-BAT-512",
    name: "51.2 V LiFePO4 battery pack",
    specification: "100 Ah, CAN BMS, UN 38.3 documentation set, service disconnect",
    quantityPerRobot: 1,
    onHand: 19,
    allocated: 2,
    confirmedInbound: 4,
    location: "Austin / hazmat cage",
    targetStock: 30,
    candidates: [
      { id: "hanseong-energy-systems", name: "Hanseong Energy Systems", location: "Busan, South Korea", role: "Manufacturer", leadTimeDays: 38, minimumOrderQuantity: 10, modeledUnitCostUsd: 2140, fit: "Pack architecture fits; transport test summary and cell traceability required." },
      { id: "lone-star-battery-integration", name: "Lone Star Battery Integration", location: "Houston, TX", role: "Contract manufacturer", leadTimeDays: 21, minimumOrderQuantity: 4, modeledUnitCostUsd: 2360, fit: "Domestic integration option; final enclosure and BMS validation remain open." },
    ],
  },
  {
    sku: "MOT-BLD-750",
    name: "750 W brushless drive motor",
    specification: "48 V, IP65, absolute encoder, keyed output shaft",
    quantityPerRobot: 4,
    onHand: 104,
    allocated: 12,
    confirmedInbound: 8,
    location: "Austin / drive-cell supermarket",
    targetStock: 112,
    candidates: [],
  },
  {
    sku: "SAF-PLC-160",
    name: "Safety controller and I/O",
    specification: "Dual-channel inputs, safe torque off, PL e / SIL 3 capable",
    quantityPerRobot: 1,
    onHand: 30,
    allocated: 4,
    confirmedInbound: 0,
    location: "Austin / controlled electronics",
    targetStock: 30,
    candidates: [],
  },
  {
    sku: "PWR-CHG-480",
    name: "48 V onboard charger",
    specification: "2 kW, CAN control, 120/240 VAC input, UL-recognized components",
    quantityPerRobot: 1,
    onHand: 26,
    allocated: 3,
    confirmedInbound: 2,
    location: "Austin / power electronics",
    targetStock: 30,
    candidates: [],
  },
  {
    sku: "MEC-WHL-240",
    name: "Drive wheel assembly",
    specification: "250 mm polyurethane wheel, hub, bearings, and encoder target",
    quantityPerRobot: 4,
    onHand: 120,
    allocated: 16,
    confirmedInbound: 0,
    location: "Austin / mechanical supermarket",
    targetStock: 112,
    candidates: [],
  },
  {
    sku: "MEC-FRM-240",
    name: "Machined frame weldment",
    specification: "Powder-coated steel, machined datums, 420 kg rated payload",
    quantityPerRobot: 1,
    onHand: 25,
    allocated: 2,
    confirmedInbound: 4,
    location: "Austin / receiving",
    targetStock: 28,
    candidates: [],
  },
  {
    sku: "ELE-HAR-240",
    name: "Main power and signal harness",
    specification: "Robot-specific loom, labeled branches, shielded CAN and safety pairs",
    quantityPerRobot: 1,
    onHand: 20,
    allocated: 1,
    confirmedInbound: 8,
    location: "Austin / kitting",
    targetStock: 30,
    candidates: [],
  },
  {
    sku: "SAF-EST-020",
    name: "Emergency-stop station",
    specification: "Twist release, dual NC contacts, illuminated reset indicator",
    quantityPerRobot: 2,
    onHand: 56,
    allocated: 6,
    confirmedInbound: 0,
    location: "Austin / safety stock",
    targetStock: 56,
    candidates: [],
  },
];

export function projectedAvailable(item: AtlasInventoryItem) {
  return Math.max(0, item.onHand - item.allocated + item.confirmedInbound);
}

export function requiredForDemand(item: AtlasInventoryItem, demand = ATLAS_ROBOT_DEMAND) {
  return item.quantityPerRobot * demand;
}

export function shortageQuantity(item: AtlasInventoryItem, demand = ATLAS_ROBOT_DEMAND) {
  return Math.max(0, requiredForDemand(item, demand) - projectedAvailable(item));
}

export function inventoryStatus(item: AtlasInventoryItem): AtlasInventoryStatus {
  const shortage = shortageQuantity(item);
  if (shortage > 0) return "shortage";
  if (projectedAvailable(item) < item.targetStock) return "watch";
  return "covered";
}

export function atlasInventorySummary() {
  const shortageItems = ATLAS_ROBOTICS_INVENTORY.filter((item) => shortageQuantity(item) > 0);
  const buildableWithInbound = Math.min(...ATLAS_ROBOTICS_INVENTORY.map((item) => (
    Math.floor(projectedAvailable(item) / item.quantityPerRobot)
  )));
  return {
    itemCount: ATLAS_ROBOTICS_INVENTORY.length,
    shortageCount: shortageItems.length,
    buildableWithInbound,
    demandUnits: ATLAS_ROBOT_DEMAND,
  };
}
