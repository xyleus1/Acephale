import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/logo-mark";
import {
  authenticateCustomerPortal,
  getCustomerPortalPrincipal,
  issueCustomerPortalSession,
} from "@/lib/customer-portal-auth";
import { consumeCustomerPortalLoginAttempt } from "@/lib/customer-portal-login-rate-limit";
import styles from "./portal-workspace.module.css";

export const metadata: Metadata = {
  title: { absolute: "Customer sign-in | Derya" },
};

type PortalLoginParams = {
  email?: string;
  office?: string;
  error?: string;
};

export default async function CustomerPortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<PortalLoginParams>;
}) {
  const principal = await getCustomerPortalPrincipal();
  if (principal) redirect("/portal/workspace");
  const query = await searchParams;

  async function loginAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const office = String(formData.get("office") ?? "").trim() || null;
    const requestHeaders = await headers();
    const clientAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
      || requestHeaders.get("x-real-ip")
      || "unknown";
    if (!await consumeCustomerPortalLoginAttempt(clientAddress)) {
      redirect(`/portal?error=limited&email=${encodeURIComponent(email)}${office ? `&office=${encodeURIComponent(office)}` : ""}`);
    }
    const result = await authenticateCustomerPortal(email, password, office);
    if (!result.ok) {
      redirect(`/portal?error=invalid&email=${encodeURIComponent(email)}${office ? `&office=${encodeURIComponent(office)}` : ""}`);
    }
    await issueCustomerPortalSession({
      userId: result.userId,
      officeId: result.officeId,
      email: result.email,
      passwordVersion: result.passwordVersion,
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
            <p>Use the account created by your Derya operator.</p>
          </div>

          {query.error ? (
            <div className={styles.error}>
              {query.error === "limited"
                ? "Too many sign-in attempts. Wait 15 minutes or contact your Derya operator."
                : "Sign-in failed. Check your email and password, or contact your Derya operator if the account is locked."}
            </div>
          ) : null}

          <form action={loginAction} className={styles.form}>
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
            <label className={styles.label}>
              Password
              <input
                className={styles.input}
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="current-password"
              />
            </label>
            <button className={styles.button} type="submit">Sign in</button>
          </form>

          <div className={styles.loginFoot}>
            Need access or a new password? Contact your Derya operator.
          </div>
        </section>
      </div>
    </main>
  );
}
