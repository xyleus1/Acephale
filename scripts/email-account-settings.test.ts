import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canManageEmailAccounts } from "../src/lib/email-account-policy";
import { parseGmailAppPasswordBulkInput } from "../src/lib/gmail-app-password-bulk";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260822000400_email_account_sending_config/migration.sql", "utf8");
const page = readFileSync("src/app/dashboard/settings/email/page.tsx", "utf8");
const actions = readFileSync("src/app/dashboard/settings/email/actions.ts", "utf8");
const access = readFileSync("src/lib/email-account-access.ts", "utf8");
const integrations = readFileSync("src/app/dashboard/settings/integrations/integrations-settings.tsx", "utf8");
const settingsHeader = readFileSync("src/app/dashboard/settings/settings-header.tsx", "utf8");
const emailSenderTest = readFileSync("src/components/email-sender-test.tsx", "utf8");
const connectedEmailsPage = readFileSync("src/app/dashboard/settings/connected-emails/page.tsx", "utf8");
const connectedEmailsActions = readFileSync("src/app/dashboard/settings/connected-emails/actions.ts", "utf8");
const roundTripTest = readFileSync("src/components/email-round-trip-test.tsx", "utf8");
const bulkForm = readFileSync("src/components/gmail-app-password-bulk-form.tsx", "utf8");
const bulkParser = readFileSync("src/lib/gmail-app-password-bulk.ts", "utf8");
const oauthStart = readFileSync("src/app/api/auth/gmail/start/route.ts", "utf8");
const oauthCallback = readFileSync("src/app/api/auth/gmail/callback/route.ts", "utf8");
const gmailSend = readFileSync("src/lib/gmail-send.ts", "utf8");
const gmailSync = readFileSync("src/lib/gmail-sync.ts", "utf8");
const rfqMail = readFileSync("src/lib/rfq-mail.ts", "utf8");
const supplierEmailProvider = readFileSync("src/lib/supply-os/supplier-email-provider.ts", "utf8");
const supplierCommunication = readFileSync("src/lib/supply-os/supplier-communication-persistence.ts", "utf8");
const purchaseOrderCommunication = readFileSync("src/lib/supply-os/purchase-order-communication-persistence.ts", "utf8");
const purchaseOrderFollowUp = readFileSync("src/lib/supply-os/purchase-order-followup-persistence.ts", "utf8");
const setup = readFileSync("docs/EMAIL_SETUP.md", "utf8");

assert.equal(canManageEmailAccounts({ role: "ADMIN" }), true);
assert.equal(canManageEmailAccounts({ role: "MANAGER" }), false);
assert.equal(canManageEmailAccounts({ role: "SALES" }), false);

assert.match(schema, /sendEnabled\s+Boolean\s+@default\(false\)/);
assert.match(schema, /isDefaultSender\s+Boolean\s+@default\(false\)/);
assert.match(migration, /CREATE UNIQUE INDEX "EmailAccount_officeId_default_sender_key"/);
assert.match(migration, /WHERE "isDefaultSender" = true/);

assert.match(page, /requireEmailAccountAdminSession\(\)/);
assert.match(page, /SettingsHeader active="channels"/);
assert.match(page, /<EmailAccountControls/);
assert.match(page, /<EmailSenderTest/);
assert.match(integrations, /SettingsHeader active="integrations"/);
assert.match(settingsHeader, /href="\/dashboard\/settings\/email"/);
assert.match(settingsHeader, /href="\/dashboard\/settings\/connected-emails"/);
assert.match(settingsHeader, />\s*Connected emails\s*<\/a>/);
assert.match(settingsHeader, />\s*Channels\s*<\/a>/);
assert.match(connectedEmailsPage, /requireEmailAccountAdminSession\(\)/);
assert.match(connectedEmailsPage, /SettingsHeader active="connected-emails"/);
assert.match(connectedEmailsPage, /<EmailRoundTripTest/);
assert.match(connectedEmailsPage, /<GmailAppPasswordForm/);
assert.match(connectedEmailsPage, /<GmailAppPasswordBulkForm/);
assert.match(connectedEmailsActions, /officeId: session\.officeId/);
assert.match(connectedEmailsActions, /senderId === recipientId/);
assert.match(connectedEmailsActions, /sendNewEmailFromAccount/);
assert.match(connectedEmailsActions, /syncEmailAccountInternal\(accounts\.recipient\.id, session\.officeId\)/);
assert.match(connectedEmailsActions, /sendReplyToThread/);
assert.match(connectedEmailsActions, /syncEmailAccountInternal\(accounts\.sender\.id, session\.officeId\)/);
assert.match(connectedEmailsActions, /direction: "INBOUND"/);
assert.match(roundTripTest, /"Start test"/);
assert.match(roundTripTest, /"Check delivery"/);
assert.match(roundTripTest, /"Check reply"/);
assert.match(actions, /addGmailAppPasswordAccountsBulk/);
assert.match(actions, /enableBulkEmailAccounts/);
assert.match(actions, /Promise\.all\(encryptedRows\.map/);
assert.match(actions, /sendEnabled: false/);
const bulkUpdate = actions.match(/const account = current([\s\S]*?): await prisma\.emailAccount\.create/)?.[1] ?? "";
assert.doesNotMatch(bulkUpdate, /sendEnabled: false|isDefaultSender: false/);
assert.match(actions, /id: ids\[0\],[\s\S]*provider: GMAIL_APP_PASSWORD_PROVIDER,[\s\S]*credentialSecret: \{ not: null \}/);
assert.match(bulkForm, /Connect batch/);
assert.match(bulkForm, /Enable verified/);
assert.match(bulkForm, /Derya configures the Gmail connection automatically/);
assert.match(bulkParser, /MAX_BULK_GMAIL_ACCOUNTS = 10/);

const blockInput = `
first@example.test
  display name : First Sender
  smtp user    : first@example.test
  app password : abcd efgh ijkl mnop
  smtp         : smtp.gmail.com:587
  imap         : imap.gmail.com:993

second@example.test
  display name : Second Sender
  app password : 1234 5678 90ab cdef
`;
assert.deepEqual(parseGmailAppPasswordBulkInput(blockInput), {
  rows: [
    { displayName: "First Sender", email: "first@example.test", appPassword: "abcdefghijklmnop" },
    { displayName: "Second Sender", email: "second@example.test", appPassword: "1234567890abcdef" },
  ],
  errors: [],
});
assert.deepEqual(parseGmailAppPasswordBulkInput("Display name,email,app password\nThird Sender,third@example.test,aaaabbbbccccdddd"), {
  rows: [{ displayName: "Third Sender", email: "third@example.test", appPassword: "aaaabbbbccccdddd" }],
  errors: [],
});
assert.match(parseGmailAppPasswordBulkInput("One,duplicate@example.test,aaaabbbbccccdddd\nTwo,duplicate@example.test,1111222233334444").errors.join(" "), /duplicate email address/);
assert.match(emailSenderTest, /useEffect\(\(\) => \{/);
assert.match(emailSenderTest, /accounts\.some\(\(account\) => account\.id === current\)/);
assert.match(actions, /officeId: session\.officeId/);
assert.match(actions, /where: enabled[\s\S]*isActive: true[\s\S]*provider: "GMAIL", refreshToken: \{ not: null \}/);
assert.match(actions, /provider: GMAIL_APP_PASSWORD_PROVIDER, credentialSecret: \{ not: null \}/);
assert.match(actions, /to: session\.email/);
assert.match(actions, /isDefaultSender: false/);
assert.match(access, /id: session\.userId/);
assert.match(access, /officeId: session\.officeId/);
assert.match(access, /isActive: true/);
assert.match(access, /select: \{ role: true \}/);
assert.match(oauthStart, /isEmailAccountAdminSession\(session\)/);
assert.match(oauthCallback, /isEmailAccountAdminSession\(session\)/);
assert.doesNotMatch(oauthCallback, /sendEnabled:/);
assert.doesNotMatch(oauthCallback, /isDefaultSender:/);
assert.match(gmailSend, /isActive: true, sendEnabled: true/);
assert.match(gmailSync, /isActive: false, sendEnabled: false, isDefaultSender: false/);
assert.match(rfqMail, /RFQ sender is not connected, monitored, and enabled in Email accounts/);
assert.match(rfqMail, /sendEnabled: true/);
assert.match(supplierEmailProvider, /select: \{ id: true, email: true, sendEnabled: true \}/);
assert.match(supplierEmailProvider, /if \(!account\.sendEnabled\) throw new Error\("The selected Gmail sender is disabled for sending\."\)/);
assert.match(supplierCommunication, /sendEnabled: true/);
assert.match(purchaseOrderCommunication, /sendEnabled: true/);
assert.match(purchaseOrderFollowUp, /sendEnabled: true/);
assert.match(setup, /Connecting Gmail does not enable sending automatically/);
assert.match(setup, /Do not copy Gmail refresh tokens into Bourne/);

for (const [name, source] of Object.entries({ page, actions, access, integrations, settingsHeader, emailSenderTest, connectedEmailsPage, connectedEmailsActions, roundTripTest, bulkForm, bulkParser, oauthStart, oauthCallback, gmailSend, gmailSync, rfqMail, supplierEmailProvider, supplierCommunication, purchaseOrderCommunication, purchaseOrderFollowUp, setup })) {
  assert.equal(source.includes("\u2014"), false, `${name} must not contain U+2014.`);
}

console.log("Email account settings contract passed.");
