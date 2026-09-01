import assert from "node:assert/strict";
import {
  canProvisionOffice,
  OfficeAlreadyExistsError,
  provisionOffice,
  type OfficeProvisioningClient,
  type OfficeProvisioningTransaction,
} from "../src/lib/office-provisioning";

type Office = { id: string; name: string; createdAt: Date };
type User = {
  id: string;
  officeId: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  canViewWholeOffice: boolean;
};
type Company = { id: string; officeId: string; name: string };
type Workspace = {
  id: string;
  officeId: string;
  companyId: string;
  createdByUserId: string;
  externalKey: string;
  name: string;
};
type Member = {
  officeId: string;
  workspaceId: string;
  userId: string;
  role: string;
  isActive: boolean;
};

function fakeClient() {
  let sequence = 0;
  const offices: Office[] = [];
  const users: User[] = [];
  const companies: Company[] = [];
  const workspaces: Workspace[] = [];
  const members: Member[] = [];
  let transactionCalls = 0;

  const nextId = (prefix: string) => `${prefix}-${++sequence}`;
  const client = {
    office: {
      findUnique: async ({ where }: { where: { name: string } }) =>
        offices.find((office) => office.name === where.name) ?? null,
      create: async ({ data }: { data: { name: string } }) => {
        const office = { id: nextId("office"), name: data.name, createdAt: new Date() };
        offices.push(office);
        return office;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { officeId_email: { officeId: string; email: string } } }) => {
        const user = users.find((candidate) =>
          candidate.officeId === where.officeId_email.officeId
          && candidate.email === where.officeId_email.email);
        return user ? { ...user } : null;
      },
      update: async ({ where, data }: {
        where: { id: string };
        data: {
          fullName: string;
          passwordHash: string;
          role: string;
          isActive: true;
          canViewWholeOffice: true;
        };
      }) => {
        const user = users.find((candidate) => candidate.id === where.id);
        assert.ok(user);
        Object.assign(user, data);
        return {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        };
      },
      create: async ({ data }: {
        data: {
          officeId: string;
          email: string;
          fullName: string;
          role: string;
          isActive: true;
          canViewWholeOffice: true;
          passwordHash: string;
        };
      }) => {
        const user = { id: nextId("user"), ...data };
        users.push(user);
        return {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        };
      },
    },
    company: {
      findUnique: async ({ where }: { where: { officeId_name: { officeId: string; name: string } } }) =>
        companies.find((company) =>
          company.officeId === where.officeId_name.officeId
          && company.name === where.officeId_name.name) ?? null,
      create: async ({ data }: {
        data: {
          officeId: string;
          name: string;
          status: "IN_PROGRESS";
          crmCategory: string;
          crmStage: string;
          crmPriority: string;
          crmSource: string;
        };
      }) => {
        const company = { id: nextId("company"), officeId: data.officeId, name: data.name };
        companies.push(company);
        return company;
      },
    },
    supplyWorkspace: {
      findUnique: async ({ where }: {
        where: { officeId_externalKey: { officeId: string; externalKey: string } };
      }) =>
        workspaces.find((workspace) =>
          workspace.officeId === where.officeId_externalKey.officeId
          && workspace.externalKey === where.officeId_externalKey.externalKey) ?? null,
      update: async ({ where, data }: {
        where: { id: string };
        data: {
          companyId: string;
          createdByUserId: string;
          name: string;
          status: "ACTIVE";
          archivedAt: null;
        };
      }) => {
        const workspace = workspaces.find((candidate) => candidate.id === where.id);
        assert.ok(workspace);
        Object.assign(workspace, data);
        return workspace;
      },
      create: async ({ data }: {
        data: {
          officeId: string;
          companyId: string;
          createdByUserId: string;
          externalKey: string;
          name: string;
        };
      }) => {
        const workspace = { id: nextId("workspace"), ...data };
        workspaces.push(workspace);
        return workspace;
      },
    },
    supplyWorkspaceMember: {
      upsert: async ({ where, create, update }: {
        where: { workspaceId_userId: { workspaceId: string; userId: string } };
        create: {
          officeId: string;
          workspaceId: string;
          userId: string;
          role: "OWNER";
          isActive: true;
        };
        update: { officeId: string; role: "OWNER"; isActive: true };
      }) => {
        const member = members.find((candidate) =>
          candidate.workspaceId === where.workspaceId_userId.workspaceId
          && candidate.userId === where.workspaceId_userId.userId);
        if (member) Object.assign(member, update);
        else members.push({ ...create });
        return member ?? members[members.length - 1];
      },
    },
    $transaction: async <T>(callback: (tx: OfficeProvisioningTransaction) => Promise<T>) => {
      transactionCalls += 1;
      return callback(client as OfficeProvisioningTransaction);
    },
  };

  return {
    client: client as OfficeProvisioningClient,
    offices,
    users,
    companies,
    workspaces,
    members,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

async function main() {
const fake = fakeClient();
const first = await provisionOffice(fake.client, {
  officeName: "Wens",
  admins: [{ email: "mert@usederya.com", fullName: "Mert", passwordHash: "hash-1" }],
  companyName: "Wens",
  workspaceName: "Wens Expansion",
});
assert.equal(first.createdOffice, true);
assert.equal(first.createdAdmin, true);
assert.equal(first.createdCompany, true);
assert.equal(first.createdWorkspace, true);
assert.deepEqual(first.createdAdmins, [true]);
assert.equal(fake.offices.length, 1);
assert.equal(fake.users.length, 1);
assert.equal(fake.companies.length, 1);
assert.equal(fake.workspaces.length, 1);
assert.equal(fake.members.length, 1);
assert.equal(fake.workspaces[0].externalKey, "production:primary");

const second = await provisionOffice(fake.client, {
  officeName: "Wens",
  admins: [{ email: "mert@usederya.com", fullName: "Mert", passwordHash: "hash-2" }],
  companyName: "Wens",
  workspaceName: "Wens Expansion",
});
assert.equal(second.createdOffice, false);
assert.equal(second.createdAdmin, false);
assert.equal(second.createdCompany, false);
assert.equal(second.createdWorkspace, false);
assert.deepEqual(second.createdAdmins, [false]);
assert.equal(fake.offices.length, 1);
assert.equal(fake.users.length, 1);
assert.equal(fake.companies.length, 1);
assert.equal(fake.workspaces.length, 1);
assert.equal(fake.members.length, 1);

const createOnly = fakeClient();
await provisionOffice(createOnly.client, {
  officeName: "Existing office",
  admins: [{ email: "mert@usederya.com", fullName: "Mert", passwordHash: "hash-1" }],
});
const existingCounts = [
  createOnly.users.length,
  createOnly.companies.length,
  createOnly.workspaces.length,
  createOnly.members.length,
];
await assert.rejects(
  () => provisionOffice(createOnly.client, {
    officeName: "Existing office",
    admins: [{ email: "other@usederya.com", fullName: "Other", passwordHash: "hash-2" }],
    requireNewOffice: true,
  }),
  OfficeAlreadyExistsError,
);
assert.deepEqual([
  createOnly.users.length,
  createOnly.companies.length,
  createOnly.workspaces.length,
  createOnly.members.length,
], existingCounts);

const multi = fakeClient();
const multipleAdmins = await provisionOffice(multi.client, {
  officeName: "Second office",
  admins: [
    { email: "mert@usederya.com", fullName: "Mert", passwordHash: "hash-1" },
    { email: "oguzhan@usederya.com", fullName: "Oguzhan", passwordHash: "hash-2" },
  ],
});
assert.equal(multipleAdmins.admins.length, 2);
assert.deepEqual(multipleAdmins.createdAdmins, [true, true]);
assert.equal(multi.users.every((user) => user.role === "ADMIN"), true);
assert.equal(multi.members.length, 2);
assert.equal(multi.members.every((member) => member.role === "OWNER"), true);
assert.equal(multi.workspaces[0].createdByUserId, multipleAdmins.admins[0].id);
assert.equal(multi.transactionCalls, 1);

const previousAllowed = process.env.LOGIN_ALLOWED_EMAILS;
process.env.LOGIN_ALLOWED_EMAILS = "mert@usederya.com";
const session = (overrides: Partial<{
  email: string;
  role: string;
  accessKind: "operator" | "customer";
}> = {}) => ({
  userId: "user-1",
  officeId: "office-1",
  email: "mert@usederya.com",
  role: "ADMIN",
  canViewWholeOffice: true,
  accessKind: "operator" as const,
  ...overrides,
});
assert.equal(canProvisionOffice(session()), true);
assert.equal(canProvisionOffice(session({ role: "MANAGER" })), false);
assert.equal(canProvisionOffice(session({ email: "unknown@example.com" })), false);
assert.equal(canProvisionOffice(session({ accessKind: "customer", role: "CUSTOMER" })), false);
assert.equal(canProvisionOffice(session({ email: "wens@office.derya.invalid" })), false);
if (previousAllowed === undefined) delete process.env.LOGIN_ALLOWED_EMAILS;
else process.env.LOGIN_ALLOWED_EMAILS = previousAllowed;

console.log("Office provisioning checks passed.");
}

void main();
