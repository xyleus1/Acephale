export type SupplyOsDemoCompanyId = "atlas-robotics" | "guild";

export const SUPPLY_OS_DEMO_COMPANIES = {
  "atlas-robotics": {
    id: "atlas-robotics",
    name: "Atlas Robotics",
    logoUrl: "https://www.atlas-robotics.com/icon.svg",
    logoSourceUrl: "https://www.atlas-robotics.com/",
    summary: "Illustrative operating workspace",
    primaryFact: "3 facilities",
    secondaryFact: "5 network points",
  },
  guild: {
    id: "guild",
    name: "GUILD2",
    logoUrl: "https://www.guildai.co/favicon.ico",
    logoSourceUrl: "https://www.guildai.co/",
    summary: "Workflow database customer",
    primaryFact: "40 sourcing lines",
    secondaryFact: "Aerospace precision metals",
  },
} as const satisfies Record<SupplyOsDemoCompanyId, {
  id: SupplyOsDemoCompanyId;
  name: string;
  logoUrl: string;
  logoSourceUrl: string;
  summary: string;
  primaryFact: string;
  secondaryFact: string;
}>;

export const SUPPLY_OS_DEMO_COMPANY = SUPPLY_OS_DEMO_COMPANIES["atlas-robotics"];
