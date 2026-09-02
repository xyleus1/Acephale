import "server-only";

import { consumeLoginAttempt } from "@/lib/login-throttle";

const MAX_ATTEMPTS = 30;

export async function consumeCustomerPortalLoginAttempt(clientAddress: string, now = new Date()) {
  return consumeLoginAttempt({ identity: clientAddress, maxAttempts: MAX_ATTEMPTS, now });
}
