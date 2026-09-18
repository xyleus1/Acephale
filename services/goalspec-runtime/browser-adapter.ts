import type { Browser } from "playwright-core";
import type { Invocation } from "../../src/lib/goalspec/contracts/generated";
import type { Observation, ReadExecutor } from "../../src/lib/goalspec/scheduler";
import { hash } from "../../src/lib/goalspec/canonical";

export interface BrowserSnapshot {
  id: string; origin: string; stateVersion: string; isolationAudit: string;
}
// This provider owns actual backend isolation/reset, not merely browser contexts.
// A new context against the authoritative server is never an isolated snapshot.
export interface BrowserSnapshotProvider {
  acquire(): Promise<BrowserSnapshot>;
  fresh(snapshot: BrowserSnapshot): Promise<boolean>;
  release(snapshot: BrowserSnapshot): Promise<void>;
  reset(): Promise<void>;
  verify(expected: unknown): Promise<{ passed: boolean; evidence: unknown }>;
}
export class WebArenaReadExecutor implements ReadExecutor {
  private observations = new Map<string, { snapshot: BrowserSnapshot; observation: Observation }>();
  constructor(private browser: Browser, private snapshots: BrowserSnapshotProvider,
    private authoritativeOrigin: string, private scope: Invocation["scope"], private record: (event: unknown) => void) {
    if (new URL(authoritativeOrigin).origin !== authoritativeOrigin) throw new Error("Expected canonical authoritative origin");
  }
  eligible(invocation: Invocation) {
    try {
      return invocation.tool === "browser_observe" && hash(invocation.scope) === hash(this.scope)
        && typeof invocation.arguments.url === "string" && new URL(invocation.arguments.url).origin === this.authoritativeOrigin
        && Object.keys(invocation.arguments).length === 1;
    } catch { return false; }
  }
  async read(invocation: Invocation, signal: AbortSignal): Promise<Observation> {
    if (!this.eligible(invocation)) throw new Error("Browser speculation denied");
    signal.throwIfAborted();
    const snapshot = await this.snapshots.acquire();
    const origin = new URL(snapshot.origin).origin;
    if (origin === this.authoritativeOrigin || origin !== snapshot.origin || !snapshot.isolationAudit) {
      await this.snapshots.release(snapshot); throw new Error("Backend isolation was not established");
    }
    const context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true });
    let retained = false;
    const abort = () => { void context.close().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await context.route("**/*", async route => {
        const request = route.request();
        const allowed = request.method() === "GET" && new URL(request.url()).origin === origin;
        this.record({ type: "browser_request", allowed, method: request.method(), snapshot: snapshot.id });
        if (allowed) await route.continue(); else await route.abort("blockedbyclient");
      });
      await context.routeWebSocket("**/*", socket => socket.close());
      const page = await context.newPage();
      page.on("dialog", dialog => { void dialog.dismiss(); });
      const original = new URL(invocation.arguments.url as string);
      const target = new URL(original.pathname + original.search, origin).href;
      const response = await page.goto(target, { waitUntil: "load", timeout: 4500 });
      if (!response?.ok() || new URL(page.url()).origin !== origin) throw new Error("Browser observation failed");
      const content = await page.locator("body").innerText({ timeout: 1000 });
      const links = await page.locator("a[href]").evaluateAll(nodes => nodes.map(node => ({ text: node.textContent ?? "", href: (node as HTMLAnchorElement).href })));
      if (content.length > 200_000 || links.length > 500) throw new Error("Browser evidence exceeds limit");
      signal.throwIfAborted();
      if (!await this.snapshots.fresh(snapshot)) throw new Error("Browser snapshot stale");
      const observation = { url: original.href, title: await page.title(), content,
        links: links.map(link => ({ ...link, href: link.href.startsWith(origin + "/") ? this.authoritativeOrigin + link.href.slice(origin.length) : link.href })) };
      const key = hash(invocation);
      const prior = this.observations.get(key);
      if (prior) await this.snapshots.release(prior.snapshot);
      this.observations.set(key, { snapshot, observation }); retained = true;
      return observation;
    } finally {
      signal.removeEventListener("abort", abort);
      await context.close(); // Confirms browser work has physically ended.
      if (!retained) await this.snapshots.release(snapshot);
    }
  }
  async validate(invocation: Invocation, previous: Observation, signal: AbortSignal) {
    signal.throwIfAborted();
    const entry = this.observations.get(hash(invocation));
    if (!this.eligible(invocation) || !entry || hash(previous) !== hash(entry.observation) || !await this.snapshots.fresh(entry.snapshot)) throw new Error("Browser freshness validation failed");
    this.record({ type: "browser_revalidation", snapshot: entry.snapshot.id });
    return entry.observation;
  }
  async reset() { await this.close(); await this.snapshots.reset(); }
  verify(expected: unknown) { return this.snapshots.verify(expected); }
  async close() {
    const entries = [...this.observations.values()]; this.observations.clear();
    await Promise.all(entries.map(entry => this.snapshots.release(entry.snapshot)));
  }
}
