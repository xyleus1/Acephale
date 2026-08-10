type PublicEvidence<T> = {
  value: T | null;
  state: "SUPPORTED" | "PARTIAL" | "INFERRED" | "UNKNOWN";
  sources: Array<{ url: string; sourceType: "OFFICIAL" | "PUBLIC" | "QUOTE" | "AUTHORITY" }>;
  observedAt: string | null;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};

export type PublicResearchCandidate = {
  id: string;
  companyName: string;
  website: string | null;
  roles: string[];
  country: PublicEvidence<string>;
  facility: PublicEvidence<string>;
  productCapability: PublicEvidence<string>;
  price: PublicEvidence<number>;
  currency: PublicEvidence<string>;
  minimumOrderQuantity: PublicEvidence<number>;
  leadTimeDays: PublicEvidence<number>;
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

export type SavedProcurementCase = {
  id: string;
  status: string;
  taskKey: string;
  input: {
    researchRunId: string;
    researchInput: SavedSourcingResearchRun["input"];
  };
  result: {
    stage: "SOURCE_EVIDENCE" | "COMMERCIAL_CONFIRMATION" | "QUALITY_REVIEW";
    selectedOption: {
      id: string;
      name: string;
      sourceClass: "Official" | "Trusted" | "New";
      sourceUrl: string | null;
      price: number | null;
      currency: string | null;
      minimumOrderQuantity: number | null;
      priceType: "Modeled" | "Sourced" | "Unknown";
      deliveryDate: string | null;
      deliveryType: "Modeled" | "Sourced" | "Unknown";
      quality: "Strong" | "Conditional" | "Unverified";
    };
    gates: {
      sourceEvidence: "REVIEW_REQUIRED" | "BLOCKED";
      commercialTerms: "EVIDENCE_COMPLETE" | "REVIEW_REQUIRED";
      qualityPlan: "REVIEW_REQUIRED";
      purchaseApproval: "BLOCKED";
    };
    selectionHash: string;
    updatedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};
