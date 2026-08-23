export type EmailAccountActor = {
  role: string;
};

export function canManageEmailAccounts(actor: EmailAccountActor) {
  return actor.role === "ADMIN";
}
