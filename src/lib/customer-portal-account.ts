const MANAGED_CUSTOMER_EMAIL_DOMAIN = "customers.derya.invalid";
const REMOVED_CUSTOMER_USERNAME_PREFIX = "removed_";

export function managedCustomerEmail(username: string) {
  return `${username}@${MANAGED_CUSTOMER_EMAIL_DOMAIN}`;
}

export function isManagedCustomerEmail(email: string) {
  return email.toLowerCase().endsWith(`@${MANAGED_CUSTOMER_EMAIL_DOMAIN}`);
}

export function customerContactEmail(email: string) {
  return isManagedCustomerEmail(email) ? "" : email;
}

export function removedCustomerUsername(userId: string) {
  return `${REMOVED_CUSTOMER_USERNAME_PREFIX}${userId}`.slice(0, 80);
}

export function isRemovedCustomerUsername(username: string | null | undefined) {
  return Boolean(username?.startsWith(REMOVED_CUSTOMER_USERNAME_PREFIX));
}

export function customerPortalUsernameIsAllowed(username: string) {
  return /^[a-z0-9][a-z0-9._-]{2,79}$/.test(username) && !isRemovedCustomerUsername(username);
}

export function removedCustomerEmail(userId: string) {
  return `removed+${userId}@${MANAGED_CUSTOMER_EMAIL_DOMAIN}`;
}
