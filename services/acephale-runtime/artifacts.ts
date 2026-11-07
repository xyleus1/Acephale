import { createHash } from "node:crypto";
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { dirname } from "node:path";
import { canonical } from "../../src/lib/acephale/canonical";

export class ImmutableEventLog {
  private descriptor: number;
  private sequence = 0;
  private previousHash = "0".repeat(64);
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.descriptor = openSync(path, "wx", 0o600);
  }
  append(event: unknown) {
    const body = canonical({ sequence: this.sequence, previousHash: this.previousHash, recordedAtUnixMs: Date.now(), event });
    const digest = createHash("sha256").update(body).digest("hex");
    const bytes = Buffer.from(canonical({ body: JSON.parse(body), hash: digest }) + "\n");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(this.descriptor, bytes, offset, bytes.length - offset);
    fsyncSync(this.descriptor);
    this.previousHash = digest; this.sequence++;
  }
  close() { closeSync(this.descriptor); }
}
