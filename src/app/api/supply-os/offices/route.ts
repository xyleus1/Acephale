import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { canProvisionOffice, OfficeAlreadyExistsError, provisionOffice } from "@/lib/office-provisioning";
import { isUsernameIdentifier, usernameLoginEmail } from "@/lib/login-code";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type OfficeRequestBody = {
  officeName?: unknown;
  companyName?: unknown;
  workspaceName?: unknown;
  workspaceExternalKey?: unknown;
  adminUsername?: unknown;
  adminPassword?: unknown;
};

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function isOfficeNameConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.length === 1 && String(target[0]).toLowerCase() === "name";
  return typeof target === "string" && target.toLowerCase() === "name";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canProvisionOffice(session)) {
    return NextResponse.json({ error: "Only allowlisted admins can create offices." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as OfficeRequestBody | null;
  const officeName = optionalText(body?.officeName);
  if (!officeName || officeName.length < 2 || officeName.length > 80) {
    return NextResponse.json({ error: "Office name must be 2 to 80 characters." }, { status: 400 });
  }

  const adminUsernameValue = optionalText(body?.adminUsername);
  const adminPassword = typeof body?.adminPassword === "string" ? body.adminPassword : undefined;
  if (!adminUsernameValue && adminPassword !== undefined) {
    return NextResponse.json({ error: "Customer login username is required when a password is supplied." }, { status: 400 });
  }
  if (adminUsernameValue && !isUsernameIdentifier(adminUsernameValue)) {
    return NextResponse.json({
      error: "Customer login username must be 2-31 characters of a-z, 0-9, dot, dash or underscore.",
    }, { status: 400 });
  }
  if (adminUsernameValue && adminPassword === undefined) {
    return NextResponse.json({ error: "Customer login password is required." }, { status: 400 });
  }
  if (adminPassword !== undefined && adminPassword.length < 12) {
    return NextResponse.json({ error: "Customer login password must be at least 12 characters." }, { status: 400 });
  }

  const existingOffice = await prisma.office.findUnique({
    where: { name: officeName },
    select: { id: true },
  });
  if (existingOffice) {
    return NextResponse.json({
      error: `An office named "${officeName}" already exists.`,
    }, { status: 409 });
  }

  const actingUser = await prisma.user.findFirst({
    where: {
      id: session.userId,
      officeId: session.officeId,
      isActive: true,
    },
    select: { email: true, fullName: true, passwordHash: true },
  });
  if (!actingUser) {
    return NextResponse.json({ error: "Your account is no longer active." }, { status: 403 });
  }

  const admins = [{
    email: actingUser.email,
    fullName: actingUser.fullName,
    passwordHash: actingUser.passwordHash,
  }];
  if (adminUsernameValue && adminPassword !== undefined) {
    admins.push({
      email: usernameLoginEmail(adminUsernameValue),
      fullName: adminUsernameValue,
      passwordHash: await hashPassword(adminPassword),
    });
  }

  let result;
  try {
    result = await provisionOffice(prisma, {
      officeName,
      admins,
      companyName: optionalText(body?.companyName),
      workspaceName: optionalText(body?.workspaceName),
      workspaceExternalKey: optionalText(body?.workspaceExternalKey),
      requireNewOffice: true,
    });
  } catch (error) {
    if (error instanceof OfficeAlreadyExistsError) {
      return NextResponse.json({
        error: error.message,
      }, { status: 409 });
    }
    if (!isOfficeNameConflict(error)) throw error;
    return NextResponse.json({
      error: `An office named "${officeName}" already exists.`,
    }, { status: 409 });
  }

  return NextResponse.json({
    office: result.office,
    company: result.company,
    workspace: result.workspace,
    admins: result.admins,
    createdOffice: result.createdOffice,
    createdAdmin: result.createdAdmin,
    createdAdmins: result.createdAdmins,
    createdCompany: result.createdCompany,
    createdWorkspace: result.createdWorkspace,
  }, { status: result.createdOffice ? 201 : 200 });
}
