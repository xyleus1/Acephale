import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { toCarrierRow } from "@/lib/carrier-fields";
import { CarrierSheet } from "@/components/carrier-sheet";

// Kept in sync with CarrierSheetRecord in src/lib/carrier-fields.ts.
const SHEET_SELECT = {
  id: true,
  name: true,
  mcNumber: true,
  dotNumber: true,
  vettingStatus: true,
  airRide: true,
  liftgate: true,
  blanketWrap: true,
  teamDrivers: true,
  hazmatCertified: true,
  lithiumCapable: true,
  reeferCapable: true,
  cargoLimit: true,
  cargoInsuranceExpiry: true,
  homeBase: true,
  scorecardScore: true,
  loadsCompleted: true,
  active: true,
} as const;

export default async function CarriersPage() {
  const session = await requireSession();

  const carriers = await prisma.carrier.findMany({
    where: { officeId: session.officeId },
    select: SHEET_SELECT,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 1000,
  });

  return <CarrierSheet initialRows={carriers.map(toCarrierRow)} />;
}
