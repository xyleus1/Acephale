import type { Prisma } from "@prisma/client";
import { hash } from "../goalspec/canonical";
import type { DeryaReadTool } from "./derya-read-executor";

// Internal global counters contain no tenant observations. Scoped authoritative
// company-owner reads are never cached and do not belong to this contract.
export const DERYA_EPOCH_TABLES = ["User", "Job", "Company", "Inquiry", "CarrierQuote", "EmailThread", "EmailMessage", "JobMilestone", "JobDocument"] as const;
export const DERYA_READ_DEPENDENCIES: Record<DeryaReadTool, readonly string[]> = {
  search_jobs: ["User", "Job", "Company"], search_inquiries: ["User", "Inquiry"],
  search_companies: ["User", "Company"], list_open_inquiries: ["User", "Inquiry"], get_job: DERYA_EPOCH_TABLES,
};
export const DERYA_PROJECTION_VERSION = "derya-audited-projection-v5.1";
export const DERYA_EPOCH_CONTRACT = "derya-table-epochs-v1";
export const DERYA_EPOCH_CONTRACT_HASH = hash({ version: DERYA_EPOCH_CONTRACT, projection: DERYA_PROJECTION_VERSION, dependencies: DERYA_READ_DEPENDENCIES });
export interface EpochSnapshot {
  incarnation: string; coverageHash: string; contractHash: string; counters: Record<string, string>;
}
export interface EpochReuseReceipt {
  version: 1; contractHash: string; coverageHash: string; incarnation: string;
  allowedTools: DeryaReadTool[];
  equivalenceEvidenceHash: string; performanceEvidenceHash: string;
  equivalencePassed: true; validationSamples: number; writerSamples: number;
  validationP95Ms: number; fullReadP95Ms: number; writerOverheadRatio: number;
}
export type DeryaEpochOptions = { mode?: "off" | "shadow" }
  | { mode: "verified-reuse"; receipt: EpochReuseReceipt; trustedReceiptHash: string };
export function validateEpochOptions(options: DeryaEpochOptions): void {
  if (!options.mode || options.mode === "off" || options.mode === "shadow") return;
  if (options.mode !== "verified-reuse") throw new Error("Invalid Derya epoch mode");
  const r = options.receipt;
  if (!r || hash(r) !== options.trustedReceiptHash || r.version !== 1 || !r.equivalencePassed
    || r.contractHash !== DERYA_EPOCH_CONTRACT_HASH || !r.incarnation
    || ![r.coverageHash, r.equivalenceEvidenceHash, r.performanceEvidenceHash].every(v => /^[a-f0-9]{64}$/.test(v))
    || ![r.validationSamples, r.writerSamples].every(n => Number.isInteger(n) && n >= 30)
    || !Array.isArray(r.allowedTools) || !r.allowedTools.length || new Set(r.allowedTools).size !== r.allowedTools.length
    || !r.allowedTools.every(tool => Object.hasOwn(DERYA_READ_DEPENDENCIES, tool))
    || ![r.validationP95Ms, r.fullReadP95Ms, r.writerOverheadRatio].every(Number.isFinite)
    || r.validationP95Ms < 0 || r.fullReadP95Ms <= r.validationP95Ms || r.writerOverheadRatio < -1 || r.writerOverheadRatio > .05) {
    throw new Error("Derya epoch reuse requires pinned equivalence and performance evidence");
  }
}
export function epochReceiptMatches(options: DeryaEpochOptions, current: EpochSnapshot, tool: DeryaReadTool): boolean {
  return options.mode === "verified-reuse" && options.receipt.contractHash === current.contractHash
    && options.receipt.coverageHash === current.coverageHash && options.receipt.incarnation === current.incarnation
    && options.receipt.allowedTools.includes(tool);
}
export function epochsEqual(previous: EpochSnapshot, current: EpochSnapshot, tool: DeryaReadTool): boolean {
  return previous.incarnation === current.incarnation && previous.coverageHash === current.coverageHash
    && previous.contractHash === current.contractHash && DERYA_READ_DEPENDENCIES[tool].every(table =>
      typeof previous.counters[table] === "string" && previous.counters[table] === current.counters[table]);
}

// Called in the same repeatable-read transaction as authorization/projection.
// Catalog checks are live, not a process-lifetime claim about writer coverage.
// The migration owns expected definitions; an application role cannot change
// them, the counters, triggers or security-definer function. Privileged database
// administration is outside this trust boundary and must rotate incarnation.
export async function captureEpochSnapshot(tx: Prisma.TransactionClient): Promise<EpochSnapshot | undefined> {
  const installed = await tx.$queryRaw<{ installed: boolean }[]>`SELECT to_regclass('goalspec_read_guard.metadata') IS NOT NULL AS installed`;
  if (!installed[0]?.installed) return;
  const rows = await tx.$queryRaw<{ valid: boolean; incarnation: string; contract: string; coverage: unknown; counters: unknown }[]>`
    SELECT (m.incarnation::text || ':' || (SELECT oid::text FROM pg_database WHERE datname = current_database())
      || ':' || pg_postmaster_start_time()::text) AS incarnation, m.contract, m.coverage,
      (SELECT jsonb_object_agg(e.table_name, e.epoch::text) FROM goalspec_read_guard.epochs e) AS counters,
      (
        m.contract = 'derya-table-epochs-v1'
        AND current_user = session_user
        AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
        AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
        AND NOT has_schema_privilege(current_user, 'goalspec_read_guard', 'CREATE')
        AND NOT has_table_privilege(current_user, 'goalspec_read_guard.epochs', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
        AND NOT has_table_privilege(current_user, 'goalspec_read_guard.metadata', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
        AND NOT has_any_column_privilege(current_user, 'goalspec_read_guard.epochs', 'INSERT,UPDATE')
        AND NOT has_any_column_privilege(current_user, 'goalspec_read_guard.metadata', 'INSERT,UPDATE')
        AND NOT has_function_privilege(current_user, 'goalspec_read_guard.bump()', 'EXECUTE')
        AND (SELECT count(*) = 9 FROM goalspec_read_guard.epochs)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(m.coverage) entry
          LEFT JOIN pg_class c ON c.oid = to_regclass(format('public.%I', entry.key))
          LEFT JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = 'goalspec_read_epoch_v1'
          LEFT JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE c.oid IS NULL OR c.relkind <> 'r' OR c.relispartition OR c.relowner = r.oid
            OR c.relrowsecurity OR c.relforcerowsecurity
            OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = c.oid OR inhparent = c.oid)
            OR has_table_privilege(current_user, c.oid, 'TRIGGER')
            OR t.oid IS NULL OR t.tgenabled <> 'A' OR t.tgtype <> 60 OR t.tgqual IS NOT NULL
            OR t.tgnargs <> 0 OR t.tgisinternal OR NOT p.prosecdef OR p.proowner = r.oid
            OR entry.value <> jsonb_build_object('tableOid', c.oid::text, 'triggerOid', t.oid::text,
                 'trigger', pg_get_triggerdef(t.oid), 'function', pg_get_functiondef(p.oid))
        )
        AND (SELECT count(*) FROM jsonb_object_keys(m.coverage)) = 9
      ) AS valid
    FROM goalspec_read_guard.metadata m JOIN pg_roles r ON r.rolname = current_user WHERE m.id = 1`;
  const row = rows[0];
  if (!row?.valid || row.contract !== DERYA_EPOCH_CONTRACT || !row.counters || typeof row.counters !== "object"
    || !row.coverage || typeof row.coverage !== "object" || hash(Object.keys(row.coverage).sort()) !== hash([...DERYA_EPOCH_TABLES].sort())) return;
  const counters = row.counters as Record<string, string>;
  if (!DERYA_EPOCH_TABLES.every(table => typeof counters[table] === "string" && /^\d+$/.test(counters[table]))) return;
  return { incarnation: row.incarnation, coverageHash: hash(row.coverage), contractHash: DERYA_EPOCH_CONTRACT_HASH, counters };
}
