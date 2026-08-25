import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  issueOperatorSessionForUser,
  type SessionPayload,
} from "@/lib/auth";
import { normalizeLoginEmail } from "@/lib/login-code";

export type SwitchableOffice = {
  officeId: string;
  officeName: string;
  userId: string;
  role: string;
  canViewWholeOffice: boolean;
  isCurrent: boolean;
};

export type SwitchOfficeResult =
  | {
      ok: true;
      userId: string;
      officeId: string;
      role: string;
    }
  | {
      ok: false;
      reason: "not_allowed";
    };

type OfficeSwitchClient = Pick<PrismaClient, "user">;

type OfficeSwitchOptions = {
  client?: OfficeSwitchClient;
  issueSession?: typeof issueOperatorSessionForUser;
};

function normalizedEmailWhere(email: string) {
  return {
    equals: normalizeLoginEmail(email),
    mode: "insensitive" as const,
  };
}

export async function listSwitchableOffices(
  session: SessionPayload,
  options: { client?: OfficeSwitchClient } = {},
): Promise<SwitchableOffice[]> {
  if (session.accessKind === "customer" || session.role === "CUSTOMER") return [];

  const users = await (options.client ?? prisma).user.findMany({
    where: {
      email: normalizedEmailWhere(session.email),
      isActive: true,
    },
    select: {
      id: true,
      officeId: true,
      role: true,
      canViewWholeOffice: true,
      createdAt: true,
      office: { select: { name: true, createdAt: true } },
    },
  });

  return users
    .sort((left, right) => {
      const officeOrder = left.office.createdAt.getTime() - right.office.createdAt.getTime();
      return officeOrder || left.createdAt.getTime() - right.createdAt.getTime();
    })
    .map((user) => ({
      officeId: user.officeId,
      officeName: user.office.name,
      userId: user.id,
      role: user.role,
      canViewWholeOffice: user.canViewWholeOffice,
      isCurrent: user.officeId === session.officeId,
    }));
}

export async function switchOffice(
  session: SessionPayload,
  targetOfficeId: string,
  options: OfficeSwitchOptions = {},
): Promise<SwitchOfficeResult> {
  if (session.accessKind === "customer" || session.role === "CUSTOMER") {
    return { ok: false, reason: "not_allowed" };
  }

  const officeId = targetOfficeId.trim();
  if (!officeId) return { ok: false, reason: "not_allowed" };

  const user = await (options.client ?? prisma).user.findFirst({
    where: {
      officeId,
      email: normalizedEmailWhere(session.email),
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      officeId: true,
      role: true,
      canViewWholeOffice: true,
    },
  });
  if (!user) return { ok: false, reason: "not_allowed" };

  await (options.issueSession ?? issueOperatorSessionForUser)(user);
  return {
    ok: true,
    userId: user.id,
    officeId: user.officeId,
    role: user.role,
  };
}
