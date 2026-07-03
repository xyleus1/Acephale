import {
  CrmBadge,
  CrmPageHeader,
  CrmTabs,
} from "@/components/crm/crm-components";
import { getCrmCommandCenter } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";

export default async function CrmRelationshipsPage() {
  const scope = await getCrmScope();
  const data = await getCrmCommandCenter(scope);
  const rows = [
    ...data.highPriorityCompanies.map((company) => ({
      key: `company:${company.id}`,
      title: company.name,
      subtitle: [company.crmCategory, company.crmStage, company.relationshipStrength].join(" · "),
      href: `/dashboard/crm/companies/${company.id}`,
      label: company.crmPriority,
    })),
    ...data.highLeverageContacts.map((contact) => ({
      key: `contact:${contact.id}`,
      title: contact.fullName,
      subtitle: [contact.title, contact.company?.name, contact.relationshipStrength].filter(Boolean).join(" · "),
      href: `/dashboard/crm/people/${contact.id}`,
      label: contact.leverageLevel,
    })),
  ];

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="Relationships"
        subtitle="The people and accounts worth deliberate attention, not every row in the database."
      />
      <CrmTabs />
      <div className="crm-card-grid">
        {rows.map((row) => (
          <a key={row.key} href={row.href} className="crm-person-card">
            <div>
              <strong>{row.title}</strong>
              <span>{row.subtitle}</span>
            </div>
            <CrmBadge tone={row.label === "critical" || row.label === "very_high" ? "danger" : "info"}>{row.label}</CrmBadge>
          </a>
        ))}
        {rows.length === 0 && (
          <div className="crm-empty">No high-priority relationships tagged yet.</div>
        )}
      </div>
    </div>
  );
}
