import { Pool } from "pg";

export interface ResearchQuery {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<Row[]>;
}
export interface ResearchClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(destroy?: boolean): void;
}
export interface ResearchPool {
  connect(): Promise<ResearchClient>;
  end(): Promise<void>;
}
export interface TransactionOptions {
  isolationLevel?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
  readOnly?: boolean;
  statementTimeoutMs?: number;
  acquireTimeoutMs?: number;
  signal?: AbortSignal;
}
export interface ResearchDatabase extends ResearchQuery {
  transaction<T>(operation: (query: ResearchQuery) => Promise<T>, options?: TransactionOptions): Promise<T>;
  close(): Promise<void>;
}

/** Aborts destroy the connection instead of returning a running query to the pool. */
export function createResearchDatabase(pool: ResearchPool): ResearchDatabase {
  const pending = new Set<Promise<unknown>>();
  let closing = false, closed: Promise<void> | undefined;
  const transaction = <T>(operation: (query: ResearchQuery) => Promise<T>, options: TransactionOptions = {}): Promise<T> => {
    if (closing) return Promise.reject(new Error("Research database is closing"));
    const isolation = options.isolationLevel ?? "READ COMMITTED";
    if (!["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"].includes(isolation)) return Promise.reject(new Error("Invalid transaction isolation"));
    for (const timeout of [options.statementTimeoutMs, options.acquireTimeoutMs]) {
      if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000)) return Promise.reject(new Error("Invalid database timeout"));
    }
    const task = (async () => {
      options.signal?.throwIfAborted();
      let client: ResearchClient | undefined, released = false, abandoned = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAcquire: (error: unknown) => void = () => {};
      const release = (destroy = false) => { if (client && !released) { released = true; client.release(destroy); } };
      const onAbort = () => { abandoned = true; release(true); rejectAcquire(options.signal?.reason ?? new Error("Database transaction aborted")); };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const interrupted = new Promise<never>((_, reject) => { rejectAcquire = reject; });
        const acquired = pool.connect().then(connection => {
          if (abandoned) { connection.release(true); throw new Error("Database acquisition abandoned"); }
          client = connection; return connection;
        });
        timer = setTimeout(() => { abandoned = true; rejectAcquire(new Error("Research database acquisition timed out")); }, options.acquireTimeoutMs ?? 1000);
        await Promise.race([acquired, interrupted]);
        clearTimeout(timer); timer = undefined;
        const query: ResearchQuery = { async query<Row>(text: string, values: unknown[] = []) {
          options.signal?.throwIfAborted();
          if (released) throw new Error("Database connection released");
          const result = await client!.query(text, values);
          options.signal?.throwIfAborted();
          return result.rows as Row[];
        } };
        await query.query(`BEGIN ISOLATION LEVEL ${isolation}${options.readOnly ? " READ ONLY" : ""}`);
        await query.query("SELECT set_config('statement_timeout', $1, true)", [String(options.statementTimeoutMs ?? 5000)]);
        try {
          const result = await operation(query);
          await query.query("COMMIT");
          return result;
        } catch (error) {
          if (!released) { try { await client!.query("ROLLBACK"); } catch { release(true); } }
          throw error;
        }
      } catch (error) {
        release(true);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        release();
      }
    })();
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  return {
    transaction,
    query: <Row>(text: string, values?: unknown[]) => transaction(query => query.query<Row>(text, values)),
    close() {
      if (!closed) { closing = true; closed = (async () => { await Promise.allSettled([...pending]); await pool.end(); })(); }
      return closed;
    },
  };
}

export function researchDatabase(url: string): ResearchDatabase {
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol) || !/^\/acephale_[a-z0-9_]+$/.test(parsed.pathname)) throw new Error("Dedicated acephale_ research database required");
  return createResearchDatabase(new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 1000,
    application_name: "acephale-research", idleTimeoutMillis: 10_000 }));
}
