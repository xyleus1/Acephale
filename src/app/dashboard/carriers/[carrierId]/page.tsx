import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { carrierVettingGate } from "@/lib/carrier-vetting";
import { toCarrierDetail } from "@/lib/carrier-fields";
import { CarrierDetailView } from "@/components/carrier-detail";

export default async function CarrierDetailPage({ params }: { params: Promise<{ carrierId: string }> }) {
  const session = await requireSession();
  const { carrierId } = await params;

  const carrier = await prisma.carrier.findFirst({
    where: { id: carrierId, officeId: session.officeId },
    include: { checklist: true },
  });
  if (!carrier) notFound();

  return (
    <CarrierDetailView
      initialDetail={toCarrierDetail(carrier)}
      initialGate={carrierVettingGate(carrier, carrier.checklist)}
    />
  );
}
