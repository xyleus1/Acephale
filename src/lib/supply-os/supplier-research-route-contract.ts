import {
  missingSourcingFields,
  normalizeSourcingRequestDraft,
} from "./sourcing-request-contract";

type JsonRecord = Record<string, unknown>;

export type SupplierResearchRouteInput = {
  componentItemKey: string;
  componentName: string;
  manufacturer: string | null;
  mpn: string | null;
  specification: string | null;
  targetCountry: string | null;
  requestText: string;
  requestedQuantity: number | null;
  requestedUnit: string | null;
  sourceRegion: string | null;
  deliveryLocation: string | null;
  needByDate: string | null;
};

export type SupplierResearchRouteContext = {
  officeId: string;
  userId: string;
  role: string;
  canViewWholeOffice: boolean;
};

export type SupplierResearchRouteResponse = {
  status: number;
  body: JsonRecord;
  headers?: Record<string, string>;
};

export type SupplierResearchRouteDependencies = {
  consumeRateLimit: (key: string) => boolean;
  startRun: (
    context: SupplierResearchRouteContext,
    input: SupplierResearchRouteInput,
    workspaceId: string | undefined,
  ) => Promise<{ id: string; workspaceId: string }>;
  search: (input: SupplierResearchRouteInput & { officeId: string; workspaceId: string }) => Promise<unknown>;
  supplierFailure: (error: unknown) => { code: string; message: string; status: number };
  failRun: (args: {
    context: SupplierResearchRouteContext;
    runId: string;
    workspaceId: string;
    message: string;
  }) => Promise<unknown>;
  completeRun: (args: {
    context: SupplierResearchRouteContext;
    runId: string;
    workspaceId: string;
    output: unknown;
  }) => Promise<unknown>;
  intelligenceProfile: (context: SupplierResearchRouteContext, workspaceId: string) => Promise<unknown>;
  persistenceFailure: (error: unknown) => Promise<SupplierResearchRouteResponse> | SupplierResearchRouteResponse;
};

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function requiredText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, max) ?? null;
}

function optionalPositiveNumber(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function parseSupplierResearchRouteBody(body: unknown):
  | { ok: true; input: SupplierResearchRouteInput; workspaceId: string | undefined }
  | { ok: false; response: SupplierResearchRouteResponse } {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? body as JsonRecord : {};
  const componentItemKey = requiredText(raw.componentItemKey, 180);
  const componentName = requiredText(raw.componentName, 240);
  const manufacturer = optionalText(raw.manufacturer, 180);
  const mpn = optionalText(raw.mpn, 180);
  const specification = optionalText(raw.specification, 1_000);
  const targetCountry = optionalText(raw.targetCountry, 120);
  const requestText = optionalText(raw.requestText, 500);
  const requestedQuantity = optionalPositiveNumber(raw.requestedQuantity);
  const requestedUnit = optionalText(raw.requestedUnit, 40);
  const sourceRegion = optionalText(raw.sourceRegion, 180);
  const deliveryLocation = optionalText(raw.deliveryLocation, 240);
  const needByDate = optionalText(raw.needByDate, 10);
  const workspaceId = optionalText(raw.workspaceId, 220);
  if (
    !componentItemKey
    || !componentName
    || manufacturer === null
    || mpn === null
    || specification === null
    || targetCountry === null
    || requestText === null
    || requestedQuantity === null
    || requestedUnit === null
    || sourceRegion === null
    || deliveryLocation === null
    || needByDate === null
    || workspaceId === null
  ) {
    return { ok: false, response: { status: 400, body: { error: "A valid component request is required." } } };
  }
  const missingFields = missingSourcingFields(normalizeSourcingRequestDraft({
    productName: componentName,
    quantity: requestedQuantity,
    unit: requestedUnit,
    manufacturer,
    partNumber: mpn,
    specification,
    sourceRegion,
    deliveryLocation,
    needByDate,
  }));
  if (missingFields.length) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          error: "Complete the sourcing request before supplier research.",
          missingFields,
        },
      },
    };
  }
  return {
    ok: true,
    workspaceId: workspaceId ?? undefined,
    input: {
      componentItemKey,
      componentName,
      manufacturer: manufacturer ?? null,
      mpn: mpn ?? null,
      specification: specification ?? null,
      targetCountry: targetCountry ?? null,
      requestText: requestText ?? componentName,
      requestedQuantity: requestedQuantity ?? null,
      requestedUnit: requestedUnit ?? null,
      sourceRegion: sourceRegion ?? null,
      deliveryLocation: deliveryLocation ?? null,
      needByDate: needByDate ?? null,
    },
  };
}

export async function executeSupplierResearchRoute(args: {
  body: unknown;
  context: SupplierResearchRouteContext;
  dependencies: SupplierResearchRouteDependencies;
}): Promise<SupplierResearchRouteResponse> {
  const parsed = parseSupplierResearchRouteBody(args.body);
  if (!parsed.ok) return parsed.response;
  const { context, dependencies } = args;
  if (!dependencies.consumeRateLimit(`${context.officeId}:${context.userId}`)) {
    return { status: 429, body: { error: "Supplier research rate limit reached." } };
  }

  let run: { id: string; workspaceId: string };
  try {
    run = await dependencies.startRun(context, parsed.input, parsed.workspaceId);
  } catch (error) {
    return await dependencies.persistenceFailure(error);
  }

  let result: unknown;
  try {
    result = await dependencies.search({
      ...parsed.input,
      officeId: context.officeId,
      workspaceId: run.workspaceId,
    });
  } catch (error) {
    const failure = dependencies.supplierFailure(error);
    try {
      await dependencies.failRun({
        context,
        runId: run.id,
        workspaceId: run.workspaceId,
        message: `${failure.code}: ${failure.message}`,
      });
    } catch (persistenceError) {
      return await dependencies.persistenceFailure(persistenceError);
    }
    return {
      status: failure.status,
      body: { error: failure.message, code: failure.code },
      headers: NO_STORE_HEADERS,
    };
  }

  try {
    const completedRun = await dependencies.completeRun({
      context,
      runId: run.id,
      workspaceId: run.workspaceId,
      output: JSON.parse(JSON.stringify(result)),
    });
    let intelligenceProfile: unknown = null;
    try {
      intelligenceProfile = await dependencies.intelligenceProfile(context, run.workspaceId);
    } catch {
      intelligenceProfile = null;
    }
    return {
      status: 200,
      body: { result, run: completedRun, intelligenceProfile },
      headers: NO_STORE_HEADERS,
    };
  } catch (error) {
    return await dependencies.persistenceFailure(error);
  }
}
