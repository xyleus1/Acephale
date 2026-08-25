export type EmailAccountActor = {
  role: string;
};

export function canManageEmailAccounts(actor: EmailAccountActor) {
  return actor.role === "ADMIN";
}

// Reading the office mail log stays at the access level the admin Activity area
// used before the log moved into Settings.
export function canReadMailLog(actor: EmailAccountActor) {
  return actor.role === "ADMIN" || actor.role === "MANAGER";
}
