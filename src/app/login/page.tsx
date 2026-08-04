import { redirect } from "next/navigation";
import { getSession, loginWithCredentials, loginWithVerifiedEmail } from "@/lib/auth";
import { requestLoginCode, verifyLoginCode } from "@/lib/login-code";
import { LogoMark } from "@/components/logo-mark";

type Params = {
  searchParams: Promise<{ error?: string; sent?: string; email?: string; via?: string }>;
};

const ERROR_TEXT: Record<string, string> = {
  "1": "Invalid email or password. Please try again.",
  not_allowed: "This is an internal Derya deployment. That email is not on the sign-in list.",
  no_user: "No active account exists for that email.",
  rate_limited: "Too many codes requested. Wait 15 minutes and try again.",
  send_failed: "Could not send the sign-in code email. Try again, or use the password fallback.",
  badcode: "That code is wrong or expired. Request a new one if needed.",
};

export default async function LoginPage({ searchParams }: Params) {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const errorText = query.error ? ERROR_TEXT[query.error] ?? "Something went wrong. Try again." : null;
  const codeSent = query.sent === "1" && !!query.email;

  async function requestCodeAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email) redirect("/login");
    const result = await requestLoginCode(email);
    if (!result.ok) {
      redirect(`/login?error=${result.error}&email=${encodeURIComponent(email)}`);
    }
    redirect(`/login?sent=1&email=${encodeURIComponent(email)}&via=${encodeURIComponent(result.sentVia)}`);
  }

  async function verifyCodeAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const code = String(formData.get("code") ?? "").trim();
    const verified = await verifyLoginCode(email, code);
    if (!verified.ok) {
      redirect(`/login?sent=1&email=${encodeURIComponent(email)}&error=badcode`);
    }
    const result = await loginWithVerifiedEmail(verified.email);
    if (!result) {
      redirect(`/login?error=no_user&email=${encodeURIComponent(email)}`);
    }
    redirect("/dashboard");
  }

  async function passwordLoginAction(formData: FormData) {
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
          <p className="login-subtitle">Internal sign-in - a code is emailed to you</p>
        </div>

        <div className="login-body">
          {errorText && <div className="error-text">{errorText}</div>}

          {!codeSent ? (
            <form action={requestCodeAction} className="field" style={{ gap: 14 }}>
              <label className="field">
                <span>Email address</span>
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@usederya.com"
                  autoComplete="email"
                  defaultValue={query.email ?? ""}
                />
              </label>
              <button type="submit" style={{ marginTop: 4, padding: "10px 14px", fontSize: 14 }}>
                Email me a sign-in code
              </button>
            </form>
          ) : (
            <form action={verifyCodeAction} className="field" style={{ gap: 14 }}>
              <input type="hidden" name="email" value={query.email ?? ""} />
              <p style={{ fontSize: 13, margin: 0 }}>
                Code sent to <strong>{query.email}</strong>
                {query.via ? ` (from ${query.via})` : ""}. It expires in 10 minutes.
              </p>
              <label className="field">
                <span>6-digit code</span>
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  placeholder="123456"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </label>
              <button type="submit" style={{ marginTop: 4, padding: "10px 14px", fontSize: 14 }}>
                Sign in
              </button>
              <a href={`/login?email=${encodeURIComponent(query.email ?? "")}`} className="login-subtitle" style={{ fontSize: 12 }}>
                Use a different email or resend
              </a>
            </form>
          )}

          <details style={{ marginTop: 18 }}>
            <summary style={{ fontSize: 12, cursor: "pointer", opacity: 0.7 }}>Use password instead</summary>
            <form action={passwordLoginAction} className="field" style={{ gap: 14, marginTop: 10 }}>
              <label className="field">
                <span>Email address</span>
                <input name="email" type="email" required autoComplete="email" defaultValue={query.email ?? ""} />
              </label>
              <label className="field">
                <span>Password</span>
                <input name="password" type="password" required autoComplete="current-password" />
              </label>
              <button type="submit" style={{ padding: "10px 14px", fontSize: 14 }}>
                Sign in with password
              </button>
            </form>
          </details>

          <div className="login-audience-switch">
            Customer? <a href="/portal">Sign in to your shipment workspace</a>
          </div>
        </div>
      </div>
    </main>
  );
}
