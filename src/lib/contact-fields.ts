// Shared vocabulary for the CRM contact sheet (client + server safe, no runtime deps).

export const CONTACT_TYPES = [
  ["customer", "Customer"],
  ["potential_customer", "Potential customer"],
  ["potential_partner", "Potential partner"],
  ["forwarder", "Forwarder"],
  ["logistics_contact", "Logistics contact"],
  ["high_value", "High value"],
  ["other", "Other"],
] as const;

export const CONTACT_STATUSES = [
  ["not_contacted", "Not contacted"],
  ["contacted", "Contacted"],
  ["in_talks", "In talks"],
  ["active", "Active"],
  ["cold", "Cold"],
] as const;

export const RELATIONSHIP_LEVELS = [
  ["unknown", "Unknown"],
  ["weak", "Weak"],
  ["warm", "Warm"],
  ["strong", "Strong"],
  ["trusted", "Trusted"],
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number][0];
export type ContactStatus = (typeof CONTACT_STATUSES)[number][0];
export type RelationshipLevel = (typeof RELATIONSHIP_LEVELS)[number][0];

export const CONTACT_TYPE_VALUES = CONTACT_TYPES.map(([value]) => value);
export const CONTACT_STATUS_VALUES = CONTACT_STATUSES.map(([value]) => value);
export const RELATIONSHIP_LEVEL_VALUES = RELATIONSHIP_LEVELS.map(([value]) => value);

export function contactTypeLabel(value: string | null): string {
  return CONTACT_TYPES.find(([v]) => v === value)?.[1] ?? "";
}

// One row of the contact sheet, serialized for the client (dates as ISO strings).
export type ContactRow = {
  id: string;
  name: string;
  companyId: string;
  company: string;
  type: string | null;
  status: string | null;
  relationship: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  lastTouchAt: string | null;
};

// The Prisma selection the sheet reads (kept in sync with ROW_SELECT in the CRM actions).
export type ContactRecord = {
  id: string;
  fullName: string;
  companyId: string;
  category: string | null;
  status: string | null;
  relationshipStrength: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  lastTouchAt: Date | null;
  company: { name: string };
};

export function toContactRow(contact: ContactRecord): ContactRow {
  return {
    id: contact.id,
    name: contact.fullName,
    companyId: contact.companyId,
    company: contact.company.name,
    type: contact.category,
    status: contact.status,
    relationship: contact.relationshipStrength,
    email: contact.email,
    phone: contact.phone,
    location: contact.location,
    notes: contact.notes,
    lastTouchAt: contact.lastTouchAt ? contact.lastTouchAt.toISOString() : null,
  };
}
