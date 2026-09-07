import type { GetleadContactRow } from "./client";

export function getGetleadContactRows(value: unknown): GetleadContactRow[] {
  if (!value || typeof value !== "object") return [];
  const record = value as {
    rows?: unknown;
    result?: { rows?: unknown };
    job?: { rows?: unknown };
  };
  const rows = record.result?.rows ?? record.rows ?? record.job?.rows;
  return Array.isArray(rows) ? rows as GetleadContactRow[] : [];
}

export function getGetleadJobId(value: unknown) {
  if (!value || typeof value !== "object") return "file";
  const record = value as {
    job_id?: unknown;
    job?: { job_id?: unknown };
  };
  return typeof record.job_id === "string"
    ? record.job_id
    : typeof record.job?.job_id === "string" ? record.job.job_id : "file";
}
