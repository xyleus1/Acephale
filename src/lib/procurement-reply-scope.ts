import "server-only";

import { localRfqRespondentEmails } from "@/lib/procurement-local-outreach";
import type { ProcurementOrderVendor } from "@/lib/procurement-workflow";

// Only a supplier that answered can have a reply waiting for an answer, so
// every pass that walks supplier threads walks the repliers instead of the
// whole request. A campaign with hundreds of silent suppliers otherwise costs
// one conversation read per row, which is what pushed a scheduled pass past its
// invocation limit and left real replies unanswered on large requests.
export type ProcurementReplyScope<T> = {
  vendors: T[];
  // False when the deadline stopped the history read, so a supplier missing here
  // is not proven silent and the pass is unfinished rather than done.
  complete: boolean;
};

export async function procurementRepliedVendors<T extends Pick<
  ProcurementOrderVendor,
  "contacted" | "responseCount" | "contact"
>>(args: {
  officeId: string;
  orderId: string;
  vendors: readonly T[];
  outOfTime?: () => boolean;
}): Promise<ProcurementReplyScope<T>> {
  // A reply this app delivered lands in the office email records, and the
  // workflow ledger may never see it, so the office records decide who answered
  // alongside the projected count. Respondents are read across the whole order
  // history rather than from the capped presentation summary, because a reply
  // older than that window would otherwise leave its supplier unanswered, and
  // the read stops at the caller's deadline so a long history cannot spend a
  // whole invocation before a single answer is sent.
  const respondents = await localRfqRespondentEmails(args.officeId, args.orderId, {
    outOfTime: args.outOfTime,
  });
  const responded = new Set(respondents.emails);
  return {
    vendors: args.vendors.filter((vendor) => {
      if (vendor.responseCount > 0) return true;
      const email = vendor.contact?.email?.trim().toLowerCase() ?? "";
      return email.length > 0 && responded.has(email);
    }),
    complete: respondents.complete,
  };
}
