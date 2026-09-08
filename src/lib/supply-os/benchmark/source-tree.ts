import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

export const BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM = "sha256_git_ls_files_path_bytes_v1" as const;

export type BenchmarkSourceTreeFingerprint = {
  algorithm: typeof BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM;
  sha256: string;
  fileCount: number;
};

export type BenchmarkSourceTreeEntry = {
  path: string;
  bytes: Uint8Array | null;
};

function validatePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`Benchmark source-tree path is not canonical: ${JSON.stringify(path)}.`);
  }
}

/** Hashes canonical repository-relative paths and exact working-tree bytes. */
export function fingerprintBenchmarkSourceTreeEntries(
  entries: readonly BenchmarkSourceTreeEntry[],
): BenchmarkSourceTreeFingerprint {
  const sorted = [...entries].sort((left, right) => Buffer.compare(
    Buffer.from(left.path, "utf8"),
    Buffer.from(right.path, "utf8"),
  ));
  const seen = new Set<string>();
  const hash = createHash("sha256").update(`${BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM}\0`, "utf8");
  for (const entry of sorted) {
    validatePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`Benchmark source-tree path is duplicated: ${entry.path}.`);
    seen.add(entry.path);
    const pathBytes = Buffer.from(entry.path, "utf8");
    const contentBytes = entry.bytes == null ? null : Buffer.from(entry.bytes);
    const frame = Buffer.alloc(13);
    frame.writeUInt32BE(pathBytes.byteLength, 0);
    frame.writeUInt8(contentBytes == null ? 0 : 1, 4);
    frame.writeBigUInt64BE(BigInt(contentBytes?.byteLength ?? 0), 5);
    hash.update(frame);
    hash.update(pathBytes);
    if (contentBytes) hash.update(contentBytes);
  }
  return {
    algorithm: BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM,
    sha256: hash.digest("hex"),
    fileCount: sorted.length,
  };
}

async function workingTreeBytes(repositoryRoot: string, path: string) {
  const absolutePath = resolve(repositoryRoot, ...path.split("/"));
  try {
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) return Buffer.from(await readlink(absolutePath), "utf8");
    return await readFile(absolutePath);
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

export async function benchmarkSourceTreeFingerprint(
  repositoryRoot = process.cwd(),
): Promise<BenchmarkSourceTreeFingerprint> {
  const paths = await benchmarkSourceTreePaths(repositoryRoot);
  const entries: BenchmarkSourceTreeEntry[] = [];
  for (const path of paths) {
    entries.push({ path, bytes: await workingTreeBytes(repositoryRoot, path) });
  }
  return fingerprintBenchmarkSourceTreeEntries(entries);
}

export async function benchmarkSourceTreePaths(repositoryRoot = process.cwd()) {
  const run = promisify(execFile);
  const { stdout } = await run("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ], {
    cwd: repositoryRoot,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split("\0").filter(Boolean);
}
