export const COMMODITY_CATEGORIES = [
  ["servers_gpu", "Servers / GPUs"],
  ["semicap_tools", "Semiconductor equipment"],
  ["networking", "Networking equipment"],
  ["batteries_un3480", "Lithium batteries - UN3480 (standalone)"],
  ["batteries_un3481", "Lithium batteries - UN3481 (in equipment)"],
  ["robotics", "Robotics"],
  ["test_instruments", "Test & lab instruments"],
  ["medical_devices", "Medical devices"],
  ["consumer_electronics", "Consumer electronics"],
  ["other_tech", "Other tech"],
  ["non_tech", "Non-tech"],
] as const;

export const SECURITY_TIERS = [
  ["standard", "Standard"],
  ["elevated", "Elevated"],
  ["high_value", "High value"],
  ["critical", "Critical"],
] as const;

export const INTEL_EQUIPMENT_TYPES = [
  ["DRY_VAN", "Dry van"],
  ["REEFER", "Reefer"],
  ["FLATBED", "Flatbed"],
  ["STEP_DECK", "Step deck"],
  ["BOX_TRUCK", "Box truck"],
  ["CONTAINER_DRAYAGE", "Container drayage"],
] as const;

export type CommodityCategory = (typeof COMMODITY_CATEGORIES)[number][0];
export type SecurityTier = (typeof SECURITY_TIERS)[number][0];
export type IntelEquipmentType = (typeof INTEL_EQUIPMENT_TYPES)[number][0];

export const COMMODITY_CATEGORY_VALUES = COMMODITY_CATEGORIES.map(([value]) => value);
export const SECURITY_TIER_VALUES = SECURITY_TIERS.map(([value]) => value);
export const INTEL_EQUIPMENT_TYPE_VALUES = INTEL_EQUIPMENT_TYPES.map(([value]) => value);

export function securityTierLabel(value: string | null): string {
  return SECURITY_TIERS.find(([tier]) => tier === value)?.[1] ?? (value ?? "");
}

export function commodityCategoryLabel(value: string | null): string {
  return COMMODITY_CATEGORIES.find(([category]) => category === value)?.[1] ?? (value ?? "");
}

const TIER_RANK: Record<SecurityTier, number> = {
  standard: 0,
  elevated: 1,
  high_value: 2,
  critical: 3,
};

export function tierRank(tier: string | null | undefined): number {
  return tier && tier in TIER_RANK ? TIER_RANK[tier as SecurityTier] : -1;
}

const CATEGORY_FLOOR: Record<CommodityCategory, SecurityTier> = {
  servers_gpu: "elevated",
  semicap_tools: "elevated",
  networking: "elevated",
  batteries_un3480: "elevated",
  batteries_un3481: "elevated",
  robotics: "elevated",
  test_instruments: "elevated",
  medical_devices: "elevated",
  consumer_electronics: "elevated",
  other_tech: "standard",
  non_tech: "standard",
};

function valueTier(declaredValue: number): SecurityTier {
  if (declaredValue >= 500_000) return "critical";
  if (declaredValue >= 100_000) return "high_value";
  if (declaredValue >= 25_000) return "elevated";
  return "standard";
}

export function deriveSecurityTier(input: {
  declaredValue?: number | null;
  commodityCategory?: string | null;
}): SecurityTier | null {
  const category = COMMODITY_CATEGORY_VALUES.includes(input.commodityCategory as CommodityCategory)
    ? (input.commodityCategory as CommodityCategory)
    : null;
  const value = typeof input.declaredValue === "number" && input.declaredValue > 0 ? input.declaredValue : null;
  if (!category && value === null) return null;

  const fromValue = value !== null ? valueTier(value) : "standard";
  const fromCategory = category ? CATEGORY_FLOOR[category] : "standard";
  return TIER_RANK[fromValue] >= TIER_RANK[fromCategory] ? fromValue : fromCategory;
}
