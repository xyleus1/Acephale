import { unstable_cache } from "next/cache";
import {
  INTEL_SOURCE_HOSTS,
  getIntelSource,
  isSecretFreeSourceUrl,
  type IntelSourceId,
  type IntelSourceUse,
} from "./sources";

export type IntelFetchResult = Omit<IntelSourceUse, "fetchedAt" | "reviewedAt"> & {
  fetchedAt: string;
  reviewedAt: null;
  text: string;
};

type IntelFetchInput = {
  sourceId: IntelSourceId;
  requestUrl: string;
  sourceUrl: string;
  timeoutMs?: number;
};

function cacheKeyForRequest(sourceId: IntelSourceId, requestUrl: string): string {
  const url = new URL(requestUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:api[_-]?key|key|token|access[_-]?token|webkey|client[_-]?secret|secret|signature|sig|credential|password)$/i.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return `${sourceId}:${url.toString()}`;
}

export async function fetchIntelSourceText(input: IntelFetchInput): Promise<IntelFetchResult> {
  const source = getIntelSource(input.sourceId);
  if (source.access === "manual") throw new Error(`Intel source ${input.sourceId} is manual and cannot be fetched`);
  if (!isSecretFreeSourceUrl(input.sourceUrl)) {
    throw new Error(`Intel source ${input.sourceId} requires a secret-free citation URL`);
  }

  const request = new URL(input.requestUrl);
  if (request.protocol !== "https:" || request.username || request.password) {
    throw new Error(`Intel source ${input.sourceId} requires an HTTPS request without URL credentials`);
  }
  if (!INTEL_SOURCE_HOSTS[input.sourceId].includes(request.hostname.toLowerCase())) {
    throw new Error(`Intel source ${input.sourceId} cannot fetch host ${request.hostname}`);
  }

  const timeoutMs = input.timeoutMs ?? 10_000;
  const cachedFetch = unstable_cache(
    async (): Promise<IntelFetchResult> => {
      const response = await fetch(input.requestUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Intel source ${input.sourceId} returned HTTP ${response.status}`);
      return {
        sourceId: input.sourceId,
        sourceUrl: input.sourceUrl,
        asOf: null,
        fetchedAt: new Date().toISOString(),
        reviewedAt: null,
        text: await response.text(),
      };
    },
    ["intel-source", cacheKeyForRequest(input.sourceId, input.requestUrl)],
    { revalidate: source.cacheSeconds }
  );

  return cachedFetch();
}
