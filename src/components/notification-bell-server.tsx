import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getT } from "@/lib/i18n";
import { NotificationBell } from "@/components/notification-bell";

export async function NotificationBellServer() {
  const session = await requireSession();
  const lang = await getLang();
  const t = getT(lang);
  const canViewAll =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.canViewWholeOffice;

  const staleDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [overdueTasks, staleRaw] = await Promise.all([
    prisma.task.findMany({
      where: {
        officeId: session.officeId,
        status: "OPEN",
        dueAt: { lt: new Date() },
        company: canViewAll
          ? undefined
          : { owners: { some: { userId: session.userId } } },
      },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    prisma.company.findMany({
      where: canViewAll
        ? { officeId: session.officeId }
        : { officeId: session.officeId, owners: { some: { userId: session.userId } } },
      include: { activities: { orderBy: { occurredAt: "desc" }, take: 1 } },
      take: 50,
    }),
  ]);

  const staleCompanies = staleRaw
    .filter(
      (c) =>
        c.activities.length === 0 ||
        new Date(c.activities[0].occurredAt) < staleDate
    )
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      name: c.name,
      lastActivityDate: c.activities[0]?.occurredAt?.toISOString() ?? null,
    }));

  const serializedTasks = overdueTasks.map((task) => ({
    id: task.id,
    title: task.title,
    dueAt: task.dueAt?.toISOString() ?? null,
    company: task.company,
  }));

  return (
    <NotificationBell
      overdueTasks={serializedTasks}
      staleCompanies={staleCompanies}
      t={t.notifications}
    />
  );
}
