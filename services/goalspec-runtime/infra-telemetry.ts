import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "../../src/lib/goalspec/canonical";

type Labels = Record<string, string>;
const allowedLabels = new Set(["arm", "outcome", "tool", "kind", "category", "stage"]);
const buckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
function labelText(labels: Labels) {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    if (!allowedLabels.has(key) && key !== "le") throw new Error("High cardinality metric label rejected");
    if (value.length > 128) throw new Error("Metric label too long");
    return `${key}=${JSON.stringify(value)}`;
  }).join(",");
}
export class InfraMetrics {
  private values = new Map<string, { name: string; labels: Labels; value: number; type: "counter" | "gauge" }>();
  private histograms = new Map<string, { name: string; labels: Labels; values: number[]; count: number; sum: number }>();
  increment(name: string, labels: Labels = {}, value = 1) { this.set(name, labels, value, "counter", true); }
  gauge(name: string, labels: Labels, value: number) { this.set(name, labels, value, "gauge", false); }
  private set(name: string, labels: Labels, value: number, type: "counter" | "gauge", add: boolean) {
    if (!/^goalspec_[a-z_]+$/.test(name) || !Number.isFinite(value) || value < 0) throw new Error("Invalid metric");
    const key = `${name}{${labelText(labels)}}`;
    if (!this.values.has(key) && this.values.size >= 4096) throw new Error("Metric cardinality limit");
    this.values.set(key, { name, labels: { ...labels }, value: add ? (this.values.get(key)?.value ?? 0) + value : value, type });
  }
  observe(name: string, labels: Labels, seconds: number) {
    if (!/^goalspec_[a-z_]+_seconds$/.test(name) || !Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid duration");
    const key = `${name}{${labelText(labels)}}`;
    if (!this.histograms.has(key) && this.histograms.size >= 256) throw new Error("Histogram cardinality limit");
    const row = this.histograms.get(key) ?? { name, labels: { ...labels }, values: buckets.map(() => 0), count: 0, sum: 0 };
    row.count++; row.sum += seconds; buckets.forEach((bound, index) => { if (seconds <= bound) row.values[index]++; });
    this.histograms.set(key, row);
  }
  render(): string {
    const lines: string[] = []; const types = new Set<string>();
    for (const [key, row] of this.values) {
      if (!types.has(row.name)) { lines.push(`# TYPE ${row.name} ${row.type}`); types.add(row.name); }
      lines.push(`${key} ${row.value}`);
    }
    for (const row of this.histograms.values()) {
      if (!types.has(row.name)) { lines.push(`# TYPE ${row.name} histogram`); types.add(row.name); }
      buckets.forEach((bound, index) => lines.push(`${row.name}_bucket{${labelText({ ...row.labels, le: String(bound) })}} ${row.values[index]}`));
      lines.push(`${row.name}_bucket{${labelText({ ...row.labels, le: "+Inf" })}} ${row.count}`);
      lines.push(`${row.name}_count{${labelText(row.labels)}} ${row.count}`, `${row.name}_sum{${labelText(row.labels)}} ${row.sum}`);
    }
    return lines.join("\n") + "\n";
  }
}

/** Bounded async artifacts; queue exhaustion is explicit, never silent loss. */
export class InfraTelemetry {
  readonly metrics = new InfraMetrics();
  private events: string[] = [];
  private writing: Promise<void> = Promise.resolve();
  private failure?: Error;
  private timer?: ReturnType<typeof setInterval>;
  private sequence = 0;
  private pendingBytes = 0;
  private lifecycle: string[] = [];
  private closed = false;
  private spanCount = 0;
  private spanDurationSeconds = 0;
  private exportCounts = { tracesAccepted: 0, metricsAccepted: 0, failed: 0 };
  private constructor(readonly directory: string, private otlpUrl?: string) {}
  static async create(directory: string, otlpUrl?: string) {
    if (otlpUrl) {
      const url = new URL(otlpUrl);
      if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)
        || url.protocol !== "https:" && !["localhost", "127.0.0.1", "alloy"].includes(url.hostname)) throw new Error("OTLP requires a credential-free TLS or private collector URL");
    }
    await mkdir(directory, { recursive: true });
    await mkdir(join(directory, "logs"), { recursive: true });
    const receipt = await open(join(directory, "events.jsonl"), "wx", 0o600); await receipt.close();
    const telemetry = new InfraTelemetry(directory, otlpUrl);
    telemetry.timer = setInterval(() => { void telemetry.flush().catch(error => { telemetry.failure = error as Error; }); }, 100);
    telemetry.timer.unref(); return telemetry;
  }
  record = (event: Record<string, unknown>) => {
    if (this.closed || this.failure) throw this.failure ?? new Error("Telemetry closed");
    if (this.events.length >= 4096) throw new Error("Telemetry queue exhausted");
    const metadata = { sequence: this.sequence++, timestamp: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString(), processClockId: process.pid };
    const raw = JSON.stringify({ ...event, ...metadata }) + "\n";
    if (this.pendingBytes + Buffer.byteLength(raw) > 8388608) throw new Error("Telemetry byte queue exhausted");
    this.pendingBytes += Buffer.byteLength(raw); this.events.push(raw);
    const safe = Object.fromEntries(["type", "name", "traceId", "spanId", "durationMs", "latencyMs", "success", "arm", "errorType"].filter(key => event[key] !== undefined).map(key => [key, event[key]]));
    this.lifecycle.push(JSON.stringify({ ...safe, ...metadata }) + "\n");
  };
  async flush() {
    if (this.failure) throw this.failure;
    const batch = this.events.splice(0).join("");
    const lifecycle = this.lifecycle.splice(0).join(""), metrics = this.metrics.render();
    this.writing = this.writing.then(async () => {
      if (batch) await appendFile(join(this.directory, "events.jsonl"), batch, { encoding: "utf8", mode: 0o600 });
      if (lifecycle) await appendFile(join(this.directory, "logs", "lifecycle.jsonl"), lifecycle, { encoding: "utf8", mode: 0o600 });
      const temporary = join(this.directory, "metrics.prom.tmp");
      await writeFile(temporary, metrics, { encoding: "utf8", mode: 0o600 }); await rename(temporary, join(this.directory, "metrics.prom"));
      this.pendingBytes -= Buffer.byteLength(batch);
    });
    this.writing.catch(error => { this.failure = error as Error; });
    await this.writing;
  }
  async span<T>(name: string, runId: string, attributes: Record<string, string | number | boolean>, operation: () => Promise<T>): Promise<T> {
    const traceId = hash(runId).slice(0, 32), spanId = randomBytes(8).toString("hex");
    const startTimeUnixNano = (BigInt(Date.now()) * 1000000n).toString(), started = performance.now();
    this.record({ type: "span_started", name, traceId, spanId, attributes });
    let success = false;
    try { const result = await operation(); success = true; return result; }
    finally {
      const durationMs = performance.now() - started;
      this.spanCount++; this.spanDurationSeconds += durationMs / 1000;
      this.metrics.observe("goalspec_runtime_span_seconds", { outcome: success ? "success" : "failed" }, durationMs / 1000);
      this.record({ type: "span_completed", name, traceId, spanId, durationMs, success });
      if (this.otlpUrl) {
        const payload = { resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "goalspec-infra-v1" } }] }, scopeSpans: [{ scope: { name: "goalspec" }, spans: [{ traceId, spanId, name, kind: 1, startTimeUnixNano, endTimeUnixNano: (BigInt(startTimeUnixNano) + BigInt(Math.round(durationMs * 1000000))).toString(), attributes: Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: String(value) } })), status: { code: success ? 1 : 2 } }] }] }] };
        // Export is drained at close but does not block the authoritative result.
        const request = this.exportOtlp("traces", payload);
        this.exports.add(request); void request.finally(() => this.exports.delete(request));
      }
    }
  }
  private async exportOtlp(kind: "traces" | "metrics", payload: unknown) {
    const startedAt = new Date().toISOString(), payloadHash = hash(payload);
    let accepted = false;
    try {
      const response = await fetch(new URL(`/v1/${kind}`, this.otlpUrl!), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error("OTLP rejected");
      const body = await response.json() as { partialSuccess?: { rejectedSpans?: number | string; rejectedDataPoints?: number | string } };
      if (Number(body.partialSuccess?.rejectedSpans ?? 0) > 0 || Number(body.partialSuccess?.rejectedDataPoints ?? 0) > 0) throw new Error("OTLP partially rejected data");
      accepted = true; this.exportCounts[kind === "traces" ? "tracesAccepted" : "metricsAccepted"]++;
    } catch { this.exportCounts.failed++; this.metrics.increment("goalspec_telemetry_exports_total", { outcome: "failed" }); }
    this.record({ type: "telemetry_export_receipt", kind, endpoint: this.otlpUrl, payloadHash, startedAt, completedAt: new Date().toISOString(), collectorAccepted: accepted });
  }
  exportSummary() { return { endpoint: this.otlpUrl ?? null, spans: this.spanCount, ...this.exportCounts }; }
  private exports = new Set<Promise<void>>();
  async close() {
    if (this.closed) return; clearInterval(this.timer);
    await this.flush(); await Promise.allSettled([...this.exports]);
    if (this.otlpUrl && this.spanCount) {
      const timeUnixNano = (BigInt(Date.now()) * 1000000n).toString();
      const metrics = [["goalspec_runtime_spans_total", this.spanCount], ["goalspec_runtime_span_duration_seconds_total", this.spanDurationSeconds]].map(([name, value]) => ({ name,
        sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: [{ timeUnixNano, asDouble: value }] } }));
      await this.exportOtlp("metrics", { resourceMetrics: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "goalspec-infra-v1" } }] }, scopeMetrics: [{ scope: { name: "goalspec" }, metrics }] }] });
    }
    await this.flush(); this.closed = true;
  }
}
