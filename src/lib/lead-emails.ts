// Customer-facing lead email copy, in the lead's market language. One smart
// email per lead: if the lead form already gave everything the desk needs,
// it's a confirmation ("received, being processed"); if details are missing,
// it asks for exactly the same things the WhatsApp draft would — one source
// of truth for "what is missing" (leadMissingQuestions). Pure module (no
// server-only import) so the copy is unit-testable; rfq-mail wraps it with
// the SMTP config.

import {
  leadFirstName,
  leadMissingQuestions,
  type InquiryForWhatsApp,
} from "./rfq-whatsapp";

export type LeadCustomerEmailKind = "confirmation" | "info-request";

export type LeadCustomerEmailContent = {
  kind: LeadCustomerEmailKind;
  subject: string;
  text: string;
  // English labels of what the info-request asks for (empty for confirmations).
  missing: string[];
};

const SIGNATURE_TR = `—
Oğuzhan Karaca
Kurucu Ortak & CEO, Derya
https://usederya.com/`;
const SIGNATURE_US = `—
Oğuzhan Karaca
Co-founder & CEO, Derya
https://usederya.com/`;

const CONFIRMATION_SUBJECT_TR = "Talebiniz alındı — Derya";
const CONFIRMATION_BODY_TR = `Talebiniz Derya fiyatlandırma ekibi tarafından alınmıştır. Bilgileriniz doğru ve eksiksizse talebiniz önümüzdeki 6 saat içinde işleme alınacaktır. Ekibimiz ek detaylar için sizinle iletişime geçebilir.
${SIGNATURE_TR}`;
const CONFIRMATION_SUBJECT_US = "Your request has been received — Derya";
const CONFIRMATION_BODY_US = `Your request has been received by the Derya pricing team. If your details are correct and complete, your request will be processed within the next 6 hours. Our team may reach out for additional details.
${SIGNATURE_US}`;

const INFO_SUBJECT_TR = "Fiyat teklifiniz için birkaç bilgi rica ederiz — Derya";
const INFO_SUBJECT_US = "A few details for your shipping quote — Derya";

function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parsedOf(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function buildLeadCustomerEmailContent(inq: InquiryForWhatsApp): LeadCustomerEmailContent {
  const { market, questions, missing } = leadMissingQuestions(inq);
  const en = market === "US";

  if (questions.length === 0) {
    return {
      kind: "confirmation",
      subject: en ? CONFIRMATION_SUBJECT_US : CONFIRMATION_SUBJECT_TR,
      text: en ? CONFIRMATION_BODY_US : CONFIRMATION_BODY_TR,
      missing: [],
    };
  }

  const parsed = parsedOf(inq.parsedData);
  const firstName = leadFirstName(s(parsed.fullName), market);
  const commodity = s(inq.commodity);
  const lane = [s(inq.origin), s(inq.destination)].filter(Boolean).join(" → ");
  const aboutEn = commodity
    ? ` about your ${commodity} shipment${lane ? ` (${lane})` : ""}`
    : lane ? ` for ${lane}` : "";

  const bullets = questions.map((q) => `- ${q}`).join("\n");

  const text = en
    ? `Hi${firstName ? ` ${firstName}` : ""},

Thanks for your shipping request${aboutEn}. To prepare an accurate quote, could you share:

${bullets}

Just reply to this email with the details and our pricing team will get your quote moving right away.
${SIGNATURE_US}`
    : `Merhaba,

Talebiniz için teşekkürler. Doğru bir fiyat çalışabilmemiz için birkaç bilgiye ihtiyacımız var:

${bullets}

Bu e-postayı yanıtlamanız yeterli — ekibimiz fiyat çalışmasına hemen başlayacaktır.
${SIGNATURE_TR}`;

  return {
    kind: "info-request",
    subject: en ? INFO_SUBJECT_US : INFO_SUBJECT_TR,
    text,
    missing,
  };
}
