import type { Prisma } from "../../generated/world-client";

export type NormalizedSourceRecord = {
  source: string;
  sourceRecordId: string;
  name: string;
  nameNormalized: string;
  nameMatchable: boolean;
  domain: string | null;
  lei: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  addressLine: string | null;
  legalIds: Prisma.InputJsonValue | null;
  industryCodes: Prisma.InputJsonValue | null;
  isManufacturer: boolean;
  manufacturerEvidence: Prisma.InputJsonValue | null;
  sizeBand: string | null;
  foundedYear: number | null;
  linkedinUrl: string | null;
  website: string | null;
  entityStatus: string | null;
  payload: Prisma.InputJsonValue;
};
