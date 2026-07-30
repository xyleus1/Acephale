import { requireSession } from "@/lib/auth";
import { buildLoadIntelBrief } from "@/lib/load-intel-brief";
import { prisma } from "@/lib/prisma";
import { ChinaImportLoadReview } from "../components/china-import-load-review";

type SearchParams = Promise<{
  jobId?: string | string[];
}>;

export default async function ChinaImportLoadPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const jobIdValue = Array.isArray(params.jobId)
    ? params.jobId[0]
    : params.jobId;
  const jobId = jobIdValue?.trim();

  if (!jobId) {
    return <ChinaImportLoadReview />;
  }

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      officeId: session.officeId,
    },
    select: {
      inquiryId: true,
      companyId: true,
      reference: true,
      title: true,
      status: true,
      mode: true,
      origin: true,
      destination: true,
      commodity: true,
      incoterms: true,
      weight: true,
      volume: true,
      packages: true,
      dimensions: true,
      stackable: true,
      dangerousGoods: true,
      customsBy: true,
      containerCount: true,
      containerType: true,
      quantity: true,
      quantityUnit: true,
      declaredValue: true,
      declaredValueCurrency: true,
      etd: true,
      eta: true,
    },
  });

  if (!job) {
    return <ChinaImportLoadReview />;
  }

  const [inquiry, company] = await Promise.all([
    job.inquiryId
      ? prisma.inquiry.findFirst({
          where: {
            id: job.inquiryId,
            officeId: session.officeId,
          },
          select: {
            reference: true,
            mode: true,
            origin: true,
            destination: true,
            commodity: true,
            incoterms: true,
            weight: true,
            volume: true,
            packages: true,
            dimensions: true,
            stackable: true,
            dangerousGoods: true,
            customsBy: true,
            containerCount: true,
            containerType: true,
            declaredValue: true,
            declaredValueCurrency: true,
            cargoReadyDate: true,
            parsedData: true,
          },
        })
      : Promise.resolve(null),
    job.companyId
      ? prisma.company.findFirst({
          where: {
            id: job.companyId,
            officeId: session.officeId,
          },
          select: {
            name: true,
          },
        })
      : Promise.resolve(null),
  ]);
  const sourceText = buildLoadIntelBrief({
    ...job,
    company,
    inquiry,
    status: job.status.toString(),
  });

  return (
    <ChinaImportLoadReview
      key={job.reference}
      initialSourceText={sourceText}
      sourceLabel={`Copied from load ${job.reference}`}
    />
  );
}
