import { NextRequest, NextResponse } from "next/server";

// Auto-focus a job when the user navigates to its detail page.
// The cookie persists across pages so the context strip travels with the user.
const JOB_DETAIL_RE = /^\/dashboard\/jobs\/([^/?]+)/;
const RESERVED = new Set(["new"]);

// Loadboard-only accounts (UserRole.EMPLOYEE) may only open the loads
// surfaces; everything else bounces to their home board.
const EMPLOYEE_HOME = "/dashboard/loads";

function isEmployeeAllowedPath(pathname: string) {
  if (pathname === "/dashboard/loads" || pathname.startsWith("/dashboard/loads/")) return true;
  if (pathname === "/dashboard/jobs" || pathname.startsWith("/dashboard/jobs/")) {
    // Creating loads stays an admin/ops task; employees work existing ones.
    return !(pathname === "/dashboard/jobs/new" || pathname.startsWith("/dashboard/jobs/new/"));
  }
  return false;
}

// Mirror of decodeSession in src/lib/auth.ts for the edge runtime (WebCrypto
// instead of node crypto). Used only for routing; pages and server actions
// still verify the cookie themselves via requireSession().
async function sessionRoleFromCookie(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const [base, sig] = token.split(".");
  if (!base || !sig) return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(base));
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hex !== sig) return null;
    const b64 = base.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const role = await sessionRoleFromCookie(req.cookies.get("crm_session")?.value);
  if (role === "EMPLOYEE" && !isEmployeeAllowedPath(pathname)) {
    return NextResponse.redirect(new URL(EMPLOYEE_HOME, req.url));
  }

  const m = pathname.match(JOB_DETAIL_RE);
  if (!m) return NextResponse.next();

  const id = m[1];
  if (RESERVED.has(id)) return NextResponse.next();

  // Mirror onto the request so server components in this same render see it
  req.cookies.set("focus-job", id);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set("focus-job", id, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
