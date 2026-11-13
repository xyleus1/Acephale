import { createHash, randomUUID, type Hash } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { BudgetLedger, type Reservation } from "../../src/lib/acephale/budget";
import { canonical, hash } from "../../src/lib/acephale/canonical";
import { readBudgetPolicy, type BudgetAmendment } from "./budget-policy";

type Record = { sequence: number; previous: string; entries: [string, Reservation][] } |
  { version: 2; sequence: number; previous: string; changes: [string, Reservation][] };

type Checkpoint = { version: 1; journalPathHash: string; prefixBytes: number; prefixSha256: string;
  nextSequence: number; lastChainHash: string; entries: [string, Reservation][]; entriesHash: string; contentHash: string };
const digestPattern = /^[a-f0-9]{64}$/;
const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
function checkedFile(path: string, maximum: number): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error("Invalid budget checkpoint file");
  return readFileSync(path);
}
function writeDurableFile(path: string, bytes: Buffer) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (!count) throw new Error("Incomplete budget checkpoint write");
      offset += count;
    }
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
}
function fsyncDirectory(path: string) {
  if (process.platform === "win32") return;
  const descriptor = openSync(dirname(path), "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function* journalLines(path: string, offset: number, consumed: (bytes: Buffer) => void) {
  const descriptor = openSync(path, "r");
  const buffer = Buffer.alloc(64 * 1024), decoder = new StringDecoder("utf8");
  let pending = "";
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, offset);
      if (!count) break;
      offset += count; consumed(buffer.subarray(0, count));
      pending += decoder.write(buffer.subarray(0, count));
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (line) yield line;
      }
    }
    pending += decoder.end();
    if (pending) throw new Error("Truncated budget journal; reconcile before dispatch");
  } finally { closeSync(descriptor); }
}

/** Prefix hashing is linear byte I/O, without replaying thousands of historical
 * ledger states. The last chain item is independently checked against metadata. */
function verifyPrefix(path: string, checkpoint: Checkpoint, digest: Hash) {
  const descriptor = openSync(path, "r"), buffer = Buffer.alloc(1024 * 1024), decoder = new StringDecoder("utf8");
  let offset = 0, pending = "", lastLine = "";
  try {
    if (fstatSync(descriptor).size < checkpoint.prefixBytes) throw new Error("Truncated budget checkpoint prefix");
    while (offset < checkpoint.prefixBytes) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, checkpoint.prefixBytes - offset), offset);
      if (!count) throw new Error("Truncated budget checkpoint prefix");
      offset += count; digest.update(buffer.subarray(0, count));
      pending += decoder.write(buffer.subarray(0, count));
      const newline = pending.lastIndexOf("\n");
      if (newline >= 0) {
        const before = pending.slice(0, newline), previous = before.lastIndexOf("\n");
        const complete = before.slice(previous + 1);
        if (complete) lastLine = complete;
        pending = pending.slice(newline + 1);
      }
      if (pending.length > MAX_CHECKPOINT_BYTES) throw new Error("Oversized budget checkpoint journal line");
    }
    pending += decoder.end();
    if (pending || digest.copy().digest("hex") !== checkpoint.prefixSha256) throw new Error("Invalid budget checkpoint prefix hash or boundary");
    if (!checkpoint.prefixBytes) {
      if (checkpoint.nextSequence !== 0 || checkpoint.lastChainHash !== "0".repeat(64) || checkpoint.entries.length) throw new Error("Invalid empty budget checkpoint");
    } else {
      const row = JSON.parse(lastLine) as { body: Record; hash: string };
      if (row.body.sequence !== checkpoint.nextSequence - 1 || row.hash !== checkpoint.lastChainHash || hash(row.body) !== row.hash) throw new Error("Invalid budget checkpoint terminal chain record");
    }
  } finally { closeSync(descriptor); }
}

function equal(a: Reservation | undefined, b: Reservation) {
  return a?.allocation === b.allocation && a.maximum === b.maximum && a.actual === b.actual && a.parentId === b.parentId;
}

// One service owns all dispatch for this ledger. Exclusive ownership also fences
// other local processes. Crash locks are intentionally never reclaimed by age.
export class DurableBudget {
  readonly ledger: BudgetLedger;
  readonly policy?: BudgetAmendment;
  private descriptor = -1;
  private lockDescriptor: number;
  private sequence = 0;
  private previous = "0".repeat(64);
  private closed = false;
  private failed = false;
  private priorEntries = new Map<string, Reservation>();
  private journalDigest = createHash("sha256");
  private journalBytes = 0;
  readonly recovery: { checkpointUsed: boolean; verifiedPrefixBytes: number; replayedRecords: number } = { checkpointUsed: false, verifiedPrefixBytes: 0, replayedRecords: 0 };
  constructor(private path: string, private options: { recoveryCheckpoint?: boolean } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.lockDescriptor = openSync(`${path}.lock`, "wx", 0o600);
    try {
      writeSync(this.lockDescriptor, JSON.stringify({ pid: process.pid, acquired: new Date().toISOString() }));
      fsyncSync(this.lockDescriptor);
      let entries: [string, Reservation][] = [];
      if (this.options.recoveryCheckpoint !== false && existsSync(`${path}.checkpoint-pointer.json`)) {
        const pointer = JSON.parse(checkedFile(`${path}.checkpoint-pointer.json`, 4096).toString("utf8")) as { version: number; checkpointFile: string; sha256: string };
        if (pointer.version !== 1 || typeof pointer.checkpointFile !== "string" || basename(pointer.checkpointFile) !== pointer.checkpointFile
          || !pointer.checkpointFile.startsWith(`${basename(path)}.checkpoint.v1.`) || !pointer.checkpointFile.endsWith(".json")
          || !digestPattern.test(pointer.sha256)) throw new Error("Invalid budget checkpoint pointer");
        const bytes = checkedFile(join(dirname(path), pointer.checkpointFile), MAX_CHECKPOINT_BYTES);
        if (createHash("sha256").update(bytes).digest("hex") !== pointer.sha256) throw new Error("Invalid budget checkpoint sidecar hash");
        const checkpoint = JSON.parse(bytes.toString("utf8")) as Checkpoint;
        const { contentHash, ...body } = checkpoint;
        if (checkpoint.version !== 1 || !digestPattern.test(contentHash) || hash(body) !== contentHash
          || checkpoint.journalPathHash !== hash(resolve(path)) || !Number.isSafeInteger(checkpoint.prefixBytes) || checkpoint.prefixBytes < 0
          || !Number.isSafeInteger(checkpoint.nextSequence) || checkpoint.nextSequence < 0 || !digestPattern.test(checkpoint.lastChainHash)
          || !digestPattern.test(checkpoint.prefixSha256) || !Array.isArray(checkpoint.entries) || checkpoint.entries.length > 100000
          || checkpoint.entriesHash !== hash(checkpoint.entries)) throw new Error("Invalid budget checkpoint metadata");
        new BudgetLedger(undefined, checkpoint.entries);
        verifyPrefix(path, checkpoint, this.journalDigest);
        entries = checkpoint.entries; this.sequence = checkpoint.nextSequence; this.previous = checkpoint.lastChainHash;
        this.journalBytes = checkpoint.prefixBytes;
        this.recovery.checkpointUsed = true; this.recovery.verifiedPrefixBytes = checkpoint.prefixBytes;
      }
      if (existsSync(path)) {
        for (const line of journalLines(path, this.journalBytes, bytes => { this.journalDigest.update(bytes); this.journalBytes += bytes.length; })) {
          const row = JSON.parse(line) as { body: Record; hash: string };
          if (row.body.sequence !== this.sequence || row.body.previous !== this.previous || hash(row.body) !== row.hash) throw new Error("Invalid budget journal chain");
          if ("version" in row.body) {
            if (row.body.version !== 2 || !Array.isArray(row.body.changes)) throw new Error("Unknown budget journal version");
            const next = new Map(entries);
            for (const [id, entry] of row.body.changes) next.set(id, entry);
            entries = [...next];
          } else entries = row.body.entries;
          // Validate every recovered state, including mixed historical formats.
          new BudgetLedger(undefined, entries);
          this.sequence++; this.previous = row.hash; this.recovery.replayedRecords++;
        }
      }
      this.priorEntries = new Map(entries);
      this.descriptor = openSync(path, "a", 0o600);
      // Persist directory entries before any request may be dispatched on Linux.
      // Windows process-restart recovery is tested. Power-loss durability has not
      // been validated on the local machine or a Linux deployment filesystem.
      if (process.platform !== "win32") {
        const directory = openSync(dirname(path), "r");
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
      this.policy = readBudgetPolicy(path, entries);
      this.ledger = new BudgetLedger(next => this.append(next), entries, this.policy?.policy.allocationsMicrodollars);
      if (this.options.recoveryCheckpoint !== false) this.checkpoint();
    } catch (error) {
      if (this.descriptor >= 0) closeSync(this.descriptor);
      closeSync(this.lockDescriptor);
      unlinkSync(`${path}.lock`);
      throw error;
    }
  }
  private checkpoint() {
    if (this.failed || this.descriptor < 0) return;
    if (fstatSync(this.descriptor).size !== this.journalBytes) throw new Error("Budget journal changed outside its owner");
    const entries = [...this.priorEntries];
    const body = { version: 1 as const, journalPathHash: hash(resolve(this.path)), prefixBytes: this.journalBytes,
      prefixSha256: this.journalDigest.copy().digest("hex"), nextSequence: this.sequence, lastChainHash: this.previous,
      entries, entriesHash: hash(entries) };
    const contentHash = hash(body), bytes = Buffer.from(canonical({ ...body, contentHash }) + "\n");
    if (bytes.length > MAX_CHECKPOINT_BYTES) throw new Error("Budget checkpoint exceeds bound");
    const checkpointFile = `${basename(this.path)}.checkpoint.v1.${this.sequence}.${contentHash}.json`;
    const destination = join(dirname(this.path), checkpointFile);
    if (existsSync(destination)) {
      if (!checkedFile(destination, MAX_CHECKPOINT_BYTES).equals(bytes)) throw new Error("Immutable budget checkpoint collision");
    } else writeDurableFile(destination, bytes);
    const pointer = Buffer.from(canonical({ version: 1, checkpointFile, sha256: createHash("sha256").update(bytes).digest("hex") }) + "\n");
    const temporary = `${this.path}.checkpoint-pointer.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeDurableFile(temporary, pointer);
      renameSync(temporary, `${this.path}.checkpoint-pointer.json`);
      fsyncDirectory(this.path);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  private append(entries: [string, Reservation][]) {
    if (this.closed || this.failed) throw new Error("Budget journal unavailable");
    if (entries.length < this.priorEntries.size) throw new Error("Budget reservations cannot be removed");
    const changes = entries.filter(([id, entry]) => !equal(this.priorEntries.get(id), entry));
    const body: Record = { version: 2, sequence: this.sequence, previous: this.previous, changes };
    const digest = hash(body);
    const bytes = Buffer.from(canonical({ body, hash: digest }) + "\n");
    try {
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(this.descriptor, bytes, offset, bytes.length - offset);
      fsyncSync(this.descriptor);
    } catch (error) { this.failed = true; throw error; }
    this.priorEntries = new Map(entries);
    this.journalDigest.update(bytes); this.journalBytes += bytes.length;
    this.previous = digest; this.sequence++;
  }
  validateManifestPolicy(budgets: { infrastructureMicrodollars: number; budgetPolicyHash?: string; budgetAmendmentHash?: string }) {
    if (this.policy) {
      if (budgets.budgetPolicyHash !== this.policy.policyHash || budgets.budgetAmendmentHash !== this.policy.contentHash
        || budgets.infrastructureMicrodollars > this.ledger.allocations.infrastructure) throw new Error("Manifest budget policy differs from the original journal amendment");
    } else if (budgets.budgetPolicyHash || budgets.budgetAmendmentHash || budgets.infrastructureMicrodollars > this.ledger.allocations.infrastructure) {
      throw new Error("Manifest requires an unapplied budget policy amendment");
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { if (this.options.recoveryCheckpoint !== false) this.checkpoint(); }
    finally {
      closeSync(this.descriptor);
      closeSync(this.lockDescriptor);
      unlinkSync(`${this.path}.lock`);
    }
  }
}
