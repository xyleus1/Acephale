import { requireSession } from "@/lib/auth";
import {
  getCensusPublicHardwareSnapshot,
  handleHardwareImportsExport,
} from "@/lib/intel/server";

export async function GET() {
  return handleHardwareImportsExport({
    requireSession,
    getSnapshot: getCensusPublicHardwareSnapshot,
  });
}
