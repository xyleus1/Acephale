import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { BrowserSnapshot, BrowserSnapshotProvider } from "./browser-adapter";

/** Server-owned argv/config only. This never invokes a shell or accepts actor paths. */
export class LocalBrowserSnapshotProvider implements BrowserSnapshotProvider {
  private process: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private closed = false;
  constructor(python: string, gatewayScript: string, trustedConfiguration: string) {
    const environment = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "PYTHONPATH", "VIRTUAL_ENV"]
      .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
    this.process = spawn(python, [gatewayScript, trustedConfiguration], { windowsHide: true, stdio: "pipe", env: environment });
    createInterface({ input: this.process.stdout }).on("line", line => {
      try {
        const response = JSON.parse(line);
        const request = this.pending.get(response.id);
        if (!request) throw new Error("Unknown local browser response");
        this.pending.delete(response.id);
        if (response.error) request.reject(new Error(`Local browser backend rejected operation (${response.error})`));
        else request.resolve(response.result);
      } catch { this.fail(new Error("Invalid local browser gateway protocol")); }
    });
    // Backend command diagnostics are deliberately not copied to actor context.
    this.process.stderr.resume();
    this.process.on("error", () => this.fail(new Error("Local browser gateway unavailable")));
    this.process.on("exit", () => this.fail(new Error("Local browser gateway exited")));
  }
  private fail(error: Error) {
    this.closed = true;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
  private call<T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Local browser gateway closed"));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      this.process.stdin.write(JSON.stringify({ id, operation, ...payload }) + "\n", error => {
        if (error) { this.pending.delete(id); reject(new Error("Local browser request failed")); }
      });
    });
  }
  acquire() { return this.call<BrowserSnapshot>("acquire"); }
  fresh(snapshot: BrowserSnapshot) { return this.call<boolean>("fresh", { snapshot }); }
  async release(snapshot: BrowserSnapshot) { await this.call("release", { snapshot }); }
  async reset() { await this.call("reset"); }
  verify(expected: unknown) { return this.call<{ passed: boolean; evidence: unknown }>("verify", { expected }); }
  async close() {
    if (this.pending.size) throw new Error("Drain managed browser operations before closing the local provider");
    if (this.closed) return;
    this.closed = true;
    this.process.stdin.end();
    await new Promise<void>(resolve => this.process.once("exit", () => resolve()));
  }
}
