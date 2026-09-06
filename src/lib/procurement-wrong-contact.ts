import { registrableDomain } from "@/lib/leadgen/extract";
import { BULK_RFQ_VENDOR_EMAIL_SQL, BULK_RFQ_VENDOR_RETIRED_EMAILS_SQL } from "@/lib/procurement-bulk-rfq";
import { supplierReplyText } from "@/lib/procurement-inbound-triage";
import { procurementWorkflowDatabase } from "@/lib/procurement-workflow";

// A supplier answering "wrong contact, write to somebody else" used to end the
// thread: the loop escalated it once and the shop sat there, neither pursued nor
// removed, until somebody read the mailbox. That is a leak, because the reply is
// itself the recovery: the shop is real, it read the RFQ, and the address it
// names (or another address on its own domain) is where the RFQ belongs.
//
// So a wrong contact is worked rather than reported: the request moves to
// another address at the same supplier and mails the RFQ there, and when the
// supplier offers nothing to move to, the row is faded out of the funnel with
// the reason recorded, so the request is not held open by a shop that told us to
// stop writing to it.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Addresses that are never a quoting contact, whatever a reply says.
const UNQUOTABLE = /^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|abuse|unsubscribe|bounce|webmaster)@/i;

// A mailbox a request for quotation belongs in, best first. A named colleague
// still counts, so this only orders candidates and never drops one.
const QUOTING_INBOX = ["rfq", "quote", "sales", "inquiry", "enquiry", "info", "contact", "office"];

function inboxRank(email: string) {
  const local = email.split("@").at(0)?.toLowerCase() ?? "";
  const index = QUOTING_INBOX.findIndex((role) => local.includes(role));
  return index === -1 ? QUOTING_INBOX.length : index;
}

function sameSupplier(email: string, domains: ReadonlySet<string>) {
  const domain = registrableDomain(email.split("@").at(1) ?? "");
  return domain !== "" && domains.has(domain);
}

// Which addresses a wrong contact reply leaves the request to try. Only the
// supplier's own domains count: a reply naming a customer, a freight forwarder
// or a personal address would otherwise send the RFQ to a stranger. Addresses
// the request already mailed are left out, since writing to them again is what
// produced this reply.
export function wrongContactReplacements(args: {
  body: string;
  // Where the RFQ went, and any address that already told us it is wrong.
  mailedEmails: readonly string[];
  // Addresses the supplier row already holds from sourcing, tried after the
  // ones the supplier itself named.
  alternateEmails?: readonly string[];
  // The supplier's website and known addresses, which is what makes a named
  // address the supplier's own.
  supplierDomains: readonly string[];
}): string[] {
  const domains = new Set(
    args.supplierDomains
      .map((value) => registrableDomain(value.includes("@") ? value.split("@").at(1) ?? "" : value))
      .filter((domain) => domain !== ""),
  );
  const mailed = new Set(args.mailedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  // Only what this reply itself wrote. A forwarded or quoted wrong contact
  // carries the mail it was forwarded from, and the addresses in that history
  // belong to whoever wrote it rather than to the desk the RFQ is being sent to,
  // so reading them as referrals could walk the request back to a colleague the
  // shop has already moved it away from.
  const named = (supplierReplyText(args.body).match(EMAIL) ?? [])
    .map((email) => email.trim().toLowerCase());
  const stored = (args.alternateEmails ?? []).map((email) => email.trim().toLowerCase());
  const candidates: string[] = [];
  for (const group of [named, stored]) {
    const ranked = [...new Set(group)]
      .filter((email) => !mailed.has(email)
        && !UNQUOTABLE.test(email)
        && sameSupplier(email, domains))
      .sort((left, right) => inboxRank(left) - inboxRank(right));
    for (const email of ranked) {
      if (!candidates.includes(email)) candidates.push(email);
    }
  }
  return candidates;
}

export type WrongContactRecoveryPlan =
  | { kind: "REPLACE_CONTACT"; email: string; reason: string }
  | { kind: "FADE"; reason: string };

// Deterministic, so what the loop does with a wrong contact is decided here and
// is the same for the pass, the report and the tests.
export function planWrongContactRecovery(candidates: readonly string[]): WrongContactRecoveryPlan {
  const email = candidates.at(0);
  return email
    ? {
      kind: "REPLACE_CONTACT",
      email,
      reason: `The supplier named another address, so the RFQ goes to ${email}.`,
    }
    : {
      kind: "FADE",
      reason: "The supplier says this is the wrong contact and offers no other address, so it leaves the funnel.",
    };
}

// A faded supplier keeps its row and its thread, and only its status changes to
// one the loop already treats as outreach that is over, so nothing is deleted
// and an operator can put the shop back by changing the status again.
export const WRONG_CONTACT_FADED_STATUS = "excluded";

// The status that puts a supplier back in front of the RFQ send, which is what
// mails the replacement address.
const WRONG_CONTACT_RESOURCED_STATUS = "researched";

export type WrongContactRecoveryOutcome = {
  vendorId: string;
  vendorName: string;
  // ALREADY_HANDLED is the recovery of this same reply, done by an earlier
  // pass. Without it every pass would move the supplier to yet another address,
  // since the reply naming the wrong contact stays the newest one on the thread.
  state: "RESOURCED" | "FADED" | "ALREADY_HANDLED" | "FAILED";
  // Where the supplier stands after this reply, whichever pass got there, so a
  // caller reads one answer instead of joining a state to a history.
  resolved: "RESOURCED" | "FADED" | "FAILED";
  email?: string | null;
  reason: string;
  error?: string | null;
};

type WrongContactVendorRow = {
  website: string | null;
  contactEmail: string | null;
  alternateEmails: string[] | null;
  // Every address an earlier recovery already retired, so a supplier that turns
  // us away twice does not get written to at an address it already rejected.
  retiredEmails: string[] | null;
  // The reply an earlier pass already recovered from, if any.
  handledMessageId: string | null;
  handledState: string | null;
};

async function wrongContactVendorRow(orderId: string, vendorId: string) {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<WrongContactVendorRow[]>(`
    SELECT
      order_vendors.website AS "website",
      ${BULK_RFQ_VENDOR_EMAIL_SQL} AS "contactEmail",
      CASE
        WHEN jsonb_typeof(to_jsonb(order_vendors)->'research'->'alternateEmails') = 'array'
          THEN ARRAY(
            SELECT jsonb_array_elements_text(to_jsonb(order_vendors)->'research'->'alternateEmails')
          )
        ELSE NULL
      END AS "alternateEmails",
      ${BULK_RFQ_VENDOR_RETIRED_EMAILS_SQL} AS "retiredEmails",
      to_jsonb(order_vendors)->'research'->'wrongContact'->>'sourceMessageId' AS "handledMessageId",
      to_jsonb(order_vendors)->'research'->'wrongContact'->>'state' AS "handledState"
    FROM order_vendors
    WHERE order_vendors.order_id = $1::uuid AND order_vendors.id = $2::uuid
  `, orderId, vendorId);
  return rows.at(0) ?? null;
}

// Recording what happened on the row itself, so a later pass, an operator and
// the report all read the same history instead of inferring it from a status.
async function noteWrongContact(args: {
  orderId: string;
  vendorId: string;
  status: string;
  // The address the supplier was moved to, or null to retire the address that
  // turned us away, which is what fading does. The retired address stays on the
  // row in `research.wrongContact.retired`, so the history is still readable and
  // the recorded send keeps it from ever being mailed again.
  contactEmail: string | null;
  // The RFQ send only picks up suppliers it has not mailed yet, so a
  // replacement address is mailed only once the send receipt of the address
  // that turned us away is cleared off the row.
  reopenOutreach: boolean;
  note: Record<string, unknown>;
}) {
  const updated = await procurementWorkflowDatabase().$executeRawUnsafe(
    `
      UPDATE order_vendors
      SET status = $3,
          contact_email = $4,
          last_email_message_id = CASE WHEN $6 THEN NULL ELSE last_email_message_id END,
          email_thread_id = CASE WHEN $6 THEN NULL ELSE email_thread_id END,
          research = COALESCE(
            CASE WHEN jsonb_typeof(to_jsonb(order_vendors)->'research') = 'object'
              THEN to_jsonb(order_vendors)->'research'
              ELSE '{}'::jsonb
            END,
            '{}'::jsonb
          ) || jsonb_build_object('wrongContact', $5::jsonb),
          updated_at = now()
      WHERE order_id = $1::uuid AND id = $2::uuid
    `,
    args.orderId,
    args.vendorId,
    args.status,
    args.contactEmail,
    JSON.stringify(args.note),
    args.reopenOutreach,
  );
  if (updated === 0) throw new Error("The supplier row could not be updated.");
}

// One wrong contact reply, worked to its conclusion: another address at the
// same supplier, or the supplier faded out of the funnel with the reason kept.
export async function recoverProcurementWrongContact(args: {
  orderId: string;
  vendorId: string;
  vendorName: string;
  // The reply that said the contact is wrong, which is where a named
  // replacement address comes from, and its id, so the same reply is recovered
  // from once rather than on every pass.
  replyBody: string;
  sourceMessageId: string;
  // Every address of this supplier the request has already written to.
  mailedEmails: readonly string[];
  loadVendor?: typeof wrongContactVendorRow;
  writeVendor?: typeof noteWrongContact;
}): Promise<WrongContactRecoveryOutcome> {
  const load = args.loadVendor ?? wrongContactVendorRow;
  const write = args.writeVendor ?? noteWrongContact;
  try {
    const row = await load(args.orderId, args.vendorId);
    if (!row) {
      return {
        vendorId: args.vendorId,
        vendorName: args.vendorName,
        state: "FAILED",
        resolved: "FAILED",
        reason: "The supplier row was not found.",
        error: "The supplier row was not found.",
      };
    }
    if (row.handledMessageId && row.handledMessageId === args.sourceMessageId) {
      return {
        vendorId: args.vendorId,
        vendorName: args.vendorName,
        state: "ALREADY_HANDLED",
        resolved: row.handledState === "FADED" ? "FADED" : "RESOURCED",
        email: row.handledState === "RESOURCED" ? row.contactEmail : null,
        reason: row.handledState === "FADED"
          ? "This wrong contact was already faded out of the funnel."
          : "This wrong contact was already moved to another address at the same supplier.",
      };
    }
    // Oldest first, so the address the RFQ originally went to stays the first
    // retired one, which is what an addressless send reconciles against, and a
    // recovery carries forward every address the supplier has turned down.
    const mailed = [...new Set(
      [...(row.retiredEmails ?? []), ...args.mailedEmails, row.contactEmail ?? ""]
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.includes("@")),
    )];
    const plan = planWrongContactRecovery(wrongContactReplacements({
      body: args.replyBody,
      mailedEmails: mailed,
      alternateEmails: row.alternateEmails ?? [],
      supplierDomains: [row.website ?? "", ...mailed].filter(Boolean),
    }));
    const at = new Date().toISOString();
    if (plan.kind === "REPLACE_CONTACT") {
      await write({
        orderId: args.orderId,
        vendorId: args.vendorId,
        status: WRONG_CONTACT_RESOURCED_STATUS,
        contactEmail: plan.email,
        reopenOutreach: true,
        note: {
          state: "RESOURCED",
          retired: mailed,
          contactEmail: plan.email,
          sourceMessageId: args.sourceMessageId,
          at,
        },
      });
      return {
        vendorId: args.vendorId,
        vendorName: args.vendorName,
        state: "RESOURCED",
        resolved: "RESOURCED",
        email: plan.email,
        reason: plan.reason,
      };
    }
    await write({
      orderId: args.orderId,
      vendorId: args.vendorId,
      status: WRONG_CONTACT_FADED_STATUS,
      contactEmail: null,
      reopenOutreach: false,
      note: { state: "FADED", retired: mailed, sourceMessageId: args.sourceMessageId, at },
    });
    return {
      vendorId: args.vendorId,
      vendorName: args.vendorName,
      state: "FADED",
      resolved: "FADED",
      reason: plan.reason,
    };
  } catch (error) {
    // A recovery that could not be written leaves the thread owed, so the next
    // pass tries it again and an operator sees why it is stuck.
    return {
      vendorId: args.vendorId,
      vendorName: args.vendorName,
      state: "FAILED",
      resolved: "FAILED",
      reason: "The wrong contact could not be re-sourced.",
      error: error instanceof Error ? error.message : "The wrong contact could not be re-sourced.",
    };
  }
}
