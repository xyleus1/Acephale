import { redirect } from "next/navigation";

// Sources / RFQ Inbox is now consolidated into /dashboard/inbox?view=rfqs.
// This route stays as a permanent redirect for legacy bookmarks and the
// header notification chip in the layout.
export default async function RFQPage() {
  redirect("/dashboard/inbox?view=rfqs");
}
