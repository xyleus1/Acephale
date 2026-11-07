import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { ALLOCATIONS, type Reservation } from "../src/lib/acephale/budget";
import { canonical, hash } from "../src/lib/acephale/canonical";

export interface AwsBudgetRequest {
  operation: "inspect" | "bind" | "reserve";
  ledgerPath: string; checkpointPath: string; checkpointHash: string;
  sliceLedgerPath: string; deploymentHash: string; requireNewReservation?: boolean;
  reservationId?: string; maximumMicrodollars?: number;
}

/** The Python controller never implements or replaces the original journal. */
export function awsBudget(request: AwsBudgetRequest) {
  const path = resolve(request.ledgerPath), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error("Existing nonempty original study journal required");
  const checkpoint = JSON.parse(readFileSync(resolve(request.checkpointPath), "utf8")) as {
    version: number; ledgerPathHash: string; entriesHash: string; entries: (Reservation & { id: string })[];
  };
  if (checkpoint.version !== 1 || hash(checkpoint) !== request.checkpointHash || checkpoint.ledgerPathHash !== hash(path)
    || !Array.isArray(checkpoint.entries) || !checkpoint.entries.length || hash(checkpoint.entries) !== checkpoint.entriesHash) {
    throw new Error("Original study checkpoint identity invalid");
  }
  const owner = new DurableBudget(path);
  try {
    const current = owner.ledger.snapshot(), byId = new Map(current.map(row => [row.id, row]));
    for (const prior of checkpoint.entries) {
      const next = byId.get(prior.id);
      if (!next || next.allocation !== prior.allocation || next.maximum !== prior.maximum || next.parentId !== prior.parentId
        || (prior.actual !== undefined && next.actual !== prior.actual)) throw new Error("Original study history changed or disappeared");
    }
    const totals = () => {
      const rows = owner.ledger.snapshot();
      if (rows.some(row => row.actual !== undefined && row.actual > row.maximum)) throw new Error("Study halted after overrun");
      const roots = rows.filter(row => !row.parentId);
      const committed = roots.reduce((sum, row) => sum + (row.actual ?? row.maximum), 0);
      const nonContingency = roots.filter(row => row.allocation !== "contingency").reduce((sum, row) => sum + (row.actual ?? row.maximum), 0);
      if (committed > 500_000_000 || nonContingency > 500_000_000 - ALLOCATIONS.contingency) throw new Error("Study total or protected contingency exceeded");
      return { committedMicrodollars: committed, infrastructureMicrodollars: roots.filter(row => row.allocation === "infrastructure")
        .reduce((sum, row) => sum + (row.actual ?? row.maximum), 0), entriesHash: hash(rows), reservations: rows.length };
    };
    totals();
    const binding = { version: 1, studyLedgerPathHash: hash(path), sliceLedgerPath: resolve(request.sliceLedgerPath),
      deploymentHash: request.deploymentHash, checkpointHash: request.checkpointHash };
    if (!/^[a-f0-9]{64}$/.test(request.deploymentHash)) throw new Error("Invalid AWS deployment identity");
    const pointer = `${path}.aws-infrastructure-pointer.json`;
    if (request.operation === "bind") {
      // Exclusive creation fences accidental second slice ledgers and hour resets.
      // If a crash interrupts initialization, recover this binding manually.
      const descriptor = openSync(pointer, "wx", 0o600);
      try { writeFileSync(descriptor, canonical(binding) + "\n"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
      if (process.platform !== "win32") {
        const directory = openSync(dirname(pointer), "r");
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } else if (request.operation === "reserve") {
      if (hash(JSON.parse(readFileSync(pointer, "utf8"))) !== hash(binding)) throw new Error("AWS slice binding differs from original study");
    }
    if (request.operation === "reserve") {
      const id = request.reservationId, maximum = request.maximumMicrodollars;
      if (!id || !/^aws-infra:[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(maximum) || maximum! < 1
        || maximum! > ALLOCATIONS.infrastructure) throw new Error("Invalid AWS infrastructure reservation");
      const existing = byId.get(id);
      if (existing) {
        if (request.requireNewReservation === true) throw new Error("Prior AWS reservation cannot fund another launch");
        if (existing.parentId || existing.actual !== undefined || existing.allocation !== "infrastructure" || existing.maximum !== maximum) {
          throw new Error("Existing AWS reservation differs or is already settled");
        }
      } else {
        if (totals().committedMicrodollars + maximum! > 500_000_000 - ALLOCATIONS.contingency) throw new Error("Protected study contingency unavailable");
        owner.ledger.reserve(id, "infrastructure", maximum!);
      }
    } else if (request.operation !== "inspect" && request.operation !== "bind") throw new Error("Unsupported budget operation");
    return { version: 1, ledgerPathHash: hash(path), checkpointHash: request.checkpointHash, ...totals(),
      ...(request.operation === "reserve" ? { reservationId: request.reservationId, maximumMicrodollars: request.maximumMicrodollars } : {}) };
  } finally { owner.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: acephale-aws-budget <request.json>");
    console.log(JSON.stringify(awsBudget(JSON.parse(readFileSync(process.argv[2], "utf8")))));
  } catch { console.error("AWS original-study budget operation failed; reservations retained"); process.exitCode = 1; }
}
