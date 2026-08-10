export type PublicResearchCandidate = {
  id: string;
  companyName: string;
  website: string | null;
  roles: string[];
  country: { value: string | null };
  facility: { value: string | null };
  productCapability: { value: string | null; state: string };
  price: { value: number | null; state: string };
  currency: { value: string | null };
  minimumOrderQuantity: { value: number | null };
  leadTimeDays: { value: number | null; state: string };
  sourceUrls: string[];
  status: string;
  cautions: string[];
};

export type PublicResearchResult = {
  candidates: PublicResearchCandidate[];
  degraded: boolean;
  warnings: string[];
};

export type SavedSourcingResearchRun = {
  id: string;
  status: string;
  input: {
    componentItemKey: string;
    componentName: string;
    manufacturer: string | null;
    mpn: string | null;
    specification: string | null;
    targetCountry: string | null;
    requestText: string;
  };
  output: PublicResearchResult | null;
  createdAt: string;
  completedAt: string | null;
};
