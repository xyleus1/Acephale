// Deterministic facts derived from uploaded context files.
//
// Extraction alone stores raw file text, and an LLM drafting a supplier request
// can silently drop the manufacturability drivers buried in it. These helpers
// restate those drivers as plain sentences inside the stored document markdown,
// so every downstream reader, prompt, and supplier request carries them.

const MAX_LISTED_VALUES = 12;

// Footprint fields glue tokens together with underscores, as in
// Capacitor_SMD:C_0201_0603Metric, where a \b boundary would never match. These
// patterns fence tokens with alphanumeric lookarounds instead.
function tokenPattern(tokens: string[], flags: string) {
  return new RegExp(`(?<![A-Za-z0-9])(${tokens.join("|")})(?![A-Za-z0-9])`, flags);
}

// KiCad and DigiKey exports label this column MP, MPN, Manufacturer Part, or
// glue the words with underscores, as in Manufacturer_Part_Number.
const MANUFACTURER_PART_HEADER = tokenPattern(
  ["mpn", "mp", "manufacturer[_\\s-]?part"],
  "i",
);

// A distributor column such as DigiKey_Part_Number identifies a bill of
// materials too, but it only stands in when no manufacturer column exists.
const PART_NUMBER_HEADER = tokenPattern(
  ["mpn", "mp", "manufacturer[_\\s-]?part", "part[_\\s-]?number"],
  "i",
);

const BOM_HEADER_SIGNALS = [
  /\b(reference|references|refdes|designator|designators)\b/i,
  /\b(qty|quantity)\b/i,
  /\b(footprint|package)\b/i,
  PART_NUMBER_HEADER,
  /\bvalue\b/i,
  /\bdescription\b/i,
];

const PASSIVE_PACKAGE_PATTERN = tokenPattern(["0201", "0402", "0603", "0805", "1206", "1210", "2010", "2512"], "g");
const FINE_PITCH_PATTERN = tokenPattern(["WLCSP", "WSON", "UDFN", "TDFN", "QFN", "DFN", "SON", "LGA", "BGA", "CSP"], "gi");
const CONNECTOR_PATTERN = tokenPattern(["connector", "receptacle", "header", "FPC", "FFC", "JST", "molex", "hirose", "USB"], "i");
const MODULE_PATTERN = /(?<![A-Za-z0-9])(module|mods|xiao|breakout)(?![A-Za-z0-9])/i;
const HAND_ATTACHED_PATTERN = tokenPattern(["motor", "switch", "wire", "lead", "battery", "speaker", "buzzer"], "i");
const TEST_POINT_PATTERN = /test[_\s-]?point/i;

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function csvRows(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(splitCsvLine);
}

function looksLikeBillOfMaterials(header: string[]) {
  const joined = header.join(" ");
  return BOM_HEADER_SIGNALS.filter((pattern) => pattern.test(joined)).length >= 3;
}

function headerIndex(header: string[], pattern: RegExp) {
  const index = header.findIndex((cell) => pattern.test(cell));
  return index === -1 ? null : index;
}

function countPlacements(designators: string, quantity: string) {
  const parsed = Number(quantity.replace(/[^\d.]/g, ""));
  if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  const listed = designators.split(",").filter((value) => value.trim()).length;
  return listed || 1;
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort();
}

function listSentence(label: string, values: string[]) {
  if (!values.length) return null;
  const shown = values.slice(0, MAX_LISTED_VALUES);
  const suffix = values.length > shown.length ? `, and ${values.length - shown.length} more` : "";
  return `${label}: ${shown.join(", ")}${suffix}`;
}

export type BillOfMaterialsFacts = {
  componentLines: number;
  placements: number;
  distinctPartNumbers: number;
  // Which column the part numbers came from, so derived text never calls a
  // distributor number a manufacturer number.
  partNumberSource: "MANUFACTURER" | "DISTRIBUTOR" | null;
  passivePackages: string[];
  finePitchPackages: string[];
  connectorLines: number;
  moduleLines: string[];
  handAttachedLines: string[];
  testPointLines: number;
};

export function billOfMaterialsFacts(text: string): BillOfMaterialsFacts | null {
  const rows = csvRows(text);
  const header = rows[0];
  if (!header || rows.length < 2 || !looksLikeBillOfMaterials(header)) return null;

  const designatorColumn = headerIndex(header, /\b(reference|references|refdes|designator|designators)\b/i) ?? 0;
  const quantityColumn = headerIndex(header, /\b(qty|quantity)\b/i);
  const manufacturerPartColumn = headerIndex(header, MANUFACTURER_PART_HEADER);
  const partColumn = manufacturerPartColumn ?? headerIndex(header, PART_NUMBER_HEADER);

  const passivePackages = new Set<string>();
  const finePitchPackages = new Set<string>();
  const partNumbers = new Set<string>();
  const moduleLines = new Set<string>();
  const handAttachedLines = new Set<string>();
  let placements = 0;
  let connectorLines = 0;
  let testPointLines = 0;

  const bodyRows = rows.slice(1);
  for (const row of bodyRows) {
    const joined = row.join(" ");
    const designators = row[designatorColumn] ?? "";
    placements += countPlacements(designators, quantityColumn === null ? "" : row[quantityColumn] ?? "");
    const partNumber = partColumn === null ? "" : (row[partColumn] ?? "").trim();
    if (partNumber && partNumber !== "~") partNumbers.add(partNumber);
    for (const match of joined.matchAll(PASSIVE_PACKAGE_PATTERN)) passivePackages.add(match[1]);
    for (const match of joined.matchAll(FINE_PITCH_PATTERN)) finePitchPackages.add(match[1].toUpperCase());
    if (CONNECTOR_PATTERN.test(joined)) connectorLines += 1;
    if (TEST_POINT_PATTERN.test(joined)) testPointLines += 1;
    if (MODULE_PATTERN.test(joined) && designators) moduleLines.add(designators);
    if (HAND_ATTACHED_PATTERN.test(joined) && designators) handAttachedLines.add(designators);
  }

  return {
    componentLines: bodyRows.length,
    placements,
    distinctPartNumbers: partNumbers.size,
    partNumberSource: partColumn === null
      ? null
      : manufacturerPartColumn === null ? "DISTRIBUTOR" : "MANUFACTURER",
    passivePackages: uniqueSorted(passivePackages),
    finePitchPackages: uniqueSorted(finePitchPackages),
    connectorLines,
    moduleLines: uniqueSorted(moduleLines),
    handAttachedLines: uniqueSorted(handAttachedLines),
    testPointLines,
  };
}

export function billOfMaterialsFactsText(text: string) {
  const facts = billOfMaterialsFacts(text);
  if (!facts) return null;
  const smallestPassive = facts.passivePackages[0] ?? null;
  const lines = [
    "Derived bill of materials facts, computed from the file rows:",
    `Component lines: ${facts.componentLines}`,
    `Total placements: ${facts.placements}`,
    facts.distinctPartNumbers
      ? `Distinct ${facts.partNumberSource === "DISTRIBUTOR" ? "distributor" : "manufacturer"} part numbers: ${facts.distinctPartNumbers}`
      : null,
    listSentence("Passive package sizes present", facts.passivePackages),
    smallestPassive ? `Smallest passive package: ${smallestPassive}` : null,
    listSentence("Fine pitch or bottom terminated package families present", facts.finePitchPackages),
    facts.connectorLines ? `Connector lines: ${facts.connectorLines}` : null,
    listSentence("Lines with a custom or module footprint, some of which may be preassembled modules", facts.moduleLines),
    listSentence("Lines that may need hand attachment or wiring", facts.handAttachedLines),
    facts.testPointLines ? `Test point lines: ${facts.testPointLines}` : null,
    "Assembly difficulty follows the smallest package and the fine pitch families above. State them in any supplier request built from this file.",
  ];
  return lines.filter(Boolean).join("\n");
}

const MOLD_ALLOWANCE_PER_SIDE = 10;

function rounded(value: number) {
  return String(Math.round(value * 100) / 100);
}

export function stlPartFactsText(args: {
  dimensions: [number, number, number];
  triangles: number;
}) {
  const [x, y, z] = args.dimensions;
  if (![x, y, z].every((value) => Number.isFinite(value) && value > 0)) return null;
  const sorted = [x, y, z].slice().sort((a, b) => b - a);
  const envelope = [x, y, z].map((value) => value + MOLD_ALLOWANCE_PER_SIDE * 2);
  return [
    "Derived part facts, computed from the mesh:",
    `Bounding box: ${rounded(x)} x ${rounded(y)} x ${rounded(z)} in model units, most commonly millimetres.`,
    `Largest face: ${rounded(sorted[0])} x ${rounded(sorted[1])}. Smallest dimension, usually the part thickness: ${rounded(sorted[2])}.`,
    `Tool envelope needed if the units are millimetres, using a ${MOLD_ALLOWANCE_PER_SIDE} mm allowance per side: ${envelope.map(rounded).join(" x ")}. Treat this as a derived starting point for tooling, not a supplied requirement.`,
    "State the bounding box in any supplier request built from this file so quotes cover the real tool size.",
  ].join("\n");
}
