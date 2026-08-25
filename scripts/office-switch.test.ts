import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import {
  listSwitchableOffices,
  switchOffice,
} from "../src/lib/office-switch";
import type { SessionPayload } from "../src/lib/auth";

const operatorSession: SessionPayload = {
  userId: "dreamz-user",
  officeId: "dreamz",
  email: " MERT@USEDERYA.COM ",
  role: "ADMIN",
  canViewWholeOffice: true,
  accessKind: "operator",
};

function mockClient(user: {
  findMany: (...args: never[]) => Promise<unknown>;
  findFirst: (...args: never[]) => Promise<unknown>;
}) {
  return { user } as unknown as Pick<PrismaClient, "user">;
}

async function main() {
  const switchableOffices = await listSwitchableOffices(operatorSession, {
    client: mockClient({
      findMany: async () => [
        {
          id: "maneks-user",
          officeId: "maneks",
          createdAt: new Date("2026-02-01T00:00:00.000Z"),
          office: {
            name: "Maneks",
            createdAt: new Date("2026-02-01T00:00:00.000Z"),
          },
        },
        {
          id: "dreamz-user",
          officeId: "dreamz",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          office: {
            name: "Dreamz",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      ],
      findFirst: async () => null,
    }),
  });
  assert.deepEqual(switchableOffices, [
    {
      officeId: "dreamz",
      officeName: "Dreamz",
      userId: "dreamz-user",
      isCurrent: true,
    },
    {
      officeId: "maneks",
      officeName: "Maneks",
      userId: "maneks-user",
      isCurrent: false,
    },
  ]);

  const customerSession: SessionPayload = {
    ...operatorSession,
    role: "CUSTOMER",
    accessKind: "customer",
  };
  const customerOffices = await listSwitchableOffices(customerSession, {
    client: mockClient({
      findMany: async () => {
        throw new Error("customer sessions must not query switchable offices");
      },
      findFirst: async () => null,
    }),
  });
  assert.deepEqual(customerOffices, []);
  assert.deepEqual(
    await switchOffice(customerSession, "maneks", {
      client: mockClient({
        findMany: async () => [],
        findFirst: async () => {
          throw new Error("customer sessions must not query target offices");
        },
      }),
    }),
    { ok: false, reason: "not_allowed" },
  );

  const denied = await switchOffice(operatorSession, "maneks", {
    client: mockClient({
      findMany: async () => [],
      findFirst: async () => null,
    }),
  });
  assert.deepEqual(denied, { ok: false, reason: "not_allowed" });

  let issuedUser: unknown = null;
  const switched = await switchOffice(operatorSession, "maneks", {
    client: mockClient({
      findMany: async () => [],
      findFirst: async () => ({
        id: "maneks-user",
        email: "mert@usederya.com",
        officeId: "maneks",
        role: "MANAGER",
        canViewWholeOffice: false,
      }),
    }),
    issueSession: async (user) => {
      issuedUser = user;
    },
  });
  assert.deepEqual(switched, {
    ok: true,
    userId: "maneks-user",
    officeId: "maneks",
    role: "MANAGER",
  });
  assert.deepEqual(issuedUser, {
    id: "maneks-user",
    email: "mert@usederya.com",
    officeId: "maneks",
    role: "MANAGER",
    canViewWholeOffice: false,
  });

  const authSource = readFileSync("src/lib/auth.ts", "utf8");
  const orderBy = 'orderBy: [{ office: { createdAt: "asc" } }, { createdAt: "asc" }]';
  assert.equal(authSource.split(orderBy).length - 1, 2);
  assert.match(authSource, /await issueSessionCookie\(\{ \.\.\.user, accessKind: "operator" \}\)/);
  assert.equal(
    [authSource, readFileSync("src/lib/office-switch.ts", "utf8")].some((source) => source.includes("\u2014")),
    false,
    "office switch code must not contain U+2014",
  );

  console.log("office-switch: all assertions passed");
}

void main();
