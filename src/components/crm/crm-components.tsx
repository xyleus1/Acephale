import { Icon } from "@/components/icon";
import {
  CRM_COMPANY_CATEGORIES,
  CRM_COMPANY_STAGES,
  CRM_CONTACT_TYPES,
  CRM_LEVERAGE_LEVELS,
  CRM_OPPORTUNITY_STAGES,
  CRM_OPPORTUNITY_TYPES,
  CRM_PRIORITIES,
  CRM_RELATIONSHIP_STRENGTHS,
  compactMoney,
  crmLabel,
  dateInputValue,
  daysAgo,
  daysUntil,
  priorityTone,
  sourceTone,
  stageTone,
  strengthTone,
  type CrmTone,
} from "@/lib/crm/types";
import {
  completeCrmTaskAction,
  createCrmCompanyAction,
  createCrmContactAction,
  createCrmNoteAction,
  createCrmOpportunityAction,
  createCrmTaskAction,
  updateCrmCompanyAction,
  updateCrmOpportunityStageAction,
} from "@/lib/crm/actions";
import type { CrmBrainContext } from "@/lib/crm/brain-context";

type AnyRecord = Record<string, any>;

const TONE_CLASS: Record<CrmTone, string> = {
  neutral: "crm-badge-neutral",
  good: "crm-badge-good",
  warn: "crm-badge-warn",
  danger: "crm-badge-danger",
  info: "crm-badge-info",
  strong: "crm-badge-strong",
};

function fmtDate(date: Date | string | null | undefined) {
  if (!date) return "No date";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function relativeDate(date: Date | string | null | undefined) {
  if (!date) return "No date";
  const d = date instanceof Date ? date : new Date(date);
  const ago = daysAgo(d);
  const until = daysUntil(d);
  if (until !== null && until >= 0) return until === 0 ? "today" : `in ${until}d`;
  if (ago !== null) return ago === 0 ? "today" : `${ago}d ago`;
  return fmtDate(d);
}

function ownerText(owners: AnyRecord[] | undefined) {
  const names = (owners ?? []).map((owner) => owner.user?.fullName).filter(Boolean);
  return names.length ? names.join(", ") : "Unassigned";
}

export function CrmBadge({ tone = "neutral", children }: { tone?: CrmTone; children: React.ReactNode }) {
  return <span className={`crm-badge ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function CrmSourceBadge({ source }: { source?: string | null }) {
  return <CrmBadge tone={sourceTone(source)}>{crmLabel(source ?? "manual")}</CrmBadge>;
}

export function CrmPriorityBadge({ priority }: { priority?: string | null }) {
  return <CrmBadge tone={priorityTone(priority)}>{crmLabel(priority ?? "medium")}</CrmBadge>;
}

export function CrmStageBadge({ stage }: { stage?: string | null }) {
  return <CrmBadge tone={stageTone(stage)}>{crmLabel(stage)}</CrmBadge>;
}

export function CrmStrengthBadge({ strength }: { strength?: string | null }) {
  return <CrmBadge tone={strengthTone(strength)}>{crmLabel(strength)}</CrmBadge>;
}

export function CrmPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="crm-page-header">
      <div>
        <div className="crm-eyebrow">Relationships OS</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="crm-page-actions">{actions}</div>}
    </div>
  );
}

export function CrmTabs() {
  const tabs = [
    ["/dashboard/crm", "Command"],
    ["/dashboard/crm/companies", "Companies"],
    ["/dashboard/crm/people", "People"],
    ["/dashboard/crm/opportunities", "Opportunities"],
    ["/dashboard/crm/tasks", "Follow-ups"],
    ["/dashboard/crm/relationships", "Relationships"],
  ];
  return (
    <div className="crm-tabs">
      {tabs.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
    </div>
  );
}

export function CrmFilterBar({
  basePath,
  q,
  category,
  stage,
  priority,
  type,
}: {
  basePath: string;
  q?: string;
  category?: string;
  stage?: string;
  priority?: string;
  type?: string;
}) {
  return (
    <form action={basePath} className="crm-filter-bar">
      <input name="q" placeholder="Search names, domains, notes..." defaultValue={q ?? ""} />
      {category !== undefined && (
        <select name="category" defaultValue={category ?? ""}>
          <option value="">All categories</option>
          {CRM_COMPANY_CATEGORIES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}
        </select>
      )}
      {type !== undefined && (
        <select name="type" defaultValue={type ?? ""}>
          <option value="">All types</option>
          {[...CRM_OPPORTUNITY_TYPES, ...CRM_CONTACT_TYPES].map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}
        </select>
      )}
      {stage !== undefined && (
        <select name="stage" defaultValue={stage ?? ""}>
          <option value="">All stages</option>
          {[...CRM_COMPANY_STAGES, ...CRM_OPPORTUNITY_STAGES].map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}
        </select>
      )}
      {priority !== undefined && (
        <select name="priority" defaultValue={priority ?? ""}>
          <option value="">All priority</option>
          {[...CRM_PRIORITIES, ...CRM_LEVERAGE_LEVELS].map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}
        </select>
      )}
      <button type="submit">Filter</button>
      <a href={basePath} className="crm-muted-link">Clear</a>
    </form>
  );
}

export function CrmCreateCompanyForm() {
  return (
    <details className="crm-create-panel">
      <summary><Icon name="plus" size={13} /> New relationship</summary>
      <form action={createCrmCompanyAction} className="crm-form-grid">
        <label>Company<input name="name" required placeholder="Company, investor, partner..." /></label>
        <label>Domain<input name="domain" placeholder="example.com" /></label>
        <label>Category<select name="crmCategory" defaultValue="prospect">{CRM_COMPANY_CATEGORIES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Stage<select name="crmStage" defaultValue="new">{CRM_COMPANY_STAGES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Priority<select name="crmPriority" defaultValue="medium">{CRM_PRIORITIES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Strength<select name="relationshipStrength" defaultValue="unknown">{CRM_RELATIONSHIP_STRENGTHS.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Next action date<input name="nextActionAt" type="date" /></label>
        <label className="crm-form-wide">Tags<input name="tags" placeholder="yc, shipper, strategic..." /></label>
        <label className="crm-form-wide">Notes<textarea name="crmNotes" placeholder="Internal notes only." /></label>
        <button type="submit">Create relationship</button>
      </form>
    </details>
  );
}

export function CrmCommandCenter({ data }: { data: AnyRecord }) {
  const stats = [
    ["Companies", data.counts.companyCount],
    ["People", data.counts.contactCount],
    ["Opportunities", data.counts.opportunityCount],
    ["Open follow-ups", data.counts.openTaskCount],
  ];
  return (
    <div className="crm-command-grid">
      <section className="crm-panel crm-panel-wide">
        <div className="crm-stat-grid">
          {stats.map(([label, value]) => (
            <div key={label} className="crm-stat">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="crm-panel crm-panel-main">
        <CrmPanelHeader title="Today's follow-ups" count={data.todayTasks.length} href="/dashboard/crm/tasks" />
        <CrmTaskRows tasks={data.todayTasks} compact />
      </section>

      <section className="crm-panel">
        <CrmPanelHeader title="Agent suggestions" count={data.agentSuggestions.length} />
        <div className="crm-list">
          {data.agentSuggestions.map((item: AnyRecord) => (
            <a key={item.key} href={item.href} className="crm-suggestion-row">
              <span>{item.title}</span>
              <p>{item.rationale}</p>
              <CrmBadge tone={item.label === "Human approval required" ? "warn" : "info"}>{item.label}</CrmBadge>
            </a>
          ))}
          {data.agentSuggestions.length === 0 && <CrmEmpty text="No agent-safe suggestions yet." />}
        </div>
      </section>

      <section className="crm-panel">
        <CrmPanelHeader title="Active RFQ context" count={data.activeRfqs.length} href="/dashboard/inbox?filter=_RFQ" />
        <div className="crm-list">
          {data.activeRfqs.map((rfq: AnyRecord) => (
            <a key={rfq.id} href={`/dashboard/rfq/${rfq.id}`} className="crm-linked-row">
              <strong>{rfq.subject}</strong>
              <span>{[rfq.company?.name ?? "No company", rfq.origin && rfq.destination ? `${rfq.origin} -> ${rfq.destination}` : null, rfq.mode].filter(Boolean).join(" · ")}</span>
              <CrmStageBadge stage={rfq.status} />
            </a>
          ))}
          {data.activeRfqs.length === 0 && <CrmEmpty text="No active linked RFQs." />}
        </div>
      </section>

      <section className="crm-panel">
        <CrmPanelHeader title="High-priority relationships" count={data.highPriorityCompanies.length} href="/dashboard/crm/companies?priority=high" />
        <CrmCompanyMiniList companies={data.highPriorityCompanies} />
      </section>

      <section className="crm-panel">
        <CrmPanelHeader title="High-leverage people" count={data.highLeverageContacts.length} href="/dashboard/crm/people?priority=high" />
        <div className="crm-list">
          {data.highLeverageContacts.map((contact: AnyRecord) => (
            <a key={contact.id} href={`/dashboard/crm/people/${contact.id}`} className="crm-linked-row">
              <strong>{contact.fullName}</strong>
              <span>{[contact.title, contact.company?.name, contact.email].filter(Boolean).join(" · ")}</span>
              <CrmPriorityBadge priority={contact.leverageLevel} />
            </a>
          ))}
          {data.highLeverageContacts.length === 0 && <CrmEmpty text="No high-leverage contacts tagged yet." />}
        </div>
      </section>

      <section className="crm-panel">
        <CrmPanelHeader title="Open opportunities" count={data.opportunities.length} href="/dashboard/crm/opportunities" />
        <CrmOpportunityRows opportunities={data.opportunities} compact />
      </section>

      <section className="crm-panel">
        <CrmPanelHeader title="Stale relationships" count={data.staleCompanies.length} />
        <CrmCompanyMiniList companies={data.staleCompanies} />
      </section>

      <section className="crm-panel crm-panel-wide">
        <CrmPanelHeader title="Recent activity" count={data.recentActivities.length} />
        <CrmActivityTimeline activities={data.recentActivities} compact />
      </section>
    </div>
  );
}

function CrmPanelHeader({ title, count, href }: { title: string; count?: number; href?: string }) {
  return (
    <div className="crm-panel-header">
      <div>
        <h2>{title}</h2>
        {count !== undefined && <span>{count}</span>}
      </div>
      {href && <a href={href}>Open</a>}
    </div>
  );
}

function CrmEmpty({ text }: { text: string }) {
  return <div className="crm-empty">{text}</div>;
}

function CrmCompanyMiniList({ companies }: { companies: AnyRecord[] }) {
  return (
    <div className="crm-list">
      {companies.map((company) => (
        <a key={company.id} href={`/dashboard/crm/companies/${company.id}`} className="crm-linked-row">
          <strong>{company.name}</strong>
          <span>{[crmLabel(company.crmCategory), ownerText(company.owners), company.tasks?.[0]?.title].filter(Boolean).join(" · ")}</span>
          <div className="crm-row-badges">
            <CrmPriorityBadge priority={company.crmPriority} />
            <CrmStrengthBadge strength={company.relationshipStrength} />
          </div>
        </a>
      ))}
      {companies.length === 0 && <CrmEmpty text="Nothing in this bucket yet." />}
    </div>
  );
}

export function CrmCompanyDirectory({ companies }: { companies: AnyRecord[] }) {
  return (
    <div className="crm-table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Relationship</th>
            <th>Owner</th>
            <th>Next action</th>
            <th>Linked work</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id}>
              <td>
                <a href={`/dashboard/crm/companies/${company.id}`} className="crm-table-title">{company.name}</a>
                <div className="crm-table-sub">{[company.domain, company.product, company.lane].filter(Boolean).join(" · ") || "No domain or lane set"}</div>
              </td>
              <td>
                <div className="crm-row-badges">
                  <CrmBadge tone={sourceTone(company.crmCategory)}>{crmLabel(company.crmCategory)}</CrmBadge>
                  <CrmStageBadge stage={company.crmStage} />
                  <CrmPriorityBadge priority={company.crmPriority} />
                </div>
              </td>
              <td>{ownerText(company.owners)}</td>
              <td>
                <strong>{company.tasks?.[0]?.title ?? company.crmNotes?.slice(0, 70) ?? "No next action"}</strong>
                <div className="crm-table-sub">{company.nextActionAt ? relativeDate(company.nextActionAt) : "No date"}</div>
              </td>
              <td>
                <span>{company.inquiries?.length ?? 0} RFQs</span>
                <span className="crm-table-sub block">{company.crmOpportunities?.length ?? 0} opportunities</span>
              </td>
            </tr>
          ))}
          {companies.length === 0 && (
            <tr><td colSpan={5}><CrmEmpty text="No companies match this view." /></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CrmPeopleDirectory({ contacts }: { contacts: AnyRecord[] }) {
  return (
    <div className="crm-card-grid">
      {contacts.map((contact) => (
        <a key={contact.id} href={`/dashboard/crm/people/${contact.id}`} className="crm-person-card">
          <div className="crm-avatar">{contact.fullName.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{contact.fullName}</strong>
            <span>{[contact.title, contact.company?.name].filter(Boolean).join(" · ") || "No role set"}</span>
            <span>{contact.email ?? "No email"}</span>
          </div>
          <div className="crm-row-badges">
            <CrmBadge tone={sourceTone(contact.relationshipType)}>{crmLabel(contact.relationshipType)}</CrmBadge>
            <CrmPriorityBadge priority={contact.leverageLevel} />
            <CrmStrengthBadge strength={contact.relationshipStrength} />
          </div>
        </a>
      ))}
      {contacts.length === 0 && <CrmEmpty text="No people match this view." />}
    </div>
  );
}

export function CrmOpportunityDirectory({ opportunities }: { opportunities: AnyRecord[] }) {
  const byStage = CRM_OPPORTUNITY_STAGES.map((stage) => ({
    stage,
    rows: opportunities.filter((opportunity) => opportunity.stage === stage),
  })).filter((column) => column.rows.length > 0);
  return (
    <div className="crm-board">
      {(byStage.length ? byStage : [{ stage: "active", rows: [] }]).map((column) => (
        <section key={column.stage} className="crm-board-column">
          <div className="crm-board-header">
            <CrmStageBadge stage={column.stage} />
            <span>{column.rows.length}</span>
          </div>
          <CrmOpportunityRows opportunities={column.rows} />
        </section>
      ))}
      {opportunities.length === 0 && <CrmEmpty text="No opportunities yet." />}
    </div>
  );
}

function CrmOpportunityRows({ opportunities, compact = false }: { opportunities: AnyRecord[]; compact?: boolean }) {
  return (
    <div className={compact ? "crm-list compact" : "crm-list"}>
      {opportunities.map((opportunity) => (
        <a key={opportunity.id} href={`/dashboard/crm/opportunities/${opportunity.id}`} className="crm-opportunity-card">
          <strong>{opportunity.name}</strong>
          <span>{[opportunity.company?.name, opportunity.contact?.fullName, opportunity.inquiry?.subject].filter(Boolean).join(" · ")}</span>
          <div className="crm-row-badges">
            <CrmPriorityBadge priority={opportunity.priority} />
            <CrmStageBadge stage={opportunity.stage} />
            <CrmBadge tone="neutral">{compactMoney(opportunity.estimatedValue, opportunity.currency)}</CrmBadge>
          </div>
          {opportunity.nextAction && <p>{opportunity.nextAction}</p>}
        </a>
      ))}
      {opportunities.length === 0 && <CrmEmpty text="No opportunities in this view." />}
    </div>
  );
}

export function CrmTaskDirectory({ tasks }: { tasks: AnyRecord[] }) {
  return <CrmTaskRows tasks={tasks} />;
}

function CrmTaskRows({ tasks, compact = false }: { tasks: AnyRecord[]; compact?: boolean }) {
  return (
    <div className={compact ? "crm-task-list compact" : "crm-task-list"}>
      {tasks.map((task) => (
        <div key={task.id} className="crm-task-row">
          <form action={completeCrmTaskAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <button type="submit" aria-label="Mark done"><Icon name="check" size={12} /></button>
          </form>
          <div>
            <strong>{task.title}</strong>
            <span>{[task.company?.name, task.contact?.fullName, task.opportunity?.name, task.inquiry?.subject].filter(Boolean).join(" · ") || "Internal CRM task"}</span>
          </div>
          <div className="crm-task-meta">
            <CrmPriorityBadge priority={task.priority} />
            <span>{task.dueAt ? relativeDate(task.dueAt) : "No due date"}</span>
          </div>
        </div>
      ))}
      {tasks.length === 0 && <CrmEmpty text="No open follow-ups here." />}
    </div>
  );
}

export function CrmEntityHeader({
  eyebrow,
  title,
  subtitle,
  badges,
  backHref,
  backLabel,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  badges?: React.ReactNode;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="crm-entity-header">
      <a href={backHref} className="crm-back-link"><Icon name="chevron-left" size={13} /> {backLabel}</a>
      <div className="crm-entity-main">
        <div>
          <span className="crm-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="crm-row-badges">{badges}</div>
      </div>
    </div>
  );
}

export function CrmBrainContextPanel({ context }: { context: CrmBrainContext }) {
  return (
    <section className="crm-panel crm-brain-panel">
      <CrmPanelHeader title="Brain Context" />
      <div className="crm-brain-state">
        <CrmBadge tone={context.sourceState === "linked" ? "good" : context.sourceState === "partial" ? "warn" : "danger"}>
          {crmLabel(context.sourceState)}
        </CrmBadge>
        <p>{context.summary}</p>
      </div>
      <div className="crm-brain-block">
        <h3>Known facts</h3>
        {context.facts.length ? context.facts.map((fact, idx) => (
          <div key={`${fact.sourceType}-${idx}`} className="crm-fact-row">
            <strong>{fact.claim}</strong>
            <span>{[fact.sourceType, fact.sourceTitle, fact.occurredAt ? fmtDate(fact.occurredAt) : null].filter(Boolean).join(" · ")}</span>
          </div>
        )) : <CrmEmpty text="No source-linked facts retrieved yet." />}
      </div>
      <div className="crm-brain-block">
        <h3>Sources</h3>
        {context.sourceRefs.length ? context.sourceRefs.map((ref) => (
          <div key={`${ref.label}-${ref.value}`} className="crm-source-row">
            <span>{ref.label}</span>
            <strong>{ref.value}</strong>
          </div>
        )) : <CrmEmpty text="No explicit source refs on this entity." />}
      </div>
      <div className="crm-brain-block">
        <h3>Gaps and gate</h3>
        <ul>
          {context.gaps.map((gap) => <li key={gap}>{gap}</li>)}
          {context.gaps.length === 0 && <li>No obvious CRM context gaps.</li>}
        </ul>
        <p><strong>Next:</strong> {context.suggestedNextAction}</p>
        <p><strong>Gate:</strong> {context.approvalGate}</p>
      </div>
    </section>
  );
}

export function CrmActivityTimeline({ activities, compact = false }: { activities: AnyRecord[]; compact?: boolean }) {
  return (
    <div className={compact ? "crm-timeline compact" : "crm-timeline"}>
      {activities.map((activity) => (
        <div key={activity.id} className="crm-timeline-item">
          <span className="crm-timeline-dot" />
          <div>
            <strong>{activity.subject ?? crmLabel(activity.type)}</strong>
            <p>{activity.body ?? [activity.company?.name, activity.contact?.fullName, activity.opportunity?.name].filter(Boolean).join(" · ")}</p>
            <span>{[crmLabel(activity.type), activity.source ? crmLabel(activity.source) : null, fmtDate(activity.occurredAt)].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
      ))}
      {activities.length === 0 && <CrmEmpty text="No timeline yet." />}
    </div>
  );
}

export function CrmCompanyDetailForms({ company }: { company: AnyRecord }) {
  return (
    <div className="crm-form-stack">
      <details className="crm-create-panel">
        <summary>Edit relationship profile</summary>
        <form action={updateCrmCompanyAction} className="crm-form-grid">
          <input type="hidden" name="companyId" value={company.id} />
          <label>Domain<input name="domain" defaultValue={company.domain ?? ""} /></label>
          <label>Website<input name="website" defaultValue={company.website ?? ""} /></label>
          <label>LinkedIn<input name="linkedinUrl" defaultValue={company.linkedinUrl ?? ""} /></label>
          <label>Category<select name="crmCategory" defaultValue={company.crmCategory}>{CRM_COMPANY_CATEGORIES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
          <label>Stage<select name="crmStage" defaultValue={company.crmStage}>{CRM_COMPANY_STAGES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
          <label>Priority<select name="crmPriority" defaultValue={company.crmPriority}>{CRM_PRIORITIES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
          <label>Strength<select name="relationshipStrength" defaultValue={company.relationshipStrength}>{CRM_RELATIONSHIP_STRENGTHS.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
          <label>Source<input name="crmSource" defaultValue={company.crmSource ?? "manual"} /></label>
          <label>Next action date<input name="nextActionAt" type="date" defaultValue={dateInputValue(company.nextActionAt)} /></label>
          <label className="crm-form-wide">Tags<input name="tags" defaultValue={Array.isArray(company.crmTags) ? company.crmTags.join(", ") : ""} /></label>
          <label className="crm-form-wide">Notes<textarea name="crmNotes" defaultValue={company.crmNotes ?? ""} /></label>
          <button type="submit">Save profile</button>
        </form>
      </details>
      <CrmContactForm company={company} />
      <CrmOpportunityForm company={company} />
      <CrmTaskForm company={company} />
      <CrmNoteForm company={company} />
    </div>
  );
}

export function CrmContactForm({ company }: { company: AnyRecord }) {
  return (
    <details className="crm-create-panel">
      <summary>Add contact</summary>
      <form action={createCrmContactAction} className="crm-form-grid">
        <input type="hidden" name="companyId" value={company.id} />
        <label>Name<input name="fullName" required /></label>
        <label>Title<input name="title" /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Phone<input name="phone" /></label>
        <label>Type<select name="relationshipType" defaultValue="buyer">{CRM_CONTACT_TYPES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Leverage<select name="leverageLevel" defaultValue="medium">{CRM_LEVERAGE_LEVELS.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Strength<select name="relationshipStrength" defaultValue="unknown">{CRM_RELATIONSHIP_STRENGTHS.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Next action<input name="nextActionAt" type="date" /></label>
        <label className="crm-form-wide">Notes<textarea name="notes" /></label>
        <button type="submit">Add contact</button>
      </form>
    </details>
  );
}

export function CrmOpportunityForm({ company, contact, inquiryId }: { company: AnyRecord; contact?: AnyRecord | null; inquiryId?: string | null }) {
  return (
    <details className="crm-create-panel">
      <summary>Create opportunity</summary>
      <form action={createCrmOpportunityAction} className="crm-form-grid">
        <input type="hidden" name="companyId" value={company.id} />
        {contact && <input type="hidden" name="contactId" value={contact.id} />}
        {inquiryId && <input type="hidden" name="inquiryId" value={inquiryId} />}
        <label>Name<input name="name" required placeholder="What could happen?" /></label>
        <label>Type<select name="type" defaultValue={inquiryId ? "rfq_related" : "customer_lead"}>{CRM_OPPORTUNITY_TYPES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Stage<select name="stage" defaultValue="idea">{CRM_OPPORTUNITY_STAGES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Priority<select name="priority" defaultValue="medium">{CRM_PRIORITIES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label>Estimated value<input name="estimatedValue" inputMode="decimal" /></label>
        <label>Currency<input name="currency" defaultValue="USD" /></label>
        <label>Likelihood %<input name="likelihood" inputMode="numeric" /></label>
        <label>Next action date<input name="nextActionAt" type="date" /></label>
        <label className="crm-form-wide">Next action<input name="nextAction" /></label>
        <label className="crm-form-wide">Notes<textarea name="notes" /></label>
        <button type="submit">Create opportunity</button>
      </form>
    </details>
  );
}

export function CrmTaskForm({ company, contact, opportunity, inquiryId }: { company: AnyRecord; contact?: AnyRecord | null; opportunity?: AnyRecord | null; inquiryId?: string | null }) {
  return (
    <details className="crm-create-panel">
      <summary>Create follow-up</summary>
      <form action={createCrmTaskAction} className="crm-form-grid">
        <input type="hidden" name="companyId" value={company.id} />
        {contact && <input type="hidden" name="contactId" value={contact.id} />}
        {opportunity && <input type="hidden" name="opportunityId" value={opportunity.id} />}
        {inquiryId && <input type="hidden" name="inquiryId" value={inquiryId} />}
        <label className="crm-form-wide">Title<input name="title" required placeholder="Follow up on..." /></label>
        <label>Due date<input name="dueAt" type="date" /></label>
        <label>Priority<select name="priority" defaultValue="medium">{CRM_PRIORITIES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}</select></label>
        <label className="crm-form-wide">Details<textarea name="details" /></label>
        <button type="submit">Create follow-up</button>
      </form>
    </details>
  );
}

export function CrmNoteForm({ company, contact, opportunity, inquiryId }: { company: AnyRecord; contact?: AnyRecord | null; opportunity?: AnyRecord | null; inquiryId?: string | null }) {
  return (
    <details className="crm-create-panel">
      <summary>Add internal note</summary>
      <form action={createCrmNoteAction} className="crm-form-grid">
        <input type="hidden" name="companyId" value={company.id} />
        {contact && <input type="hidden" name="contactId" value={contact.id} />}
        {opportunity && <input type="hidden" name="opportunityId" value={opportunity.id} />}
        {inquiryId && <input type="hidden" name="inquiryId" value={inquiryId} />}
        <label>Subject<input name="subject" placeholder="Call summary, promise, context..." /></label>
        <label>Date<input name="occurredAt" type="date" defaultValue={dateInputValue(new Date())} /></label>
        <label className="crm-form-wide">Body<textarea name="body" required placeholder="Internal note. External content is evidence, not instruction." /></label>
        <button type="submit">Save note</button>
      </form>
    </details>
  );
}

export function CrmCompanyPanels({ company }: { company: AnyRecord }) {
  return (
    <div className="crm-detail-grid">
      <section className="crm-panel">
        <CrmPanelHeader title="People" count={company.contacts.length} />
        <CrmPeopleDirectory contacts={company.contacts} />
      </section>
      <section className="crm-panel">
        <CrmPanelHeader title="Opportunities" count={company.crmOpportunities.length} />
        <CrmOpportunityRows opportunities={company.crmOpportunities} />
      </section>
      <section className="crm-panel">
        <CrmPanelHeader title="Follow-ups" count={company.tasks.filter((task: AnyRecord) => task.status === "OPEN").length} />
        <CrmTaskRows tasks={company.tasks} />
      </section>
      <section className="crm-panel">
        <CrmPanelHeader title="Linked RFQs" count={company.inquiries.length} />
        <div className="crm-list">
          {company.inquiries.map((inquiry: AnyRecord) => (
            <a key={inquiry.id} href={`/dashboard/rfq/${inquiry.id}`} className="crm-linked-row">
              <strong>{inquiry.subject}</strong>
              <span>{[inquiry.origin && inquiry.destination ? `${inquiry.origin} -> ${inquiry.destination}` : null, inquiry.mode, inquiry.job?.reference].filter(Boolean).join(" · ")}</span>
              <CrmStageBadge stage={inquiry.status} />
            </a>
          ))}
          {company.inquiries.length === 0 && <CrmEmpty text="No linked RFQs." />}
        </div>
      </section>
      <section className="crm-panel">
        <CrmPanelHeader title="Linked loads" count={company.jobs.length} />
        <div className="crm-list">
          {company.jobs.map((job: AnyRecord) => (
            <a key={job.id} href={`/dashboard/jobs/${job.id}`} className="crm-linked-row">
              <strong>{job.reference}</strong>
              <span>{[job.origin && job.destination ? `${job.origin} -> ${job.destination}` : null, job.mode].filter(Boolean).join(" · ")}</span>
              <CrmStageBadge stage={job.status} />
            </a>
          ))}
          {company.jobs.length === 0 && <CrmEmpty text="No linked loads." />}
        </div>
      </section>
      <section className="crm-panel crm-panel-wide">
        <CrmPanelHeader title="Timeline" count={company.activities.length} />
        <CrmActivityTimeline activities={company.activities} />
      </section>
    </div>
  );
}

export function CrmOpportunityStageForm({ opportunity }: { opportunity: AnyRecord }) {
  return (
    <form action={updateCrmOpportunityStageAction} className="crm-stage-form">
      <input type="hidden" name="opportunityId" value={opportunity.id} />
      <select name="stage" defaultValue={opportunity.stage}>
        {CRM_OPPORTUNITY_STAGES.map((item) => <option key={item} value={item}>{crmLabel(item)}</option>)}
      </select>
      <button type="submit">Update stage</button>
    </form>
  );
}
