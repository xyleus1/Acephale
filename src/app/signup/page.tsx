import { redirect } from "next/navigation";
import { getSession, signupWithCredentials } from "@/lib/auth";
import { LogoMark } from "@/components/logo-mark";

type Params = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignupPage({ searchParams }: Params) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const query = await searchParams;
  const errorMsg = query.error ? decodeURIComponent(query.error) : null;

  async function signupAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const fullName = String(formData.get("fullName") ?? "");
    const officeName = String(formData.get("officeName") ?? "");

    const result = await signupWithCredentials({ email, password, fullName, officeName });
    if (!result.ok) {
      redirect(`/signup?error=${encodeURIComponent(result.error)}`);
    }
    redirect("/dashboard");
  }

  return (
    <main className="login-shell">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <div className="login-header">
          <LogoMark className="login-logo" />
          <h1 className="login-title">Create your office</h1>
          <p className="login-subtitle">Create a focused RFQ and pricing workspace</p>
        </div>

        <div className="login-body">
          {errorMsg && (
            <div className="error-text">{errorMsg}</div>
          )}

          <form action={signupAction} className="field" style={{ gap: 14 }}>
            <label className="field">
              <span>Office name</span>
              <input
                name="officeName"
                required
                placeholder="e.g. Derya Forwarding"
                autoComplete="organization"
              />
            </label>

            <label className="field">
              <span>Your full name</span>
              <input
                name="fullName"
                required
                placeholder="e.g. Mert Turna"
                autoComplete="name"
              />
            </label>

            <label className="field">
              <span>Work email</span>
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
                minLength={8}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>

            <button type="submit" style={{ marginTop: 4, padding: "10px 14px", fontSize: 14 }}>
              Create office
            </button>
          </form>

          <p style={{ marginTop: 18, fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
            Already have an account? <a href="/login" style={{ color: "var(--brand)", fontWeight: 600 }}>Sign in</a>
          </p>
        </div>
      </div>
    </main>
  );
}
