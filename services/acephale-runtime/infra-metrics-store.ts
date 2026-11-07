import { lstat, open, opendir } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";

type MetricType = "counter" | "gauge" | "histogram";
type Sample = { name: string; base: string; type: MetricType; labels: string; value: number };
type Aggregate = Sample & { modified: number; file: string };
const allowedLabels = new Set(["arm", "outcome", "tool", "kind", "category", "stage", "le"]);
const metricName = /^acephale_[a-z_]+$/;

function labels(text: string): string {
  if (!text) return "";
  const values = new Map<string, string>();
  const expression = /([a-z_]+)=("(?:[^"\\]|\\["\\n])*")(?:,|$)/gy;
  let offset = 0;
  while (offset < text.length) {
    expression.lastIndex = offset;
    const match = expression.exec(text);
    if (!match || !allowedLabels.has(match[1]) || values.has(match[1])) throw new Error("Invalid metric labels");
    const value = JSON.parse(match[2]) as string;
    if (value.length > 128) throw new Error("Metric label exceeds bound");
    values.set(match[1], value); offset = expression.lastIndex;
  }
  return [...values].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(",");
}

function parseSnapshot(text: string): Sample[] {
  const lines = text.split(/\r?\n/), types = new Map<string, MetricType>();
  if (text && !text.endsWith("\n")) throw new Error("Incomplete metrics snapshot");
  for (const line of lines) {
    const match = /^# TYPE (acephale_[a-z_]+) (counter|gauge|histogram)$/.exec(line);
    if (!match) continue;
    if (types.has(match[1])) throw new Error("Duplicate metric type");
    types.set(match[1], match[2] as MetricType);
  }
  const result: Sample[] = [], seen = new Set<string>();
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const match = /^(acephale_[a-z_]+)(?:\{(.*)\})? ([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(line);
    if (!match || !metricName.test(match[1])) throw new Error("Invalid metric sample");
    const name = match[1], labelText = labels(match[2] ?? ""), value = Number(match[3]);
    if (!Number.isFinite(value) || value < 0) throw new Error("Nonfinite or negative metric sample");
    const base = types.has(name) ? name : name.replace(/_(bucket|sum|count)$/, "");
    const type = types.get(base);
    if (!type || (base !== name && type !== "histogram") || (type === "histogram" && base === name)) throw new Error("Missing metric type");
    if (name.endsWith("_bucket") && !/(?:^|,)le=/.test(labelText)) throw new Error("Histogram bucket lacks bound");
    const key = `${name}{${labelText}}`;
    if (seen.has(key)) throw new Error("Duplicate sample in one snapshot");
    seen.add(key); result.push({ name, base, type, labels: labelText, value });
    if (result.length > 50000) throw new Error("Snapshot has too many metric series");
  }
  return result;
}

/** Aggregate atomically published, local run snapshots without reading raw traces. */
export async function aggregateInfraMetrics(root: string, options: {
  maxFiles?: number; maxFileBytes?: number; maxEntries?: number;
} = {}): Promise<{ text: string; files: number; skipped: number; limited: boolean }> {
  const maxFiles = options.maxFiles ?? 1000, maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 100000;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 1000
    || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 8 * 1024 * 1024
    || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000) throw new Error("Invalid metric aggregation bounds");
  const directory = resolve(root), rootStat = await lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Metric root must be a real directory");
  const pending = [directory], aggregates = new Map<string, Aggregate>(), types = new Map<string, MetricType>();
  let files = 0, candidates = 0, entries = 0, skipped = 0, limited = false;
  while (pending.length && !limited) {
    const current = pending.pop()!;
    let iterator;
    try {
      const directoryState = await lstat(current);
      if (!directoryState.isDirectory() || directoryState.isSymbolicLink()) { skipped++; continue; }
      iterator = await opendir(current);
    } catch { skipped++; continue; }
    for await (const entry of iterator) {
      entries++;
      if (entries > maxEntries) { limited = true; break; }
      const file = join(current, entry.name);
      if (entry.isSymbolicLink()) { skipped++; continue; }
      if (entry.isDirectory()) { pending.push(file); continue; }
      if (entry.name !== "metrics.prom" || !entry.isFile()) continue;
      if (candidates >= maxFiles) { limited = true; break; }
      candidates++;
      let snapshot: Sample[], modified: number;
      try {
        const before = await lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.size > maxFileBytes) { skipped++; continue; }
        const handle = await open(file, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
        try {
          const actual = await handle.stat();
          // Detect replacement between enumeration and opening. On Linux inode identity is meaningful.
          if (!actual.isFile() || actual.size > maxFileBytes || actual.ino !== before.ino
            || (process.platform !== "win32" && actual.dev !== before.dev)) throw new Error("Metrics snapshot changed while opening");
          const bytes = Buffer.alloc(maxFileBytes + 1);
          let count = 0;
          while (count < bytes.length) {
            const read = await handle.read(bytes, count, bytes.length - count, count);
            if (!read.bytesRead) break;
            count += read.bytesRead;
          }
          if (count > maxFileBytes) throw new Error("Metrics snapshot exceeds size bound");
          const after = await handle.stat();
          if (after.size !== actual.size || after.mtimeMs !== actual.mtimeMs) throw new Error("Metrics snapshot changed during read");
          snapshot = parseSnapshot(bytes.subarray(0, count).toString("utf8")); modified = actual.mtimeMs;
        } finally { await handle.close(); }
      } catch { skipped++; continue; }
      if (aggregates.size + snapshot.filter(sample => !aggregates.has(`${sample.name}{${sample.labels}}`)).length > 50000) { limited = true; break; }
      for (const sample of snapshot) {
        if (types.has(sample.base) && types.get(sample.base) !== sample.type) throw new Error("Conflicting metric types across run snapshots");
        types.set(sample.base, sample.type);
        const key = `${sample.name}{${sample.labels}}`, prior = aggregates.get(key);
        if (sample.type === "gauge") {
          if (!prior || modified > prior.modified || (modified === prior.modified && file.localeCompare(prior.file) > 0)) aggregates.set(key, { ...sample, modified, file });
        } else {
          const value = (prior?.value ?? 0) + sample.value;
          if (!Number.isFinite(value)) throw new Error("Aggregated metric overflow");
          aggregates.set(key, { ...sample, value, modified, file });
        }
      }
      files++;
    }
  }
  const lines = [...types].sort(([left], [right]) => left.localeCompare(right)).map(([name, type]) => `# TYPE ${name} ${type}`);
  lines.push(...[...aggregates].sort(([left], [right]) => left.localeCompare(right)).map(([key, sample]) => `${key} ${sample.value}`));
  return { text: lines.length ? lines.join("\n") + "\n" : "", files, skipped, limited };
}
