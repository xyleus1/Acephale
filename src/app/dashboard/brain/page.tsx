import type { ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { CompanyBrainChat } from "@/components/company-brain-chat";
import { TaskListInline } from "@/components/task-list-inline";
import { WorldIntelligenceMap } from "@/components/intelligence/world-intelligence-map";
import { getIntelligenceMapData } from "@/lib/market-intelligence/intelligence-map";

type SearchParams = Promise<{
  section?: string;
  map?: string;
}>;

const SECTIONS = [
  { key: "chat", label: "Chat", href: "/dashboard/brain" },
  { key: "todos", label: "To-dos", href: "/dashboard/brain?section=todos" },
  { key: "news", label: "Daily news", href: "/dashboard/brain?section=news" },
  { key: "map", label: "Intelligence map", href: "/dashboard/brain?section=map" },
] as const;

function newsTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function CompanyBrainPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const section = sp.section === "todos" || sp.section === "news" || sp.section === "map"
    ? sp.section
    : undefined;
  const mapView = sp.map === "internal" ? "internal" : "external";
  const active = section ?? "chat";

  let body: ReactNode;

  if (!section) {
    body = <CompanyBrainChat />;
  } else if (section === "todos") {
    const tasks = await prisma.task.findMany({
      where: { officeId: session.officeId, status: "OPEN" },
      orderBy: [{ dueAt: "asc" }],
      take: 100,
      include: { company: { select: { id: true, name: true } } },
    });
    body = (
      <section className="brain-section">
        <div className="brain-section-head">
          <div>
            <h2 className="brain-section-title">Open to-dos</h2>
            <p className="brain-section-note">
              Collected from the daily ops crons and the CRM. Tick a task to mark it done.
            </p>
          </div>
        </div>
        <div className="brain-card">
          <TaskListInline
            tasks={tasks.map((task) => ({
              id: task.id,
              title: task.title,
              dueAt: task.dueAt ? task.dueAt.toISOString() : null,
              company: task.company,
            }))}
            now={new Date().toISOString()}
            labels={{ colTask: "Task", colCompany: "Company", colDue: "Due" }}
          />
        </div>
      </section>
    );
  } else if (section === "news") {
    const data = await getIntelligenceMapData(session.officeId);
    const hotspots = data.hotspots
      .filter((hotspot) => (hotspot.severity === "high" || hotspot.severity === "critical") && hotspot.latestSummary)
      .slice(0, 4);
    body = (
      <section className="brain-section">
        <div className="brain-section-head">
          <div>
            <h2 className="brain-section-title">Daily news</h2>
            <p className="brain-section-note">
              Refreshed daily at 11:00 UTC by the market intelligence cron.
            </p>
          </div>
          <Link href="/dashboard/intelligence" className="brain-section-link">Market intelligence</Link>
        </div>

        {hotspots.length > 0 && (
          <div className="brain-hotspot-strip" aria-label="High-severity hotspots">
            {hotspots.map((hotspot) => (
              <div key={hotspot.id} className={`brain-hotspot brain-hotspot-${hotspot.severity}`}>
                <div className="brain-hotspot-label">
                  <span>{hotspot.label}</span>
                  <span className="brain-hotspot-severity">{hotspot.severity}</span>
                </div>
                <p className="brain-hotspot-summary">{hotspot.latestSummary}</p>
              </div>
            ))}
          </div>
        )}

        {data.researchItems.length === 0 ? (
          <div className="brain-empty-note">
            No research items yet. The next cron run will populate this feed.
          </div>
        ) : (
          <ol className="brain-news-list">
            {data.researchItems.map((item) => (
              <li key={item.id} className="brain-news-item">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="brain-news-title">
                    {item.title}
                  </a>
                ) : (
                  <span className="brain-news-title">{item.title}</span>
                )}
                <div className="brain-news-meta">
                  {item.sourceName && <span>{item.sourceName}</span>}
                  <span>{newsTime(item.occurredAt)}</span>
                  {item.contentQualityScore != null && (
                    <span>Quality {Math.round(item.contentQualityScore)}/100</span>
                  )}
                </div>
                {item.excerpt && <p className="brain-news-excerpt">{item.excerpt}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  } else {
    const mapSwitcher = (
      <nav className="brain-switch brain-subswitch" aria-label="Map views">
        <Link
          href="/dashboard/brain?section=map"
          className={`brain-switch-link${mapView === "external" ? " active" : ""}`}
        >
          External logistics
        </Link>
        <Link
          href="/dashboard/brain?section=map&map=internal"
          className={`brain-switch-link${mapView === "internal" ? " active" : ""}`}
        >
          Internal company
        </Link>
      </nav>
    );

    if (mapView === "external") {
      const data = await getIntelligenceMapData(session.officeId);
      body = (
        <section className="brain-section brain-section-wide">
          {mapSwitcher}
          <WorldIntelligenceMap data={data} />
        </section>
      );
    } else {
      const [knowledgeObjects, agentMemories, memoryEvents] = await Promise.all([
        prisma.knowledgeObject.count({ where: { officeId: session.officeId } }),
        prisma.agentMemory.count({ where: { officeId: session.officeId } }),
        prisma.memoryEvent.count({ where: { officeId: session.officeId } }),
      ]);
      body = (
        <section className="brain-section">
          {mapSwitcher}
          <div className="brain-placeholder">
            <h2 className="brain-section-title">Internal company map</h2>
            <p className="brain-placeholder-copy">
              This view will visualize the company&apos;s internal brain: memory objects,
              entities, and decisions, connected the way the agents read them. It is
              not configured yet — the substrate below is already collecting.
            </p>
            <div className="brain-count-row" aria-label="Memory substrate counts">
              <div className="brain-count">
                <div className="brain-count-value">{knowledgeObjects}</div>
                <div className="brain-count-label">Knowledge objects</div>
              </div>
              <div className="brain-count">
                <div className="brain-count-value">{agentMemories}</div>
                <div className="brain-count-label">Agent memories</div>
              </div>
              <div className="brain-count">
                <div className="brain-count-value">{memoryEvents}</div>
                <div className="brain-count-label">Memory events</div>
              </div>
            </div>
          </div>
        </section>
      );
    }
  }

  return (
    // <main> so the agent page-cue fallback (querySelector("main")) resolves here.
    <main className={`brain-page${active === "chat" ? " brain-page-chat" : ""}`}>
      <header className="brain-header">
        <div className="brain-kicker">Company Brain</div>
        <nav className="brain-switch" aria-label="Company brain sections">
          {SECTIONS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`brain-switch-link${active === item.key ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {body}
    </main>
  );
}
