import { requireSession } from "@/lib/auth";
import { ChinaImportLoadReview } from "../components/china-import-load-review";

export default async function ChinaImportLoadPage() {
  await requireSession();
  return <ChinaImportLoadReview />;
}
