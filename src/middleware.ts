import { NextRequest, NextResponse } from "next/server";

// Auto-focus a job when the user navigates to its detail page.
// The cookie persists across pages so the context strip travels with the user.
const JOB_DETAIL_RE = /^\/dashboard\/jobs\/([^/?]+)/;
const RESERVED = new Set(["new"]);

export function middleware(req: NextRequest) {
  const m = req.nextUrl.pathname.match(JOB_DETAIL_RE);
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
