// Shared vocabulary for the CRM contact sheet. This module is client safe.

export const CONTACT_STATUSES = [
  ["not_contacted", "Not contacted"],
  ["queued", "Queued"],
  ["reached_out", "Reached out"],
  ["replied", "Replied"],
  ["follow_up", "Follow up"],
  ["active", "Active relationship"],
  ["not_a_fit", "Not a fit"],
] as const;

export const CONTACT_IMPORTANCE_LEVELS = [
  ["critical", "Must do"],
  ["high", "High"],
  ["medium", "Normal"],
  ["low", "Low"],
] as const;

export const CONTACT_CATEGORIES = [
  ["personally_important", "Personally important"],
  ["startup", "Startups"],
  ["forwarder", "Forwarders"],
  ["other", "Other"],
] as const;

export const CONTACT_CONTEXTS = [
  ["batchmate", "Batchmate"],
  ["personal_contact", "Know personally"],
  ["industry_advisor", "Industry advisor"],
  ["yc_contact", "YC contact"],
  ["founder", "Founder"],
  ["investor", "Investor"],
  ["connector", "Connector"],
  ["buyer", "Buyer"],
  ["other", "Other"],
] as const;

export const OUTREACH_CHANNEL_OPTIONS = [
  ["bookface", "Bookface"],
  ["linkedin", "LinkedIn"],
  ["email", "Email"],
] as const;

// Forwarders are deliberately data-only for now. They stay in the CRM but do
// not enter the automatic weekly outreach pool.
export const OUTREACH_ELIGIBLE_CATEGORY_VALUES = [
  "personally_important",
  "startup",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number][0];
export type ContactImportance = (typeof CONTACT_IMPORTANCE_LEVELS)[number][0];
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number][0];
export type ContactContext = (typeof CONTACT_CONTEXTS)[number][0];
export type OutreachChannel = (typeof OUTREACH_CHANNEL_OPTIONS)[number][0];

export const CONTACT_STATUS_VALUES = CONTACT_STATUSES.map(([value]) => value);
export const CONTACT_IMPORTANCE_VALUES = CONTACT_IMPORTANCE_LEVELS.map(([value]) => value);
export const CONTACT_CATEGORY_VALUES = CONTACT_CATEGORIES.map(([value]) => value);
export const CONTACT_CONTEXT_VALUES = CONTACT_CONTEXTS.map(([value]) => value);
export const OUTREACH_CHANNEL_VALUES = OUTREACH_CHANNEL_OPTIONS.map(([value]) => value);

export function contactCategoryLabel(value: string | null): string {
  return CONTACT_CATEGORIES.find(([candidate]) => candidate === value)?.[1] ?? value ?? "";
}

export function contactImportanceRank(value: string | null): number {
  const rank = CONTACT_IMPORTANCE_VALUES.indexOf(value as ContactImportance);
  return rank === -1 ? CONTACT_IMPORTANCE_VALUES.indexOf("medium") : rank;
}

// One row of the contact sheet, serialized for the client.
export type ContactRow = {
  id: string;
  name: string;
  companyId: string;
  company: string;
  status: string | null;
  importance: string;
  category: string | null;
  context: string;
  title: string | null;
  outreachChannel: string | null;
  email: string | null;
  linkedinUrl: string | null;
  bookfaceUrl: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  lastTouchAt: string | null;
};

// The Prisma selection the sheet reads. Keep this in sync with ROW_SELECT in
// the CRM actions.
export type ContactRecord = {
  id: string;
  fullName: string;
  companyId: string;
  status: string | null;
  importance: string;
  category: string | null;
  relationshipType: string;
  title: string | null;
  outreachChannel: string | null;
  email: string | null;
  linkedinUrl: string | null;
  bookfaceUrl: string | null;
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
    status: contact.status,
    importance: contact.importance,
    category: contact.category,
    context: contact.relationshipType,
    title: contact.title,
    outreachChannel: contact.outreachChannel,
    email: contact.email,
    linkedinUrl: contact.linkedinUrl,
    bookfaceUrl: contact.bookfaceUrl,
    phone: contact.phone,
    location: contact.location,
    notes: contact.notes,
    lastTouchAt: contact.lastTouchAt ? contact.lastTouchAt.toISOString() : null,
  };
}
