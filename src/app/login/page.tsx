import { redirect } from "next/navigation";
import { getSession, loginWithCredentials } from "@/lib/auth";
import { LogoMark } from "@/components/logo-mark";

type Params = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: Params) {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const hasError = query.error === "1";

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
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </label>
            <button type="submit" style={{ marginTop: 4, padding: "10px 14px", fontSize: 14 }}>
              Sign in
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
