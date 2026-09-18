import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { configureDeryaGoalSpec, type DeryaBusinessSnapshot, type DeryaBootstrapConfiguration } from "./derya-bootstrap";
import type { ChatIdentity } from "./derya-chat";
import { DERYA_READ_TOOLS } from "./derya-read-executor";
import { copy, hash } from "../goalspec/canonical";
import { RESEARCH_MODELS, type ModelPort } from "../goalspec/model";
import type { Allocation, BudgetLedger } from "../goalspec/budget";
import { DurableBudget } from "../../../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../../../services/goalspec-runtime/artifacts";
import { maximumCost, researchProvider } from "../../../services/goalspec-runtime/provider";
import { loadControllerArtifact } from "../goalspec/controller";
import { LocalActionKindController } from "../goalspec/controller-action-kind";
import { validateControllerV5Artifact } from "../goalspec/controller-v5";
import { validateMemoryArtifact } from "../goalspec/experience-memory";
import { validateEpochOptions, type DeryaEpochOptions } from "./derya-epochs";

type Tool = { name: string; input_schema: unknown };
type Environment = Record<string, string | undefined>;
export function loadDeryaV5Configuration(path: string) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  const estimateKeys = ["contentionMs", "contextMs", "measuredExposureBenefitMs", "predictionMs", "schedulingMs", "toolMs", "validationMs"];
  if (config.version !== 1 || typeof config.controllerPath !== "string"
    || !["none", "literal", "hypotheses"].includes(config.actorContext)
    || typeof config.goalConditioning !== "boolean" || typeof config.exposeEvidence !== "boolean"
    || !config.estimate || Object.keys(config.estimate).sort().join() !== estimateKeys.join()
    || Object.values(config.estimate).some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid Derya v5 server configuration");
  }
  const controllerArtifact = validateControllerV5Artifact(JSON.parse(readFileSync(resolve(config.controllerPath), "utf8")));
  const memory = config.memoryPath ? validateMemoryArtifact(JSON.parse(readFileSync(resolve(config.memoryPath), "utf8"))) : undefined;
  const epochOptions: DeryaEpochOptions = config.epochOptions ?? { mode: "off" };
  validateEpochOptions(epochOptions);
  return { v5: { controllerArtifact, memory, actorContext: config.actorContext,
    goalConditioning: config.goalConditioning, exposeEvidence: config.exposeEvidence },
    utilityEstimate: config.estimate, epochOptions,
    contentHash: hash({ config, controllerArtifact, memory: memory ?? null }) };
}
export interface DeryaServerDependencies {
  environment(): Environment;
  budget(path: string): { ledger: BudgetLedger; close(): void };
  events(path: string): { append(event: unknown): void; close(): void };
  provider(ledger: BudgetLedger, allocation: Allocation, record: (event: unknown) => void): { model: ModelPort; embed(query: string): Promise<number[]> };
  configure(configuration: DeryaBootstrapConfiguration): { close(): Promise<void> };
  snapshot(path: string): DeryaBusinessSnapshot;
}
const defaults: DeryaServerDependencies = {
  environment: () => process.env,
  budget: path => new DurableBudget(path),
  events: path => new ImmutableEventLog(path),
  provider: researchProvider,
  configure: configureDeryaGoalSpec,
  snapshot: path => JSON.parse(readFileSync(path, "utf8")),
};

// Trusted server injection, never a chat parameter. Importing creates no database
// connection, filesystem access or provider dispatch.
export function createDeryaServerComposition(dependencies: DeryaServerDependencies = defaults) {
  let initialization: Promise<void> | undefined;
  let release: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  let stopped = false;
  let fingerprint: string | undefined;
  const beforeExit = () => { void close(); };

  async function ensure(tools: readonly Tool[], identity?: ChatIdentity) {
    if (!identity || identity.accessKind !== "operator" || !identity.canViewWholeOffice) return;
    if (stopped) throw new Error("Derya GoalSpec server is closed");
    const environment = dependencies.environment();
    const directory = environment.GOALSPEC_DERYA_BUDGET_DIRECTORY;
    if (!directory) return;
    const databaseUrl = environment.DATABASE_URL;
    if (!databaseUrl || !environment.OPENAI_API_KEY) throw new Error("Derya GoalSpec server credentials unavailable");
    const root = resolve(directory);
    if (environment.GOALSPEC_BUDGET_DIRECTORY && root !== resolve(environment.GOALSPEC_BUDGET_DIRECTORY)) throw new Error("Derya must use the declared shared budget directory");
    const parameters = Object.fromEntries(tools.filter(tool => (DERYA_READ_TOOLS as readonly string[]).includes(tool.name))
      .map(tool => [tool.name, tool.input_schema as Record<string, unknown>]));
    if (!Object.keys(parameters).length) throw new Error("Audited Derya read schemas required");
    const snapshotPath = environment.GOALSPEC_DERYA_SNAPSHOT_FILE ? resolve(environment.GOALSPEC_DERYA_SNAPSHOT_FILE) : null;
    const controllerPath = environment.GOALSPEC_DERYA_CONTROLLER_FILE ? resolve(environment.GOALSPEC_DERYA_CONTROLLER_FILE) : null;
    const actionKindPath = environment.GOALSPEC_DERYA_ACTION_KIND_FILE ? resolve(environment.GOALSPEC_DERYA_ACTION_KIND_FILE) : null;
    const v5Path = environment.GOALSPEC_DERYA_V5_CONFIGURATION_FILE ? resolve(environment.GOALSPEC_DERYA_V5_CONFIGURATION_FILE) : null;
    const v5 = v5Path ? loadDeryaV5Configuration(v5Path) : undefined;
    const environmentVersion = environment.GOALSPEC_DERYA_ENVIRONMENT_VERSION ?? "derya-goalspec-v1";
    // This fingerprint stays in memory; never log database URLs or credentials.
    const current = hash({ root, databaseUrl, snapshotPath, controllerPath, actionKindPath, environmentVersion, parameters,
      v5Path, v5Hash: v5?.contentHash ?? null });
    if (fingerprint && fingerprint !== current) throw new Error("Derya GoalSpec server configuration changed; restart required");
    if (initialization) return initialization;
    fingerprint = current;
    const pending = (async () => {
      const snapshot = snapshotPath ? copy(dependencies.snapshot(snapshotPath)) : undefined;
      if (snapshot && (snapshot.schemaVersion !== 1 || snapshot.purpose !== "derya_business"
        || snapshot.source !== "derya_native_verified" || snapshot.recordsHash !== hash(snapshot.records))) throw new Error("Only verified business snapshots may initialize Derya");
      // Validate immutable model files before taking budget ownership. An
      // explicitly configured invalid artifact never silently falls back.
      const controllerArtifact = controllerPath ? loadControllerArtifact(JSON.parse(readFileSync(controllerPath, "utf8"))) : undefined;
      const actionKindArtifact = actionKindPath ? new LocalActionKindController(JSON.parse(readFileSync(actionKindPath, "utf8"))).artifact : undefined;
      const budget = dependencies.budget(join(root, "budget.jsonl"));
      let events: ReturnType<DeryaServerDependencies["events"]> | undefined;
      let runtime: ReturnType<DeryaServerDependencies["configure"]> | undefined;
      try {
        events = dependencies.events(join(root, `derya-events-${randomUUID()}.jsonl`));
        const record = (event: unknown) => events!.append(event);
        const provider = dependencies.provider(budget.ledger, "preparation", record);
        record({ type: "derya_server_initialized", schemaHash: hash(parameters), snapshotId: snapshot?.snapshotId ?? null,
          actorModel: "existing_gpt-5.6", predictorModel: RESEARCH_MODELS.goal, budgetOwner: "shared_durable_ledger",
          controllerArtifactHash: controllerArtifact?.contentHash ?? null, actionKindArtifactHash: actionKindArtifact?.contentHash ?? null,
          v5ConfigurationHash: v5?.contentHash ?? null, actionKindTelemetryOnly: true });
        runtime = dependencies.configure({ databaseUrl, environmentVersion, tools: parameters,
          controllerArtifact, actionKindArtifact,
          ...(v5 ? { v5: v5.v5, utilityEstimate: v5.utilityEstimate, epochOptions: v5.epochOptions } : {}),
          model: provider.model, embed: provider.embed, record,
          allocation: "preparation", maximumPredictionAttemptMicrodollars: maximumCost(RESEARCH_MODELS.goal, 8192, 1024),
          snapshot: async scope => snapshot ?? { schemaVersion: 1, purpose: "derya_business", source: "derya_native_verified",
            snapshotId: `derya-empty-v1:${hash(scope)}`, tenantId: scope.tenantId, records: [], recordsHash: hash([]) },
        });
        release = async () => {
          try { await runtime!.close(); }
          finally { try { events!.close(); } finally { budget.close(); } }
        };
        process.once("beforeExit", beforeExit);
      } catch (error) {
        try { await runtime?.close(); }
        finally { try { events?.close(); } finally { budget.close(); } }
        throw error;
      }
    })();
    initialization = pending;
    try { await pending; }
    catch (error) {
      if (initialization === pending) { initialization = undefined; fingerprint = undefined; }
      throw error;
    }
  }
  function close() {
    if (closing) return closing;
    stopped = true;
    closing = (async () => {
      try { await initialization; } catch { /* Initialization already released ownership. */ }
      process.removeListener("beforeExit", beforeExit);
      await release?.();
    })();
    return closing;
  }
  return { ensure, close };
}

// One owner survives development hot reloads and module re-evaluation.
const serverGlobal = globalThis as typeof globalThis & { __goalspecDeryaServer?: ReturnType<typeof createDeryaServerComposition> };
function sharedComposition() { return serverGlobal.__goalspecDeryaServer ??= createDeryaServerComposition(); }
export async function ensureDeryaGoalSpec(tools: readonly Tool[], identity?: ChatIdentity) { await sharedComposition().ensure(tools, identity); }
export async function closeDeryaGoalSpec() { await serverGlobal.__goalspecDeryaServer?.close(); }
