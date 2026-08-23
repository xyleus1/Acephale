import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { imapMessageExternalId, imapThreadExternalId, parseMessageReferences } from "../src/lib/imap-identifiers";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const original = "<root@example.test>";
const reply = "<reply@example.test>";
assert.deepEqual(parseMessageReferences(`${original} ${reply}`), [original, reply]);
assert.equal(
  imapThreadExternalId({ accountId: "acct-1", messageId: original, subject: "RFQ" }),
  imapThreadExternalId({ accountId: "acct-1", inReplyTo: original, references: original, subject: "Re: RFQ" }),
);
assert.notEqual(
  imapThreadExternalId({ accountId: "acct-1", messageId: original }),
  imapThreadExternalId({ accountId: "acct-2", messageId: original }),
);
assert.equal(
  imapMessageExternalId("acct-1", original, Buffer.from("one")),
  imapMessageExternalId("acct-1", original, Buffer.from("two")),
);

const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260822000700_gmail_app_password_accounts/migration.sql");
const action = read("src/app/dashboard/settings/email/actions.ts");
const form = read("src/components/gmail-app-password-form.tsx");
const connection = read("src/lib/gmail-app-password.ts");
const sync = read("src/lib/imap-sync.ts");
const sender = read("src/lib/gmail-send.ts");
const cron = read("src/app/api/cron/gmail-sync/route.ts");
const supplierProvider = read("src/lib/supply-os/supplier-email-provider.ts");
const supplierCommunication = read("src/lib/supply-os/supplier-communication-persistence.ts");
const supplierReplies = read("src/lib/supply-os/supplier-reply-persistence.ts");
const productionVerification = read("scripts/sql/production-verification/20260822000700_gmail_app_password_accounts.sql");
const settingsPage = read("src/app/dashboard/settings/email/page.tsx");

assert.match(schema, /credentialSecret\s+String\?/);
assert.match(schema, /rfcMessageId\s+String\?/);
assert.match(migration, /ADD COLUMN "credentialSecret" TEXT/);
assert.match(migration, /ADD COLUMN "rfcMessageId" TEXT/);
assert.match(action, /requireEmailAccountAdminSession\(\)/);
assert.match(action, /verifyGmailAppPasswordConnection/);
assert.match(action, /encryptSecret\(appPassword\)/);
assert.ok(
  action.indexOf("encryptSecret(appPassword)")
    < action.indexOf("const verified = await verifyGmailAppPasswordConnection"),
  "Encryption configuration must be checked before contacting Gmail",
);
assert.match(action, /sendEnabled: false/);
assert.match(action, /isDefaultSender: false/);
assert.match(form, /type="password"/);
assert.match(form, /Use a newly generated app password/);
assert.match(form, /encryptionConfigured/);
assert.match(form, /disabled=\{busy \|\| !encryptionConfigured\}/);
assert.doesNotMatch(form, /value=\{.*appPassword/);
assert.match(connection, /host: GMAIL_SMTP_HOST/);
assert.match(connection, /port: GMAIL_SMTP_PORT/);
assert.match(connection, /requireTLS: true/);
assert.match(connection, /host: GMAIL_IMAP_HOST/);
assert.match(connection, /secure: true/);
assert.match(connection, /isEncryptedSecret\(account\.credentialSecret\)/);
assert.match(sync, /officeId: input\.officeId/);
assert.match(sync, /MAX_MESSAGES_PER_SYNC = 200/);
assert.match(sender, /account\.provider === GMAIL_APP_PASSWORD_PROVIDER/);
assert.match(cron, /\["GMAIL", "GMAIL_APP_PASSWORD"\]/);
assert.match(supplierProvider, /messageId: cleanHeader\(input\.rfcMessageId\)/);
assert.match(supplierProvider, /account\?\.provider === GMAIL_APP_PASSWORD_PROVIDER/);
assert.match(supplierProvider, /header: \{ "Message-ID": input\.rfcMessageId \}/);
assert.match(supplierCommunication, /\.\.\.CONNECTED_GMAIL_ACCOUNT_FILTER/);
assert.match(supplierReplies, /\.\.\.CONNECTED_GMAIL_ACCOUNT_FILTER/);
assert.match(productionVerification, /BEGIN READ ONLY/);
assert.match(productionVerification, /"credentialSecret" NOT LIKE 'enc:v1:%'/);
assert.match(settingsPage, /isSecretEncryptionConfigured\(\)/);

for (const source of [migration, action, form, connection, sync, sender, cron, supplierProvider, supplierCommunication, supplierReplies, productionVerification]) {
  assert.equal(source.includes("\u2014"), false, "Changed email-account files must not contain U+2014");
}

console.log("gmail app-password account contracts passed");
