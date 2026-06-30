export const LOAD_RFQ_RELATED_CLASSIFICATIONS = [
  "RFQ",
  "CARRIER_REPLY",
  "CUSTOMER_REPLY",
  "RELATED_NOTE",
] as const;

export type LoadRfqRelatedClassification = typeof LOAD_RFQ_RELATED_CLASSIFICATIONS[number];

export type EmailWorkflowLabelKey =
  | "load_rfq"
  | "load_customer"
  | "load_forwarder"
  | "load_note"
  | "load_related"
  | "load_linked"
  | "mail_other"
  | "mail_unclassified";

export type EmailWorkflowLabel = {
  key: EmailWorkflowLabelKey;
  label: string;
  className: string;
  description: string;
};

export const EMAIL_WORKFLOW_LABELS: Record<EmailWorkflowLabelKey, EmailWorkflowLabel> = {
  load_rfq: {
    key: "load_rfq",
    label: "load/rfq",
    className: "workflow-rfq",
    description: "New freight request or thread attached to an RFQ.",
  },
  load_customer: {
    key: "load_customer",
    label: "load/customer",
    className: "workflow-customer",
    description: "Customer reply on an active load or quote.",
  },
  load_forwarder: {
    key: "load_forwarder",
    label: "load/forwarder",
    className: "workflow-forwarder",
    description: "Carrier or forwarder rate/update tied to a load/RFQ.",
  },
  load_note: {
    key: "load_note",
    label: "load/note",
    className: "workflow-note",
    description: "Related operational note for a known load/RFQ.",
  },
  load_related: {
    key: "load_related",
    label: "load/related",
    className: "workflow-related",
    description: "Mail that belongs in the load/RFQ workflow.",
  },
  load_linked: {
    key: "load_linked",
    label: "load/linked",
    className: "workflow-linked",
    description: "Thread is already linked to a load even if the latest message is generic.",
  },
  mail_other: {
    key: "mail_other",
    label: "mail/other",
    className: "workflow-other",
    description: "Mail that is not currently part of the load/RFQ workflow.",
  },
  mail_unclassified: {
    key: "mail_unclassified",
    label: "mail/unclassified",
    className: "workflow-unclassified",
    description: "Mail waiting for classifier review.",
  },
};

export function isLoadRfqRelatedClassification(kind: string | null | undefined): boolean {
  return LOAD_RFQ_RELATED_CLASSIFICATIONS.includes(kind as LoadRfqRelatedClassification);
}

export function isLoadRfqRelatedThread(args: {
  jobId?: string | null;
  inquiryId?: string | null;
  classifications?: Array<string | null | undefined>;
}): boolean {
  if (args.jobId || args.inquiryId) return true;
  return (args.classifications ?? []).some(isLoadRfqRelatedClassification);
}

export function primaryEmailWorkflowLabel(args: {
  kind?: string | null;
  jobId?: string | null;
  inquiryId?: string | null;
}): EmailWorkflowLabel {
  const kind = args.kind ?? null;
  if (kind === "RFQ" || args.inquiryId) return EMAIL_WORKFLOW_LABELS.load_rfq;
  if (kind === "CARRIER_REPLY") return EMAIL_WORKFLOW_LABELS.load_forwarder;
  if (kind === "CUSTOMER_REPLY") return EMAIL_WORKFLOW_LABELS.load_customer;
  if (kind === "RELATED_NOTE") return EMAIL_WORKFLOW_LABELS.load_note;
  if (args.jobId) return EMAIL_WORKFLOW_LABELS.load_linked;
  if (!kind) return EMAIL_WORKFLOW_LABELS.mail_unclassified;
  if (kind === "UNCLASSIFIED") return EMAIL_WORKFLOW_LABELS.mail_unclassified;
  return EMAIL_WORKFLOW_LABELS.mail_other;
}

export function emailWorkflowLabelKeys(args: {
  kind?: string | null;
  jobId?: string | null;
  inquiryId?: string | null;
}): EmailWorkflowLabelKey[] {
  const labels = new Set<EmailWorkflowLabelKey>();
  labels.add(primaryEmailWorkflowLabel(args).key);
  if (args.jobId || args.inquiryId || isLoadRfqRelatedClassification(args.kind)) {
    labels.add("load_related");
  }
  return [...labels];
}
