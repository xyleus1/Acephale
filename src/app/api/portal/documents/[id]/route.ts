import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { streamJobDocument } from "@/lib/job-document-response";
import { isCustomerPortalDocumentSource } from "@/lib/customer-portal-security";
import { isPlausiblePortalToken } from "@/lib/portal-token";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const document = await prisma.jobDocument.findFirst({
    where: {
      id,
      status: "APPROVED",
      customerVisible: true,
    },
    select: {
      name: true,
      url: true,
      officeId: true,
      job: {
        select: {
          companyId: true,
          portalToken: true,
        },
      },
    },
  });
  if (!document?.url) return new NextResponse("Document not found", { status: 404 });

  const url = new URL(request.url);
  const guestToken = url.searchParams.get("token");
  const guestAuthorized = Boolean(
    guestToken
    && isPlausiblePortalToken(guestToken)
    && guestToken === document.job.portalToken,
  );

  let workspaceAuthorized = false;
  if (document.job.companyId) {
    try {
      const principal = await getCustomerPortalPrincipal();
      workspaceAuthorized = Boolean(
        principal
        && principal.officeId === document.officeId
        && principal.memberships.some((membership) =>
          membership.companyId === document.job.companyId
        ),
      );
    } catch {
      workspaceAuthorized = false;
    }
  }

  if (!guestAuthorized && !workspaceAuthorized) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!isCustomerPortalDocumentSource(document.url)) {
    return new NextResponse("Document source unavailable", { status: 404 });
  }
  return streamJobDocument(document, document.officeId);
}
