export type LoadIntelBriefRecord = {
  reference: string;
  title: string | null;
  status: string;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  incoterms: string | null;
  weight: number | null;
  volume: number | null;
  packages: number | null;
  dimensions: string | null;
  stackable: string | null;
  dangerousGoods: string | null;
  customsBy: string | null;
  containerCount: number | null;
  containerType: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  declaredValue: number | null;
  declaredValueCurrency: string | null;
  etd: Date | string | null;
  eta: Date | string | null;
  company: { name: string } | null;
  inquiry: {
    reference: string | null;
    mode: string | null;
    origin: string | null;
    destination: string | null;
    commodity: string | null;
    incoterms: string | null;
    weight: number | null;
    volume: number | null;
    packages: number | null;
    dimensions: string | null;
    stackable: string | null;
    dangerousGoods: string | null;
    customsBy: string | null;
    containerCount: number | null;
    containerType: string | null;
    declaredValue: number | null;
    declaredValueCurrency: string | null;
    cargoReadyDate: Date | string | null;
    parsedData: string | null;
  } | null;
};

const MAX_BRIEF_LENGTH = 8_000;

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPath(
  value: unknown,
  paths: ReadonlyArray<ReadonlyArray<string>>
): unknown {
  for (const path of paths) {
    let current: unknown = value;
    for (const part of path) {
      const object = asObject(current);
      if (!object) {
        current = undefined;
        break;
      }
      current = object[part];
    }
    if (current != null && current !== "") return current;
  }
  return null;
}

function parseStructuredData(value: string | null): unknown {
  if (!value || value.length > 100_000) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function redactContactAndCredentialData(value: string): string {
  return value
    .replace(
      /(?:https?:\/\/|www\.)\S+/gi,
      "[link omitted]"
    )
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[email omitted]"
    )
    .replace(
      /(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]\s*\S+/gi,
      "[credential omitted]"
    )
    .replace(
      /\b(?:tax[_ -]?id|ein|tin|ssn|vat[_ -]?(?:id|number))\s*[:#=-]?\s*[A-Z0-9-]{6,}/gi,
      "[tax identifier omitted]"
    )
    .replace(
      /(?:\+?\d[\s().-]*){9,}\d/g,
      "[phone omitted]"
    );
}

function cleanText(value: unknown, maxLength = 320): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null;
  }
  const cleaned = redactContactAndCredentialData(String(value))
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function formatDate(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return cleanText(value);
  return parsed.toISOString().slice(0, 10);
}

function addLine(lines: string[], label: string, value: unknown) {
  const cleaned = cleanText(value, 700);
  if (cleaned) lines.push(`${label}: ${cleaned}`);
}

function dossierFactValue(
  structured: unknown,
  candidateKeys: ReadonlyArray<string>
): unknown {
  const root = asObject(structured);
  const dossier = asObject(root?.loadDossier ?? root?.dossier);
  if (!dossier) return null;

  const aliases: Record<string, string[]> = {
    portOfUnlading: ["portOfDischarge"],
    finalDestination: ["finalDelivery"],
    product: ["commodity"],
  };
  const expandedKeys = new Set(
    candidateKeys.flatMap((key) => [key, ...(aliases[key] ?? [])])
  );
  for (const key of expandedKeys) {
    const direct = dossier[key];
    if (direct != null && direct !== "") return direct;
  }

  if (!Array.isArray(dossier.facts)) return null;
  for (const candidate of dossier.facts) {
    const fact = asObject(candidate);
    const key = cleanText(fact?.key, 100);
    if (key && expandedKeys.has(key) && fact?.value != null) {
      return fact.value;
    }
  }
  return null;
}

function structuredText(
  structured: unknown,
  ...paths: ReadonlyArray<string>[]
): string | null {
  const direct = readPath(structured, paths);
  if (direct != null && direct !== "") return cleanText(direct, 700);
  const candidateKeys = paths
    .map((path) => path[path.length - 1])
    .filter((key): key is string => Boolean(key));
  return cleanText(dossierFactValue(structured, candidateKeys), 700);
}

function structuredHts(
  structured: unknown,
  ...paths: ReadonlyArray<string>[]
): string | null {
  const direct = readPath(structured, paths);
  const candidateKeys = paths
    .map((path) => path[path.length - 1])
    .filter((key): key is string => Boolean(key));
  const value = direct ?? dossierFactValue(structured, candidateKeys);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 4 && digits.length <= 10 ? digits : null;
}

/**
 * Creates the only payload that a load page may hand to the standalone Intel
 * review. It intentionally has no fields for email bodies, notes, contacts,
 * phone numbers, tax identifiers, credentials, or file contents.
 */
export function buildLoadIntelBrief(job: LoadIntelBriefRecord): string {
  const inquiry = job.inquiry;
  const structured = parseStructuredData(inquiry?.parsedData ?? null);
  const lines: string[] = [];

  addLine(lines, "Shipment", job.reference);
  addLine(lines, "Load title", job.title);
  addLine(lines, "Customer", job.company?.name);
  addLine(lines, "Status", job.status);
  addLine(lines, "Mode", firstText(job.mode, inquiry?.mode));
  addLine(
    lines,
    "Country of export",
    structuredText(
      structured,
      ["facts", "countryOfExport"],
      ["route", "countryOfExport"],
      ["countryOfExport"]
    )
  );
  addLine(lines, "Origin", firstText(job.origin, inquiry?.origin));
  addLine(
    lines,
    "Port of loading",
    structuredText(
      structured,
      ["facts", "portOfLoading"],
      ["route", "portOfLoading"],
      ["portOfLoading"]
    )
  );
  addLine(
    lines,
    "Port of unlading",
    structuredText(
      structured,
      ["facts", "portOfUnlading"],
      ["route", "portOfUnlading"],
      ["portOfUnlading"]
    )
  );
  addLine(
    lines,
    "Final delivery",
    firstText(
      structuredText(
        structured,
        ["facts", "finalDelivery"],
        ["route", "finalDestination"],
        ["finalDestination"]
      ),
      job.destination,
      inquiry?.destination
    )
  );
  addLine(
    lines,
    "Product",
    firstText(
      job.commodity,
      inquiry?.commodity,
      structuredText(
        structured,
        ["facts", "product"],
        ["product", "description"],
        ["productDescription"]
      )
    )
  );
  addLine(
    lines,
    "Model",
    structuredText(
      structured,
      ["facts", "model"],
      ["product", "model"],
      ["model"]
    )
  );
  addLine(
    lines,
    "Manufacturer",
    structuredText(
      structured,
      ["facts", "manufacturer"],
      ["product", "manufacturer"],
      ["manufacturer"]
    )
  );
  addLine(
    lines,
    "Principal function",
    structuredText(
      structured,
      ["facts", "principalFunction"],
      ["product", "principalFunction"],
      ["principalFunction"]
    )
  );
  addLine(
    lines,
    "Intended use",
    structuredText(
      structured,
      ["facts", "intendedUse"],
      ["product", "intendedUse"],
      ["intendedUse"]
    )
  );

  const containerCount = job.containerCount ?? inquiry?.containerCount;
  const containerType = firstText(job.containerType, inquiry?.containerType);
  if (containerCount != null || containerType) {
    addLine(
      lines,
      "Container",
      [containerCount, containerType].filter(Boolean).join(" x ")
    );
  }
  if (job.quantity != null || job.quantityUnit) {
    addLine(
      lines,
      "Quantity",
      [job.quantity, job.quantityUnit].filter(Boolean).join(" ")
    );
  }
  addLine(lines, "Gross weight in kg", job.weight ?? inquiry?.weight);
  addLine(lines, "Volume in cbm", job.volume ?? inquiry?.volume);
  addLine(lines, "Packages", job.packages ?? inquiry?.packages);
  addLine(
    lines,
    "Dimensions",
    firstText(job.dimensions, inquiry?.dimensions)
  );
  addLine(lines, "Stackable", firstText(job.stackable, inquiry?.stackable));
  addLine(
    lines,
    "Dangerous goods",
    firstText(job.dangerousGoods, inquiry?.dangerousGoods)
  );
  addLine(lines, "Incoterm", firstText(job.incoterms, inquiry?.incoterms));
  addLine(
    lines,
    "Customs handled by",
    firstText(job.customsBy, inquiry?.customsBy)
  );
  addLine(lines, "Cargo ready", formatDate(inquiry?.cargoReadyDate ?? null));
  addLine(lines, "Expected departure", formatDate(job.etd));
  addLine(lines, "Expected arrival", formatDate(job.eta));

  const declaredValue = job.declaredValue ?? inquiry?.declaredValue;
  const declaredCurrency = firstText(
    job.declaredValueCurrency,
    inquiry?.declaredValueCurrency
  );
  if (declaredValue != null || declaredCurrency) {
    addLine(
      lines,
      "Invoice value",
      [declaredCurrency, declaredValue].filter(Boolean).join(" ")
    );
  }
  const proposedHts = structuredHts(
    structured,
    ["facts", "proposedHts10"],
    ["product", "proposedHts10"],
    ["proposedHts10"]
  );
  if (proposedHts) lines.push(`Proposed HTS: ${proposedHts}`);
  addLine(
    lines,
    "Batteries installed",
    structuredText(
      structured,
      ["facts", "batteriesInstalled"],
      ["product", "batteriesInstalled"],
      ["batteriesInstalled"]
    )
  );
  addLine(
    lines,
    "Packaging",
    structuredText(
      structured,
      ["facts", "packaging"],
      ["packaging", "description"],
      ["packaging"]
    )
  );
  addLine(
    lines,
    "Return plan",
    structuredText(
      structured,
      ["facts", "returnPlan"],
      ["entry", "returnPlan"],
      ["returnPlan"]
    )
  );

  return lines.join("\n").slice(0, MAX_BRIEF_LENGTH);
}
