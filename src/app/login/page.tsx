import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, loginWithCredentials, loginWithVerifiedEmail } from "@/lib/auth";
import { requestLoginCode, resolveLoginIdentifier, verifyLoginCode } from "@/lib/login-code";
import { clientAddressFromHeaders, consumeLoginAttempt, loginAttemptsExhausted } from "@/lib/login-throttle";
import {
  MAX_PASSWORD_ATTEMPTS_PER_ADDRESS,
  MAX_PASSWORD_FAILURES_PER_IDENTIFIER,
  passwordAddressIdentity,
  passwordIdentifierIdentity,
} from "@/lib/auth-session-route";
import { LogoMark } from "@/components/logo-mark";

// Per client address, per 15 minutes. Requesting a code sends mail to someone
// else's mailbox, so it gets the tightest budget of the three actions.
const MAX_CODE_REQUESTS_PER_ADDRESS = 6;
const MAX_CODE_VERIFICATIONS_PER_ADDRESS = 15;
// Password budgets and identities come from the JSON sign-in route so both
// surfaces spend the same counters. Address budgets are best effort because a
// caller can rotate forwarded addresses, so failed guesses are also counted
// against the identifier. Only failures count, so a working password is never
// locked out by this.

type Params = {
  searchParams: Promise<{ error?: string; sent?: string; email?: string; via?: string }>;
};

// One wording for every reason a code cannot be sent: whether an address is on
// the sign-in list or has an account is not something this form should confirm.
const UNAVAILABLE_TEXT = "Could not send a sign-in code to that address. Check the address, or use the password fallback.";

const ERROR_TEXT: Record<string, string> = {
  "1": "Invalid username, email, or password. Please try again.",
  not_allowed: UNAVAILABLE_TEXT,
  no_user: UNAVAILABLE_TEXT,
  send_failed: UNAVAILABLE_TEXT,
  // Deliberately vague about the wait: this covers a 15 minute address budget
  // and a rolling 24 hour cap on codes sent to one mailbox.
  rate_limited: "Too many sign-in attempts. Wait and try again later, or use the password fallback.",
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
    const clientAddress = clientAddressFromHeaders(await headers());
    // Checked before the allowlist so a flooded form answers the same way for
    // every address, including ones that cannot sign in at all.
    const withinBudget = await consumeLoginAttempt({
      identity: `login-code:${clientAddress}`,
      maxAttempts: MAX_CODE_REQUESTS_PER_ADDRESS,
    });
    if (!withinBudget) {
      console.warn("login code request throttled", { clientAddress });
      redirect(`/login?error=rate_limited&email=${encodeURIComponent(email)}`);
    }
    const result = await requestLoginCode(email, { clientAddress });
    if (!result.ok) {
      redirect(`/login?error=${result.error}&email=${encodeURIComponent(email)}`);
    }
    redirect(`/login?sent=1&email=${encodeURIComponent(email)}&via=${encodeURIComponent(result.sentVia)}`);
  }

  async function verifyCodeAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const code = String(formData.get("code") ?? "").trim();
    const clientAddress = clientAddressFromHeaders(await headers());
    const withinBudget = await consumeLoginAttempt({
      identity: `login-verify:${clientAddress}`,
      maxAttempts: MAX_CODE_VERIFICATIONS_PER_ADDRESS,
    });
    if (!withinBudget) {
      console.warn("login code verification throttled", { clientAddress });
      redirect(`/login?sent=1&email=${encodeURIComponent(email)}&error=rate_limited`);
    }
    const verified = await verifyLoginCode(email, code);
    if (!verified.ok) {
      console.warn("login code verification failed", { clientAddress });
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
    const identifier = resolveLoginIdentifier(String(formData.get("email") ?? ""));
    const password = String(formData.get("password") ?? "");
    const clientAddress = clientAddressFromHeaders(await headers());
    // The password form accepts customer office usernames too, so without this
    // it is an unlimited guessing oracle against shared office passwords.
    const withinBudget = await consumeLoginAttempt({
      identity: passwordAddressIdentity(clientAddress),
      maxAttempts: MAX_PASSWORD_ATTEMPTS_PER_ADDRESS,
    });
    if (!withinBudget) {
      console.warn("login password attempt throttled", { clientAddress });
      redirect("/login?error=rate_limited");
    }

    if (await loginAttemptsExhausted(passwordIdentifierIdentity(identifier), MAX_PASSWORD_FAILURES_PER_IDENTIFIER)) {
      console.warn("login password attempts exhausted for identifier", { clientAddress });
      redirect("/login?error=rate_limited");
    }

    const result = await loginWithCredentials(identifier, password);
    if (!result) {
      await consumeLoginAttempt({
        identity: passwordIdentifierIdentity(identifier),
        maxAttempts: MAX_PASSWORD_FAILURES_PER_IDENTIFIER,
      });
      console.warn("login password attempt failed", { clientAddress });
      redirect("/login?error=1");
    }

    redirect("/dashboard");
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <LogoMark className="login-logo" />
          <h1 className="login-title">Derya</h1>
          <p className="login-subtitle">Internal sign in</p>
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
                <span>Email or username</span>
                <input name="email" type="text" required autoComplete="username" defaultValue={query.email ?? ""} />
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
