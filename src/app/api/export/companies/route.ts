import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CustomerStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const class1 = searchParams.get("class1") ?? "";
  const class2 = searchParams.get("class2") ?? "";
  const product = searchParams.get("product") ?? "";
  const lane = searchParams.get("lane") ?? "";

  const canViewAll =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.canViewWholeOffice;

  const where = {
    officeId: session.officeId,
    ...(canViewAll ? {} : { owners: { some: { userId: session.userId } } }),
    ...(q ? { name: { contains: q } } : {}),
    ...(status && Object.values(CustomerStatus).includes(status as CustomerStatus)
      ? { status: status as CustomerStatus }
      : {}),
    ...(class1 ? { class1 } : {}),
    ...(class2 ? { class2 } : {}),
    ...(product ? { product } : {}),
    ...(lane ? { lane } : {}),
  };

  const companies = await prisma.company.findMany({
    where,
    include: {
      owners: { include: { user: { select: { fullName: true } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });

  const rows = [
    ["Name", "Status", "Class1", "Class2", "Product", "Lane", "Owners", "Last Activity", "Created"].join(","),
    ...companies.map((c) => [
      `"${c.name.replace(/"/g, '""')}"`,
      c.status,
      `"${c.class1 ?? ""}"`,
      `"${c.class2 ?? ""}"`,
      `"${c.product ?? ""}"`,
      `"${c.lane ?? ""}"`,
      `"${c.owners.map((o) => o.user.fullName).join("; ")}"`,
      c.activities[0]?.occurredAt
        ? new Date(c.activities[0].occurredAt).toISOString().split("T")[0]
        : "",
      new Date(c.createdAt).toISOString().split("T")[0],
    ].join(",")),
  ].join("\n");

  return new NextResponse(rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="companies-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
