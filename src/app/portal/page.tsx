import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/logo-mark";
import {
  getCustomerPortalPrincipal,
  issueCustomerPortalSession,
  requestCustomerPortalCode,
  verifyCustomerPortalCode,
} from "@/lib/customer-portal-auth";
import styles from "./portal-workspace.module.css";

export const metadata: Metadata = {
  title: { absolute: "Customer sign-in | Derya" },
};

type PortalLoginParams = {
  sent?: string;
  email?: string;
  office?: string;
  error?: string;
};

const ERROR_TEXT: Record<string, string> = {
  rate_limited: "Too many codes were requested. Wait 15 minutes and try again.",
  send_failed: "The code could not be sent. Contact your Derya operator.",
  badcode: "That code is incorrect or expired.",
};

export default async function CustomerPortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<PortalLoginParams>;
}) {
  const principal = await getCustomerPortalPrincipal();
  if (principal) redirect("/portal/workspace");
  const query = await searchParams;
  const codeSent = query.sent === "1" && !!query.email;

  async function requestCodeAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const office = String(formData.get("office") ?? "").trim() || null;
    const result = await requestCustomerPortalCode(email, office);
    if (!result.ok) {
      redirect(`/portal?error=${result.error}&email=${encodeURIComponent(email)}${office ? `&office=${encodeURIComponent(office)}` : ""}`);
    }
    redirect(`/portal?sent=1&email=${encodeURIComponent(email)}${office ? `&office=${encodeURIComponent(office)}` : ""}`);
  }

  async function verifyCodeAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const code = String(formData.get("code") ?? "").trim();
    const office = String(formData.get("office") ?? "").trim() || null;
    const verified = await verifyCustomerPortalCode(email, code, office);
    if (!verified.ok) {
      redirect(`/portal?sent=1&error=badcode&email=${encodeURIComponent(email)}${office ? `&office=${encodeURIComponent(office)}` : ""}`);
    }
    await issueCustomerPortalSession({
      userId: verified.userId,
      officeId: verified.officeId,
      email: verified.email,
    });
    redirect("/portal/workspace");
  }

  return (
    <main className={styles.loginShell}>
      <header className={styles.loginTopbar}>
        <a className={styles.loginWordmark} href="/portal" aria-label="Derya customer portal">
          <LogoMark className={styles.brandMark} />
          <div>
            <strong>Derya</strong>
            <span>Customer portal</span>
          </div>
        </a>
        <nav className={styles.loginLinks} aria-label="Portal links">
          <a href="mailto:rfq@usederya.com">Start shipment</a>
          <a href="/login">Team sign in</a>
        </nav>
      </header>

      <div className={styles.loginLayout}>
        <section className={styles.loginPanel} aria-labelledby="customer-sign-in-heading">
          <div className={styles.loginPanelHeader}>
            <h2 id="customer-sign-in-heading">Customer sign in</h2>
            <p>Use an email approved by your Derya operator.</p>
          </div>

        {query.error && (
          <div className={styles.error}>{ERROR_TEXT[query.error] ?? "Something went wrong. Try again."}</div>
        )}

        {!codeSent ? (
          <form action={requestCodeAction} className={styles.form}>
            <input type="hidden" name="office" value={query.office ?? ""} />
            <label className={styles.label}>
              Work email
              <input
                className={styles.input}
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={query.email ?? ""}
                placeholder="you@company.com"
              />
            </label>
            <button className={styles.button} type="submit">Email me a sign-in code</button>
          </form>
        ) : (
          <form action={verifyCodeAction} className={styles.form}>
            <input type="hidden" name="email" value={query.email ?? ""} />
            <input type="hidden" name="office" value={query.office ?? ""} />
            <div className={styles.notice}>
              If {query.email} has portal access, a six-digit code was sent. It expires in 10 minutes.
            </div>
            <label className={styles.label}>
              Six-digit code
              <input
                className={styles.input}
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoComplete="one-time-code"
                placeholder="123456"
                autoFocus
              />
            </label>
            <button className={styles.button} type="submit">Sign in</button>
            <a
              className={styles.linkButton}
              href={`/portal?email=${encodeURIComponent(query.email ?? "")}${query.office ? `&office=${encodeURIComponent(query.office)}` : ""}`}
            >
              Request another code
            </a>
          </form>
        )}

        <div className={styles.loginFoot}>
          Need access? Contact your Derya operator.
        </div>
        </section>
      </div>
    </main>
  );
}
