import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { allowedLoginEmails, isUsernameIdentifier, normalizeLoginEmail, usernameLoginEmail } from "@/lib/login-code";
import { hashPassword } from "@/lib/password";
import { boundedText, isOverLength } from "@/lib/ops-input";
import { opsSecretAuthorized } from "@/lib/ops-secret";
import { prisma } from "@/lib/prisma";
import { OfficeAlreadyExistsError, provisionOffice } from "@/lib/office-provisioning";

export const runtime = "nodejs";

type OfficeRequestBody = {
  officeName?: unknown;
  operatorEmail?: unknown;
  companyName?: unknown;
  workspaceName?: unknown;
  workspaceExternalKey?: unknown;
  adminUsername?: unknown;
  adminPassword?: unknown;
};

function isOfficeNameConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.length === 1 && String(target[0]).toLowerCase() === "name";
  return typeof target === "string" && target.toLowerCase() === "name";
}

export async function POST(request: NextRequest) {
  if (!opsSecretAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as OfficeRequestBody | null;
  const officeName = boundedText(body?.officeName, 80);
  if (!officeName || officeName.length < 2 || isOverLength(body?.officeName, 80)) {
    return NextResponse.json({ error: "Office name must be 2 to 80 characters." }, { status: 400 });
  }

  if (isOverLength(body?.operatorEmail, 200)) {
    return NextResponse.json({ error: "Operator email must be at most 200 characters." }, { status: 400 });
  }
  if (isOverLength(body?.companyName, 160)) {
    return NextResponse.json({ error: "Company name must be at most 160 characters." }, { status: 400 });
  }
  if (isOverLength(body?.workspaceName, 160)) {
    return NextResponse.json({ error: "Workspace name must be at most 160 characters." }, { status: 400 });
  }
  if (isOverLength(body?.workspaceExternalKey, 120)) {
    return NextResponse.json({ error: "Workspace external key must be at most 120 characters." }, { status: 400 });
  }

  const operatorEmailValue = boundedText(body?.operatorEmail, 200);
  if (!operatorEmailValue) {
    return NextResponse.json({ error: "Operator email is required." }, { status: 400 });
  }
  const operatorEmail = normalizeLoginEmail(operatorEmailValue);
  if (!allowedLoginEmails().includes(operatorEmail)) {
    return NextResponse.json({ error: "Operator email is not allowlisted." }, { status: 403 });
  }

  const adminUsernameValue = boundedText(body?.adminUsername, 80);
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

  const operator = await prisma.user.findFirst({
    where: { email: operatorEmail, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { email: true, fullName: true, passwordHash: true },
  });
  if (!operator) {
    return NextResponse.json({ error: "No active user found for that operator email." }, { status: 404 });
  }

  const admins = [{
    email: operator.email,
    fullName: operator.fullName,
    passwordHash: operator.passwordHash,
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
      companyName: boundedText(body?.companyName, 160),
      workspaceName: boundedText(body?.workspaceName, 160),
      workspaceExternalKey: boundedText(body?.workspaceExternalKey, 120),
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
