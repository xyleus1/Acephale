import assert from "node:assert/strict";
import {
  executeSupplyCsvImportRoute,
  resolveSupplyCsvTemplateRoute,
  type SupplyCsvImportRouteDependencies,
  type SupplyCsvImportStageInput,
  type SupplyCsvRouteContext,
} from "../src/lib/supply-os/csv-route-contract";
import {
  SUPPLY_CSV_KINDS,
  supplyCsvTemplate,
  supplyPartsCsvTemplate,
} from "../src/lib/supply-os/csv-import";

const context: SupplyCsvRouteContext = {
  officeId: "office-a",
  userId: "user-a",
  role: "ADMIN",
  canViewWholeOffice: true,
};

type StageCall = {
  context: SupplyCsvRouteContext;
  workspaceId: string;
  input: SupplyCsvImportStageInput;
};

function dependencies(args: {
  body?: unknown;
  readBody?: () => Promise<unknown>;
  stage?: SupplyCsvImportRouteDependencies["stage"];
  persistenceFailure?: SupplyCsvImportRouteDependencies["persistenceFailure"];
} = {}) {
  const calls: StageCall[] = [];
  const value: SupplyCsvImportRouteDependencies = {
    readBody: args.readBody ?? (async () => args.body),
    stage: args.stage ?? (async (routeContext, workspaceId, input) => {
      calls.push({ context: routeContext, workspaceId, input });
      return { id: "import-1", status: "READY" };
    }),
    persistenceFailure: args.persistenceFailure ?? (() => ({
      status: 500,
      body: { error: "mapped persistence failure" },
    })),
  };
  return { calls, value };
}

async function execute(args: {
  body?: unknown;
  contentLength?: string | null;
  dependencies?: ReturnType<typeof dependencies>;
}) {
  const fixture = args.dependencies ?? dependencies({ body: args.body });
  const response = await executeSupplyCsvImportRoute({
    contentLength: args.contentLength ?? null,
    context,
    workspaceId: "workspace-a",
    dependencies: fixture.value,
  });
  return { fixture, response };
}

async function main() {
  const partsCsv = [
    "Item,Procurement description,Example specification,Qty,Supplier deliverable / QA",
    "001,Main cylindrical structural skin stock,6061-T6 sheet 2.0 mm,4 blanks,Material certificate",
  ].join("\n");
  const parts = await execute({
    body: { sourceName: "customer-parts.csv", partsCsv },
  });
  assert.deepEqual(parts.response, {
    status: 201,
    body: { importRun: { id: "import-1", status: "READY" } },
  });
  assert.equal(parts.fixture.calls.length, 1);
  assert.deepEqual(parts.fixture.calls[0]?.context, context);
  assert.equal(parts.fixture.calls[0]?.workspaceId, "workspace-a");
  assert.equal(parts.fixture.calls[0]?.input.mode, "PARTS_CSV");
  assert.equal(parts.fixture.calls[0]?.input.sourceName, "customer-parts.csv");
  assert.match(parts.fixture.calls[0]?.input.files.items ?? "", /PARTS_CSV/);
  assert.equal(parts.fixture.calls[0]?.input.files.locations?.endsWith("\n"), true);
  assert.deepEqual(parts.fixture.calls[0]?.input.columnMappings, {});

  const normalizedFiles = {
    locations: "location_key,name\nAUS,Austin",
    items: "item_key,name,unit\nITEM-1,Assembly,EA",
  };
  const bundle = await execute({
    body: {
      sourceName: "erp-export",
      files: normalizedFiles,
      columnMappings: {
        items: { item_key: "item_key", name: "name", unit: "unit" },
      },
    },
  });
  assert.equal(bundle.response.status, 201);
  assert.deepEqual(bundle.fixture.calls[0]?.input, {
    mode: "FULL_SNAPSHOT",
    sourceName: "erp-export",
    files: normalizedFiles,
    columnMappings: {
      items: { item_key: "item_key", name: "name", unit: "unit" },
    },
  });

  const missing = await execute({ body: {} });
  assert.deepEqual(missing.response, {
    status: 400,
    body: { error: "A parts CSV or normalized CSV files are required." },
  });
  assert.equal(missing.fixture.calls.length, 0);

  const invalidJson = dependencies({
    readBody: async () => {
      throw new SyntaxError("bad JSON");
    },
  });
  const malformedPayload = await execute({ dependencies: invalidJson });
  assert.deepEqual(malformedPayload.response, {
    status: 400,
    body: { error: "CSV import payload is required." },
  });
  assert.equal(invalidJson.calls.length, 0);

  const dual = await execute({ body: { partsCsv, files: normalizedFiles } });
  assert.deepEqual(dual.response, {
    status: 400,
    body: { error: "Upload either one parts CSV or a normalized CSV bundle, not both." },
  });
  assert.equal(dual.fixture.calls.length, 0);

  let oversizedBodyRead = false;
  const oversizedRequest = dependencies({
    readBody: async () => {
      oversizedBodyRead = true;
      return { partsCsv };
    },
  });
  const requestTooLarge = await execute({
    contentLength: "6000001",
    dependencies: oversizedRequest,
  });
  assert.deepEqual(requestTooLarge.response, {
    status: 413,
    body: { error: "CSV import is too large." },
  });
  assert.equal(oversizedBodyRead, false, "request size must be rejected before JSON allocation");
  assert.equal(oversizedRequest.calls.length, 0);

  const partsTooLarge = await execute({ body: { partsCsv: "x".repeat(2_000_001) } });
  assert.deepEqual(partsTooLarge.response, {
    status: 400,
    body: { error: "The parts CSV must be under 2 MB." },
  });
  assert.equal(partsTooLarge.fixture.calls.length, 0);

  const normalizedFileTooLarge = await execute({
    body: { files: { items: "x".repeat(2_000_001) } },
  });
  assert.deepEqual(normalizedFileTooLarge.response, {
    status: 400,
    body: { error: "items must be a CSV string under 2 MB." },
  });
  assert.equal(normalizedFileTooLarge.fixture.calls.length, 0);

  const invalidParts = await execute({ body: { partsCsv: "wrong,headers\n1,2" } });
  assert.equal(invalidParts.response.status, 400);
  assert.equal(invalidParts.response.body.error, "Parts CSV validation failed.");
  assert.ok(Array.isArray(invalidParts.response.body.issues));
  assert.equal(invalidParts.fixture.calls.length, 0);

  for (const columnMappings of [
    [],
    { items: [] },
    { items: { item_key: 42 } },
    { items: { "": "item_key" } },
    { items: { item_key: "x".repeat(101) } },
    { items: Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`field_${index}`, `column_${index}`])) },
  ]) {
    const malformedMapping = await execute({
      body: { files: normalizedFiles, columnMappings },
    });
    assert.equal(malformedMapping.response.status, 400);
    assert.match(String(malformedMapping.response.body.error), /Column mappings|column mapping/);
    assert.equal(malformedMapping.fixture.calls.length, 0);
  }

  const persistenceSentinel = new Error("database conflict with internal detail");
  let mappedError: unknown;
  const stagingFailure = dependencies({
    body: { files: normalizedFiles },
    stage: async () => {
      throw persistenceSentinel;
    },
    persistenceFailure: (error) => {
      mappedError = error;
      return { status: 409, body: { error: "A newer snapshot already exists.", issues: [] } };
    },
  });
  const mappedFailure = await execute({ dependencies: stagingFailure });
  assert.equal(mappedError, persistenceSentinel);
  assert.deepEqual(mappedFailure.response, {
    status: 409,
    body: { error: "A newer snapshot already exists.", issues: [] },
  });

  const partsTemplate = resolveSupplyCsvTemplateRoute("parts");
  assert.equal(partsTemplate.kind, "csv");
  if (partsTemplate.kind === "csv") {
    assert.equal(partsTemplate.status, 200);
    assert.equal(partsTemplate.body, supplyPartsCsvTemplate());
    assert.equal(partsTemplate.headers["content-disposition"], 'attachment; filename="supply-os-parts.csv"');
    assert.equal(partsTemplate.headers["content-type"], "text/csv; charset=utf-8");
    assert.equal(partsTemplate.headers["cache-control"], "private, max-age=300");
    assert.equal(partsTemplate.headers["x-content-type-options"], "nosniff");
  }

  for (const kind of SUPPLY_CSV_KINDS) {
    const template = resolveSupplyCsvTemplateRoute(kind);
    assert.equal(template.kind, "csv");
    if (template.kind === "csv") {
      assert.equal(template.body, supplyCsvTemplate(kind));
      assert.equal(template.headers["content-disposition"], `attachment; filename="supply-os-${kind}.csv"`);
    }
  }

  assert.deepEqual(resolveSupplyCsvTemplateRoute("unknown"), {
    kind: "json",
    status: 404,
    body: { error: "Unknown Supply OS CSV template." },
  });

  console.log("Supply OS CSV route contract checks passed.");
}

void main();
