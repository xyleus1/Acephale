import {
  adaptSupplyPartsCsv,
  SUPPLY_CSV_KINDS,
  supplyCsvTemplate,
  supplyPartsCsvTemplate,
  type SupplyCsvBundle,
  type SupplyCsvColumnMappings,
  type SupplyCsvKind,
} from "./csv-import";

type JsonRecord = Record<string, unknown>;

export type SupplyCsvRouteContext = {
  officeId: string;
  userId: string;
  role: string;
  canViewWholeOffice: boolean;
};

export type SupplyCsvImportStageInput = {
  mode: "FULL_SNAPSHOT" | "PARTS_CSV";
  sourceName: string | null;
  files: SupplyCsvBundle;
  columnMappings: SupplyCsvColumnMappings;
};

export type SupplyCsvImportRouteResponse = {
  status: number;
  body: JsonRecord;
};

export type SupplyCsvImportRouteDependencies = {
  readBody: () => Promise<unknown>;
  stage: (
    context: SupplyCsvRouteContext,
    workspaceId: string,
    input: SupplyCsvImportStageInput,
  ) => Promise<unknown>;
  persistenceFailure: (
    error: unknown,
  ) => Promise<SupplyCsvImportRouteResponse> | SupplyCsvImportRouteResponse;
};

export type SupplyCsvTemplateRouteResponse =
  | {
    kind: "csv";
    status: 200;
    body: string;
    headers: Record<string, string>;
  }
  | {
    kind: "json";
    status: 404;
    body: JsonRecord;
  };

const MAX_REQUEST_BYTES = 6_000_000;
const MAX_FILE_CHARACTERS = 2_000_000;

function errorResponse(status: number, error: string, extras: JsonRecord = {}): SupplyCsvImportRouteResponse {
  return { status, body: { error, ...extras } };
}

function parseImportBody(body: unknown):
  | { ok: true; input: SupplyCsvImportStageInput }
  | { ok: false; response: SupplyCsvImportRouteResponse } {
  if (!body) {
    return { ok: false, response: errorResponse(400, "CSV import payload is required.") };
  }
  const raw = body as {
    sourceName?: unknown;
    files?: unknown;
    partsCsv?: unknown;
    columnMappings?: unknown;
  };
  const hasPartsCsv = typeof raw.partsCsv === "string" && Boolean(raw.partsCsv.trim());
  const hasBundle = Boolean(raw.files && typeof raw.files === "object" && !Array.isArray(raw.files));
  if (!hasPartsCsv && !hasBundle) {
    return {
      ok: false,
      response: errorResponse(400, "A parts CSV or normalized CSV files are required."),
    };
  }
  if (hasPartsCsv && hasBundle) {
    return {
      ok: false,
      response: errorResponse(400, "Upload either one parts CSV or a normalized CSV bundle, not both."),
    };
  }
  if (hasPartsCsv && (raw.partsCsv as string).length > MAX_FILE_CHARACTERS) {
    return { ok: false, response: errorResponse(400, "The parts CSV must be under 2 MB.") };
  }

  let files: SupplyCsvBundle = {};
  if (hasPartsCsv) {
    const adapted = adaptSupplyPartsCsv(raw.partsCsv as string);
    if (adapted.issues.length) {
      return {
        ok: false,
        response: errorResponse(400, "Parts CSV validation failed.", { issues: adapted.issues }),
      };
    }
    files = adapted.files;
  } else {
    for (const kind of SUPPLY_CSV_KINDS) {
      const value = (raw.files as Record<string, unknown>)[kind];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string" || value.length > MAX_FILE_CHARACTERS) {
        return {
          ok: false,
          response: errorResponse(400, `${kind} must be a CSV string under 2 MB.`),
        };
      }
      files[kind] = value;
    }
  }

  const columnMappings: SupplyCsvColumnMappings = {};
  if (raw.columnMappings !== undefined) {
    if (!raw.columnMappings || typeof raw.columnMappings !== "object" || Array.isArray(raw.columnMappings)) {
      return { ok: false, response: errorResponse(400, "Column mappings must be an object.") };
    }
    for (const kind of SUPPLY_CSV_KINDS) {
      const rawMapping = (raw.columnMappings as Record<string, unknown>)[kind];
      if (rawMapping === undefined) continue;
      if (!rawMapping || typeof rawMapping !== "object" || Array.isArray(rawMapping)) {
        return {
          ok: false,
          response: errorResponse(400, `${kind} column mapping must be an object.`),
        };
      }
      const entries = Object.entries(rawMapping as Record<string, unknown>);
      if (entries.length > 40 || entries.some(([key, value]) => !key || typeof value !== "string" || value.length > 100)) {
        return {
          ok: false,
          response: errorResponse(400, `${kind} column mapping is invalid.`),
        };
      }
      columnMappings[kind] = Object.fromEntries(entries) as Record<string, string>;
    }
  }

  return {
    ok: true,
    input: {
      mode: hasPartsCsv ? "PARTS_CSV" : "FULL_SNAPSHOT",
      sourceName: typeof raw.sourceName === "string" ? raw.sourceName : null,
      files,
      columnMappings,
    },
  };
}

export async function executeSupplyCsvImportRoute(args: {
  contentLength: string | null;
  context: SupplyCsvRouteContext;
  workspaceId: string;
  dependencies: SupplyCsvImportRouteDependencies;
}): Promise<SupplyCsvImportRouteResponse> {
  const contentLength = Number(args.contentLength);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse(413, "CSV import is too large.");
  }

  let body: unknown;
  try {
    body = await args.dependencies.readBody();
  } catch {
    body = null;
  }
  const parsed = parseImportBody(body);
  if (!parsed.ok) return parsed.response;

  try {
    const importRun = await args.dependencies.stage(args.context, args.workspaceId, parsed.input);
    return { status: 201, body: { importRun } };
  } catch (error) {
    return await args.dependencies.persistenceFailure(error);
  }
}

function csvHeaders(kind: SupplyCsvKind | "parts") {
  return {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="supply-os-${kind}.csv"`,
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
  };
}

export function resolveSupplyCsvTemplateRoute(kind: string): SupplyCsvTemplateRouteResponse {
  if (kind === "parts") {
    return {
      kind: "csv",
      status: 200,
      body: supplyPartsCsvTemplate(),
      headers: csvHeaders("parts"),
    };
  }
  if (!SUPPLY_CSV_KINDS.includes(kind as SupplyCsvKind)) {
    return {
      kind: "json",
      status: 404,
      body: { error: "Unknown Supply OS CSV template." },
    };
  }
  const csvKind = kind as SupplyCsvKind;
  return {
    kind: "csv",
    status: 200,
    body: supplyCsvTemplate(csvKind),
    headers: csvHeaders(csvKind),
  };
}
