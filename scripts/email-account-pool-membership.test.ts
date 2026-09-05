import assert from "node:assert/strict";
import { senderPoolMembership } from "../src/lib/email-account-pool";

const result = senderPoolMembership([
  {
    id: "active",
    dailySendLimit: 30,
    isActive: true,
    provider: "GMAIL",
    refreshToken: "refresh-token",
    credentialSecret: null,
    sendEnabled: true,
    sendPausedAt: null,
  },
  {
    id: "paused",
    dailySendLimit: 30,
    isActive: true,
    provider: "GMAIL",
    refreshToken: "refresh-token",
    credentialSecret: null,
    sendEnabled: true,
    sendPausedAt: new Date("2026-09-05T00:00:00Z"),
  },
  {
    id: "unmonitored",
    dailySendLimit: 30,
    isActive: true,
    provider: "GMAIL",
    refreshToken: null,
    credentialSecret: null,
    sendEnabled: true,
    sendPausedAt: null,
  },
]);

assert.deepEqual(result.monitored.map((account) => account.id), ["active", "paused"]);
assert.deepEqual(result.enabledSenders.map((account) => account.id), ["active"]);
assert.deepEqual(result.pausedBySenderProtection.map((account) => account.id), ["paused"]);
