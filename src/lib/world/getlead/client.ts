export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GetleadFilters = {
  countries?: string[];
  regions?: string[];
  keywords?: string[];
  exclude_keywords?: string[];
  exclude_domains?: string[];
  exclude_titles?: string[];
  seniorities?: string[];
  titles?: string[];
  employees_min?: number;
  employees_max?: number;
  require_email?: boolean;
};

export type GetleadUsage = {
  balance_cents?: number;
  prices?: {
    people_cents_per_1k?: number;
    company_cents_per_1k?: number;
    verify_cents_per_1k?: number;
  };
  [key: string]: unknown;
};

export type GetleadCount = {
  people?: number;
  companies?: number;
  with_email: number;
  headroom?: number;
  unsupported?: string[];
  sparse?: string[];
  seconds?: number;
  [key: string]: unknown;
};

export type GetleadContactRow = {
  first?: string | null;
  last?: string | null;
  full_name?: string | null;
  title?: string | null;
  seniority?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  domain?: string | null;
  company_name?: string | null;
  industry?: string | null;
  company_industry?: string | null;
  company_size?: string | number | null;
  employees?: number | null;
  revenue_band?: string | null;
  locality?: string | null;
  region?: string | null;
  country_code?: string | null;
  li_slug?: string | null;
  company_categories?: string | null;
  technologies?: string | null;
  company_phone?: string | null;
  company_linkedin_url?: string | null;
  source_updated?: string | null;
  email_verified_at?: string | null;
  [key: string]: unknown;
};

export type GetleadCompanyRow = {
  domain?: string | null;
  name?: string | null;
  description?: string | null;
  categories?: string | null;
  keywords?: string | null;
  technologies?: string | null;
  employees?: number | null;
  employee_band?: string | null;
  revenue_band?: string | null;
  founded?: string | number | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  country_code?: string | null;
  city?: string | null;
  region?: string | null;
  street?: string | null;
  postal?: string | null;
  operating_status?: string | null;
  funding_total?: number | null;
  last_funding_at?: string | null;
  people_known?: number | null;
  people_with_email?: number | null;
  [key: string]: unknown;
};

export type GetleadPreview = {
  rows: GetleadContactRow[];
  unsupported?: string[];
  [key: string]: unknown;
};

export type GetleadContactDelivery = {
  job_id: string;
  status: "queued" | string;
  requested: number;
  estimated_cents: number;
  poll?: string;
  [key: string]: unknown;
};

export type GetleadJob = {
  status: "queued" | "verifying" | "done" | "failed" | string;
  requested: number;
  drawn: number;
  probed: number;
  delivered: number;
  charged_cents: number;
  rows: GetleadContactRow[];
  total_rows: number;
  error?: string | null;
  [key: string]: unknown;
};

export type GetleadCompanyDelivery = {
  job_id: string;
  rows: GetleadCompanyRow[];
  delivered: number;
  charged_cents: number;
  [key: string]: unknown;
};

export type GetleadVerification = {
  results: Array<{ email: string; status: string }>;
  charged_cents?: number;
  [key: string]: unknown;
};

export class GetleadApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const message = typeof body === "string" && body
      ? body
      : typeof body === "object" && body !== null && "message" in body
      ? String((body as { message?: unknown }).message)
      : `Getlead API request failed with HTTP ${status}`;
    super(message);
    this.name = "GetleadApiError";
    this.status = status;
    this.body = body;
  }
}

export class GetleadBudgetError extends Error {
  readonly maxCents: number;
  readonly estimatedCents: number;
  readonly jobId: string | null;

  constructor(message: string, args: {
    maxCents: number;
    estimatedCents: number;
    jobId?: string | null;
  }) {
    super(message);
    this.name = "GetleadBudgetError";
    this.maxCents = args.maxCents;
    this.estimatedCents = args.estimatedCents;
    this.jobId = args.jobId ?? null;
  }
}

type GetleadClient = {
  usage(): Promise<GetleadUsage>;
  vocabulary(): Promise<unknown>;
  searchCount(filters: GetleadFilters): Promise<GetleadCount>;
  searchPreview(filters: GetleadFilters): Promise<GetleadPreview>;
  searchDeliver(filters: GetleadFilters, limit: number): Promise<GetleadContactDelivery>;
  getJob(jobId: string, options?: { offset?: number; limit?: number }): Promise<GetleadJob>;
  fetchJobRows(jobId: string): Promise<GetleadContactRow[]>;
  waitForJob(jobId: string, options?: {
    pollMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }): Promise<GetleadJob>;
  companiesCount(filters: GetleadFilters): Promise<GetleadCount>;
  companiesDeliver(filters: GetleadFilters, limit: number): Promise<GetleadCompanyDelivery>;
  verify(emails: string[]): Promise<GetleadVerification>;
};

function ensureLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25_000) {
    throw new Error("Getlead delivery limit must be an integer from 1 to 25000");
  }
}

export function createGetleadClient(args: {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
}): GetleadClient {
  if (!args.apiKey) throw new Error("GETLEAD_API_KEY is required");
  const fetcher = args.fetch ?? fetch;
  const baseUrl = (args.baseUrl ?? "https://api.getle.ad").replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetcher(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${args.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await response.text();
    let payload: unknown = responseBody;
    try {
      payload = responseBody ? JSON.parse(responseBody) : null;
    } catch {
      payload = responseBody;
    }
    if (!response.ok) throw new GetleadApiError(response.status, payload);
    return payload as T;
  }

  async function getJob(jobId: string, options: { offset?: number; limit?: number } = {}) {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 1_000;
    return request<GetleadJob>(
      "GET",
      `/api/v2/data/jobs/${encodeURIComponent(jobId)}?offset=${offset}&limit=${limit}`,
    );
  }

  const client: GetleadClient = {
    usage: () => request<GetleadUsage>("GET", "/api/v2/data/usage"),
    vocabulary: () => request("GET", "/api/v2/data/vocabulary"),
    searchCount: (filters) => request<GetleadCount>("POST", "/api/v2/data/search/count", { filters }),
    searchPreview: (filters) => request<GetleadPreview>("POST", "/api/v2/data/search/preview", { filters }),
    searchDeliver: (filters, limit) => {
      ensureLimit(limit);
      return request<GetleadContactDelivery>("POST", "/api/v2/data/search/deliver", { filters, limit });
    },
    getJob,
    fetchJobRows: async (jobId) => {
      const first = await getJob(jobId, { offset: 0 });
      if (first.status !== "done") {
        throw new Error(`Getlead job ${jobId} is ${first.status}, not done`);
      }
      const rows = [...first.rows];
      const pageSize = Math.max(first.rows.length, 1_000);
      for (let offset = rows.length; offset < first.total_rows; offset += pageSize) {
        const page = await getJob(jobId, { offset, limit: pageSize });
        if (page.status !== "done") throw new Error(`Getlead job ${jobId} is ${page.status}, not done`);
        rows.push(...page.rows);
      }
      return rows.slice(0, first.total_rows);
    },
    waitForJob: async (jobId, options = {}) => {
      const pollMs = options.pollMs ?? 20_000;
      const timeoutMs = options.timeoutMs ?? 10 * 60_000;
      const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      const started = Date.now();
      let job = await getJob(jobId);
      while (job.status === "queued" || job.status === "verifying") {
        if (Date.now() - started >= timeoutMs) {
          throw new Error(`Getlead job ${jobId} timed out after ${timeoutMs}ms`);
        }
        await sleep(pollMs);
        job = await getJob(jobId);
      }
      if (job.status === "failed") throw new Error(job.error || `Getlead job ${jobId} failed`);
      return job;
    },
    companiesCount: (filters) => request<GetleadCount>("POST", "/api/v2/data/companies/count", { filters }),
    companiesDeliver: (filters, limit) => {
      ensureLimit(limit);
      return request<GetleadCompanyDelivery>("POST", "/api/v2/data/companies/deliver", { filters, limit });
    },
    verify: (emails) => request<GetleadVerification>("POST", "/api/v2/data/verify", { emails }),
  };
  return client;
}

export async function deliverContactsGuarded(args: {
  client: GetleadClient;
  filters: GetleadFilters;
  limit: number;
  maxCents: number;
}) {
  const count = await args.client.searchCount(args.filters);
  if (count.unsupported?.length) {
    throw new GetleadBudgetError(`Unsupported Getlead filters: ${count.unsupported.join(", ")}`, {
      maxCents: args.maxCents,
      estimatedCents: 0,
    });
  }
  if (count.with_email <= 0) {
    throw new GetleadBudgetError("Getlead contact search returned no rows with email", {
      maxCents: args.maxCents,
      estimatedCents: 0,
    });
  }
  const usage = await args.client.usage();
  const priceCentsPerRow = typeof usage.prices?.people_cents_per_1k === "number"
    ? usage.prices.people_cents_per_1k / 1_000
    : 0.7;
  const estimatedCents = Math.ceil(Math.min(args.limit, count.with_email) * priceCentsPerRow);
  if (estimatedCents > args.maxCents) {
    throw new GetleadBudgetError("Getlead contact delivery exceeds the configured budget", {
      maxCents: args.maxCents,
      estimatedCents,
    });
  }
  const delivery = await args.client.searchDeliver(args.filters, args.limit);
  return { count, delivery, estimated_cents: delivery.estimated_cents };
}

export async function deliverCompaniesGuarded(args: {
  client: GetleadClient;
  filters: GetleadFilters;
  limit: number;
  maxCents: number;
}) {
  const count = await args.client.companiesCount(args.filters);
  if (count.unsupported?.length) {
    throw new GetleadBudgetError(`Unsupported Getlead filters: ${count.unsupported.join(", ")}`, {
      maxCents: args.maxCents,
      estimatedCents: 0,
    });
  }
  if ((count.companies ?? 0) <= 0) {
    throw new GetleadBudgetError("Getlead company search returned no companies", {
      maxCents: args.maxCents,
      estimatedCents: 0,
    });
  }
  const usage = await args.client.usage();
  const priceCentsPerRow = typeof usage.prices?.company_cents_per_1k === "number"
    ? usage.prices.company_cents_per_1k / 1_000
    : 0.1;
  const estimatedCents = Math.ceil(Math.min(args.limit, count.companies ?? 0) * priceCentsPerRow);
  if (estimatedCents > args.maxCents) {
    throw new GetleadBudgetError("Getlead company delivery exceeds the configured budget", {
      maxCents: args.maxCents,
      estimatedCents,
    });
  }
  const delivery = await args.client.companiesDeliver(args.filters, args.limit);
  return { count, delivery, charged_cents: delivery.charged_cents };
}

export type { GetleadClient };
