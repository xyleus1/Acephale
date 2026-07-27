import { requireSession } from "@/lib/auth";
import {
  getCensusPublicHardwareSnapshot,
  handleChinaCorridorWatchExport,
} from "@/lib/intel/server";

export async function GET() {
  return handleChinaCorridorWatchExport({
    requireSession,
    getSnapshot: getCensusPublicHardwareSnapshot,
  });
}
