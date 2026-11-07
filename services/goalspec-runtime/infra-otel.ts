import { ROOT_CONTEXT, SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { TracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import type { ClientRequest, RequestOptions } from "node:http";
import { hash } from "../../src/lib/goalspec/canonical";

type Receipt = { kind: "traces" | "metrics"; collectorAccepted: boolean; status?: number; responseHash?: string };

/** SDK exporters report partial OTLP success as success. Observe the actual,
 * bounded collector response before issuing a stronger readiness receipt. */
function receiptAgent(kind: Receipt["kind"], receipt: (value: Receipt) => void) {
  return async (protocol: string) => {
    const transport = protocol === "http:" ? await import("node:http") : await import("node:https");
    // addRequest is the Node HTTP agent integration hook used by ClientRequest.
    const agent = new transport.Agent({ keepAlive: false, maxSockets: 2 }) as InstanceType<typeof transport.Agent> & {
      addRequest(request: ClientRequest, options: RequestOptions): void;
    };
    const addRequest = agent.addRequest.bind(agent);
    agent.addRequest = (request, options) => {
      let finished = false;
      const done = (value: Receipt) => { if (!finished) { finished = true; receipt(value); } };
      request.once("error", () => done({ kind, collectorAccepted: false }));
      request.once("response", response => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 16384) chunks.push(chunk); });
        response.once("error", () => done({ kind, collectorAccepted: false, status: response.statusCode }));
        response.once("end", () => {
          let accepted = false, responseHash: string | undefined;
          try {
            if (bytes > 16384 || response.statusCode !== 200) throw new Error("Unverified collector response");
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            responseHash = hash(body);
            const partial = body.partialSuccess;
            accepted = !!body && typeof body === "object" && !Array.isArray(body)
              && (partial === undefined || partial !== null && typeof partial === "object" && !Array.isArray(partial)
                && Number(partial.rejectedSpans ?? 0) === 0 && Number(partial.rejectedDataPoints ?? 0) === 0);
          } catch { /* A transport success alone is not a collector acceptance. */ }
          done({ kind, collectorAccepted: accepted, status: response.statusCode, ...(responseHash ? { responseHash } : {}) });
        });
      });
      addRequest(request, options);
    };
    return agent;
  };
}

/** Explicit providers avoid global registration and cross-run SDK state. */
export function createInfraOtel(endpoint: string, receipt: (value: Receipt) => void) {
  const resource = resourceFromAttributes({ "service.name": "goalspec-infra-v1" });
  const traces = new TracerProvider({ resource, spanProcessors: [new BatchSpanProcessor({
    exporter: new OTLPTraceExporter({ url: new URL("/v1/traces", endpoint).href, timeoutMillis: 2000,
      httpAgentOptions: receiptAgent("traces", receipt) }),
    maxQueueSize: 4096, maxExportBatchSize: 256, scheduledDelayMillis: 1000, exportTimeoutMillis: 2500,
  })] });
  const metrics = new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: new URL("/v1/metrics", endpoint).href, timeoutMillis: 2000,
      httpAgentOptions: receiptAgent("metrics", receipt) }), exportIntervalMillis: 60000, exportTimeoutMillis: 2500,
  })] });
  const tracer = traces.getTracer("goalspec"), meter = metrics.getMeter("goalspec");
  const spans = meter.createCounter("goalspec_runtime_spans_total");
  const duration = meter.createCounter("goalspec_runtime_span_duration_seconds_total");
  return {
    start(name: string, runId: string, attributes: Record<string, string | number | boolean>) {
      const parent = trace.setSpanContext(ROOT_CONTEXT, { traceId: hash(runId).slice(0, 32),
        spanId: hash({ runId, root: true }).slice(0, 16), traceFlags: TraceFlags.SAMPLED });
      return tracer.startSpan(name, { attributes }, parent);
    },
    finish(span: ReturnType<typeof tracer.startSpan>, success: boolean, seconds: number) {
      span.setStatus({ code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR }); span.end();
      spans.add(1); duration.add(seconds);
    },
    async close() {
      // shutdown drains the SDK processors; no hand-written OTLP payloads.
      try { await traces.shutdown(); } finally { await metrics.shutdown(); }
    },
  };
}
