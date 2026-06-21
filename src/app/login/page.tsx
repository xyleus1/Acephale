import { redirect } from "next/navigation";
import { getSession, loginWithCredentials } from "@/lib/auth";
import { LogoMark } from "@/components/logo-mark";

type Params = {
  searchParams: Promise<{ error?: string; demo?: string }>;
};

export default async function LoginPage({ searchParams }: Params) {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const hasError = query.error === "1";
  const demoMode = query.demo === "1";

  async function loginAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    const result = await loginWithCredentials(email, password);
    if (!result) {
      redirect("/login?error=1");
    }

    redirect("/dashboard");
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <LogoMark className="login-logo" />
          <h1 className="login-title">Derya Deal Desk</h1>
          <p className="login-subtitle">Sign in to your office</p>
        </div>

        <div className="login-body">
          {hasError && (
            <div className="error-text">
              Invalid email or password. Please try again.
            </div>
          )}

          <form action={loginAction} className="field" style={{ gap: 14 }}>
            <label className="field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                required
                defaultValue={demoMode ? "admin@demo.local" : ""}
                placeholder="you@yourcompany.com"
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                required
                defaultValue={demoMode ? "admin1234" : ""}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </label>
            <button type="submit" style={{ marginTop: 4, padding: "10px 14px", fontSize: 14 }}>
              Sign in
            </button>
          </form>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
              Don&apos;t have an account? <a href="/signup" style={{ color: "var(--brand)", fontWeight: 600 }}>Create your office</a>
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
              Or <a href="/login?demo=1" style={{ color: "var(--text-2)", fontWeight: 500 }}>use sample access</a>
              {" "}— prefills <code style={{ fontSize: 10, background: "var(--surface-3)", padding: "1px 4px", borderRadius: 3 }}>admin@demo.local / admin1234</code>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
