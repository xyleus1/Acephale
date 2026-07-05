// Derives where an Inquiry came from, using only row-level markers plus the
// linked email thread's receiving account. There is no `source` column on
// Inquiry, so this maps each creation path's fingerprint:
//   - google-sheets-sync writes parsedData {source: "google-sheet", rowNumber}
//   - thread-actions writes parsedData {source: "thread"} and links the thread
//   - WhatsApp threads resolve to an EmailAccount with provider WHATSAPP
//   - the manual form / pricing form / agent paste leave no source marker

export type InquirySourceThread = {
  messages: Array<{ account: { email: string; provider: string } | null }>;
};

export type InquirySourceInput = {
  parsedData: string | null;
  rawEmailBody: string | null;
  fromEmail: string | null;
  emailThreads?: InquirySourceThread[];
};

export type InquirySourceInfo = {
  kind: "sheet" | "whatsapp" | "email" | "manual";
  label: string;
  detail: string | null;
};

export function deriveInquirySource(inq: InquirySourceInput): InquirySourceInfo {
  let parsed: Record<string, unknown> = {};
  if (inq.parsedData) {
    try {
      const value = JSON.parse(inq.parsedData);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
    } catch {
      // Legacy rows can hold non-JSON parsedData; treat as unmarked.
    }
  }

  if (parsed.source === "google-sheet") {
    const row = typeof parsed.rowNumber === "number" ? `row ${parsed.rowNumber}` : null;
    const tab = typeof parsed.tab === "string" ? parsed.tab : null;
    return { kind: "sheet", label: "Google Sheet", detail: [tab, row].filter(Boolean).join(" · ") || null };
  }

  const account = inq.emailThreads?.[0]?.messages?.[0]?.account ?? null;
  if (account?.provider === "WHATSAPP") {
    return { kind: "whatsapp", label: "WhatsApp", detail: account.email };
  }
  if (account) {
    return { kind: "email", label: "Email", detail: account.email };
  }
  if (parsed.source === "thread") {
    return { kind: "email", label: "Email", detail: inq.fromEmail };
  }

  return {
    kind: "manual",
    label: "Manual",
    detail: inq.rawEmailBody && !("qualification" in parsed) ? "pasted" : null,
  };
}
