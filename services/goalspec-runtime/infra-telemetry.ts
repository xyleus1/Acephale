import { randomBytes, randomUUID } from "node:crypto";
import { Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";
import { createInfraOtel } from "./infra-otel";
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
  private registry = new Registry(Registry.PROMETHEUS_CONTENT_TYPE);
  private instruments = new Map<string, { type: string; keys: string; metric: Counter<string> | Gauge<string> | Histogram<string> }>();
  private series = new Set<string>();
  private histogramSeries = new Set<string>();
  private instrument(name: string, labels: Labels, value: number, type: "counter" | "gauge" | "histogram") {
    if (!/^goalspec_[a-z_]+$/.test(name) || !Number.isFinite(value) || value < 0) throw new Error("Invalid metric");
    const key = `${name}{${labelText(labels)}}`, series = type === "histogram" ? this.histogramSeries : this.series;
    if (!series.has(key) && series.size >= (type === "histogram" ? 256 : 4096)) throw new Error("Metric cardinality limit");
    const labelNames = Object.keys(labels).sort(), keys = JSON.stringify(labelNames), prior = this.instruments.get(name);
    if (prior && (prior.type !== type || prior.keys !== keys)) throw new Error("Metric type or label schema changed");
    series.add(key);
    if (prior) return prior.metric;
    const options = { name, help: name, labelNames, registers: [this.registry] };
    const metric = type === "counter" ? new Counter(options) : type === "gauge" ? new Gauge(options) : new Histogram({ ...options, buckets });
    this.instruments.set(name, { type, keys, metric }); return metric;
  }
  increment(name: string, labels: Labels = {}, value = 1) { (this.instrument(name, labels, value, "counter") as Counter<string>).inc(labels, value); }
  gauge(name: string, labels: Labels, value: number) { (this.instrument(name, labels, value, "gauge") as Gauge<string>).set(labels, value); }
  observe(name: string, labels: Labels, seconds: number) {
    if (!/^goalspec_[a-z_]+_seconds$/.test(name) || !Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid duration");
    (this.instrument(name, labels, seconds, "histogram") as Histogram<string>).observe(labels, seconds);
  }
  render(): Promise<string> { return this.registry.metrics(); }
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
  private readonly processClockId = `node:${process.pid}:${randomUUID()}`;
  private otel?: ReturnType<typeof createInfraOtel>;
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
    if (otlpUrl) telemetry.otel = createInfraOtel(otlpUrl, receipt => {
      try {
        if (receipt.collectorAccepted) telemetry.exportCounts[receipt.kind === "traces" ? "tracesAccepted" : "metricsAccepted"]++;
        else { telemetry.exportCounts.failed++; telemetry.metrics.increment("goalspec_telemetry_exports_total", { outcome: "failed" }); }
        telemetry.record({ type: "telemetry_export_receipt", endpoint: otlpUrl, ...receipt });
      } catch (error) { telemetry.failure = error instanceof Error ? error : new Error("Telemetry receipt failed"); }
    });
    telemetry.timer = setInterval(() => { void telemetry.flush().catch(error => { telemetry.failure = error as Error; }); }, 100);
    telemetry.timer.unref(); return telemetry;
  }
  record = (event: Record<string, unknown>) => {
    if (this.closed || this.failure) throw this.failure ?? new Error("Telemetry closed");
    if (this.events.length >= 4096) throw new Error("Telemetry queue exhausted");
    const metadata = { sequence: this.sequence++, timestamp: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString(), processClockId: this.processClockId };
    const raw = JSON.stringify({ ...event, ...metadata }) + "\n";
    if (this.pendingBytes + Buffer.byteLength(raw) > 8388608) throw new Error("Telemetry byte queue exhausted");
    this.pendingBytes += Buffer.byteLength(raw); this.events.push(raw);
    const safe = Object.fromEntries(["type", "name", "traceId", "spanId", "durationMs", "latencyMs", "success", "arm", "errorType"].filter(key => event[key] !== undefined).map(key => [key, event[key]]));
    this.lifecycle.push(JSON.stringify({ ...safe, ...metadata }) + "\n");
  };
  async flush() {
    if (this.failure) throw this.failure;
    const batch = this.events.splice(0).join("");
    const lifecycle = this.lifecycle.splice(0).join("");
    this.writing = this.writing.then(async () => {
      if (batch) await appendFile(join(this.directory, "events.jsonl"), batch, { encoding: "utf8", mode: 0o600 });
      if (lifecycle) await appendFile(join(this.directory, "logs", "lifecycle.jsonl"), lifecycle, { encoding: "utf8", mode: 0o600 });
      const temporary = join(this.directory, "metrics.prom.tmp");
      await writeFile(temporary, await this.metrics.render(), { encoding: "utf8", mode: 0o600 }); await rename(temporary, join(this.directory, "metrics.prom"));
      this.pendingBytes -= Buffer.byteLength(batch);
    });
    this.writing.catch(error => { this.failure = error as Error; });
    await this.writing;
  }
  async span<T>(name: string, runId: string, attributes: Record<string, string | number | boolean>, operation: () => Promise<T>): Promise<T> {
    const span = this.otel?.start(name, runId, attributes);
    const traceId = span?.spanContext().traceId ?? hash(runId).slice(0, 32), spanId = span?.spanContext().spanId ?? randomBytes(8).toString("hex");
    const started = performance.now();
    this.record({ type: "span_started", name, traceId, spanId, attributes });
    let success = false;
    try { const result = await operation(); success = true; return result; }
    finally {
      const durationMs = performance.now() - started;
      this.spanCount++;
      this.metrics.observe("goalspec_runtime_span_seconds", { outcome: success ? "success" : "failed" }, durationMs / 1000);
      this.record({ type: "span_completed", name, traceId, spanId, durationMs, success });
      if (span) this.otel!.finish(span, success, durationMs / 1000);
    }
  }
  exportSummary() { return { endpoint: this.otlpUrl ?? null, spans: this.spanCount, ...this.exportCounts }; }
  async close() {
    if (this.closed) return; clearInterval(this.timer);
    await this.flush(); await this.otel?.close();
    await this.flush(); this.closed = true;
  }
}
