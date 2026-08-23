import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/password";
import { isLoginEmailAllowed } from "@/lib/login-code";

const SESSION_COOKIE = "crm_session";
const ONE_DAY = 60 * 60 * 24;
// Persistent session: stays signed in until explicit logout. 400 days is the
// longest lifetime browsers honor for a cookie (per the cookie spec cap), so
// this is effectively "until you log out" without a server-side expiry check.
const SESSION_MAX_AGE = ONE_DAY * 400;

export type SessionPayload = {
  userId: string;
  officeId: string;
  email: string;
  role: string;
  canViewWholeOffice: boolean;
  accessKind?: "operator" | "customer";
  customerPortalUserId?: string;
  customerPasswordVersion?: number;
  customerRole?: string;
  restrictedWorkspaceIds?: string[];
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is missing.");
  }
  return secret;
}

function sign(input: string) {
  return crypto.createHmac("sha256", getSecret()).update(input).digest("hex");
}

function encodeSession(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const base = Buffer.from(json).toString("base64url");
  const sig = sign(base);
  return `${base}.${sig}`;
}

function decodeSession(token: string): SessionPayload | null {
  const [base, sig] = token.split(".");
  if (!base || !sig) return null;
  if (sign(base) !== sig) return null;
  try {
    const decoded = Buffer.from(base, "base64url").toString("utf-8");
    return JSON.parse(decoded) as SessionPayload;
  } catch {
    return null;
  }
}

async function issueSessionCookie(user: {
  id: string;
  email: string;
  officeId: string;
  role: string;
  canViewWholeOffice: boolean;
  accessKind?: "operator" | "customer";
  customerPortalUserId?: string;
  customerPasswordVersion?: number;
}) {
  const token = encodeSession({
    userId: user.id,
    officeId: user.officeId,
    email: user.email,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice,
    accessKind: user.accessKind ?? "operator",
    ...(user.customerPortalUserId ? { customerPortalUserId: user.customerPortalUserId } : {}),
    ...(user.customerPasswordVersion !== undefined
      ? { customerPasswordVersion: user.customerPasswordVersion }
      : {}),
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function issueCustomerAppSession(input: {
  internalUserId: string;
  portalUserId: string;
  officeId: string;
  username: string;
  passwordVersion: number;
}) {
  await issueSessionCookie({
    id: input.internalUserId,
    email: input.username,
    officeId: input.officeId,
    role: "CUSTOMER",
    canViewWholeOffice: false,
    accessKind: "customer",
    customerPortalUserId: input.portalUserId,
    customerPasswordVersion: input.passwordVersion,
  });
}

export async function loginWithCredentials(email: string, password: string) {
  // Internal deployment: every sign-in path is allowlist-gated.
  if (!isLoginEmailAllowed(email)) return null;

  const users = await prisma.user.findMany({
    where: { email, isActive: true },
    select: { id: true, email: true, officeId: true, role: true, passwordHash: true, canViewWholeOffice: true }
  });

  if (users.length === 0) return null;

  let user:
    | {
        id: string;
        email: string;
        officeId: string;
        role: string;
        passwordHash: string;
        canViewWholeOffice: boolean;
      }
    | null = null;

  for (const candidate of users) {
    if (await verifyPassword(password, candidate.passwordHash)) {
      user = candidate;
      break;
    }
  }

  if (!user) return null;

  await issueSessionCookie(user);

  return { userId: user.id, officeId: user.officeId, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

// Completes an email-code login. The caller must have verified the code via
// verifyLoginCode first; this only turns a proven email into a session.
export async function loginWithVerifiedEmail(email: string) {
  if (!isLoginEmailAllowed(email)) return null;

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, email: true, officeId: true, role: true, canViewWholeOffice: true },
  });
  if (!user) return null;

  await issueSessionCookie(user);

  return { userId: user.id, officeId: user.officeId, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

export async function signupWithCredentials(args: {
  email: string;
  password: string;
  fullName: string;
  officeName: string;
}): Promise<
  | { ok: true; userId: string; officeId: string }
  | { ok: false; error: string }
> {
  const email = args.email.trim().toLowerCase();
  const password = args.password;
  const fullName = args.fullName.trim();
  const officeName = args.officeName.trim();

  if (!isLoginEmailAllowed(email)) {
    return { ok: false, error: "This is an internal deployment. Signups are disabled." };
  }
  if (!email || !password || !fullName || !officeName) {
    return { ok: false, error: "All fields are required." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }

  // Reject if any active user already has this email anywhere.
  const existing = await prisma.user.findFirst({ where: { email, isActive: true } });
  if (existing) {
    return { ok: false, error: "An account with that email already exists. Try signing in." };
  }

  const passwordHash = await hashPassword(password);

  // Create office + first admin user in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const office = await tx.office.create({
      data: { name: officeName },
    });
    const user = await tx.user.create({
      data: {
        officeId: office.id,
        email,
        passwordHash,
        fullName,
        role: "ADMIN",
        isActive: true,
        canViewWholeOffice: true,
      },
    });
    return { office, user };
  });

  // Issue session immediately
  const token = encodeSession({
    userId: result.user.id,
    officeId: result.office.id,
    email: result.user.email,
    role: result.user.role,
    canViewWholeOffice: result.user.canViewWholeOffice,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return { ok: true, userId: result.user.id, officeId: result.office.id };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete("derya_customer_portal_session");
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = decodeSession(token);
  if (!session || session.accessKind !== "customer") return session;
  if (!session.customerPortalUserId || session.customerPasswordVersion === undefined) return null;

  const customer = await prisma.customerPortalUser.findFirst({
    where: {
      id: session.customerPortalUserId,
      internalUserId: session.userId,
      officeId: session.officeId,
      isActive: true,
      passwordHash: { not: null },
      passwordVersion: session.customerPasswordVersion,
    },
    select: {
      username: true,
      internalUser: { select: { id: true, isActive: true } },
      memberships: {
        where: {
          officeId: session.officeId,
          isActive: true,
          company: { officeId: session.officeId, crmStage: { not: "archived" } },
        },
        select: {
          role: true,
          company: {
            select: {
              supplyWorkspaces: {
                where: { officeId: session.officeId, status: "ACTIVE" },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
  if (!customer?.username || !customer.internalUser?.isActive) return null;
  const restrictedWorkspaceIds = [...new Set(customer.memberships.flatMap((membership) =>
    membership.company.supplyWorkspaces.map((workspace) => workspace.id))
  )];
  if (restrictedWorkspaceIds.length === 0) return null;
  const roleRank: Record<string, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2 };
  const customerRole = customer.memberships
    .map((membership) => membership.role)
    .sort((left, right) => (roleRank[right] ?? 0) - (roleRank[left] ?? 0))[0] ?? "VIEWER";
  return {
    ...session,
    email: customer.username,
    role: "CUSTOMER",
    canViewWholeOffice: false,
    customerRole,
    restrictedWorkspaceIds,
  };
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
