import { z } from "zod";

export const AUTH_SESSION_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const MAX_REQUEST_BYTES = 8_000;
const MAX_FAILED_ATTEMPTS = 5;
// Shared with the login form so both password surfaces spend one budget.
export const MAX_PASSWORD_ATTEMPTS_PER_ADDRESS = 15;
export const MAX_PASSWORD_FAILURES_PER_IDENTIFIER = 10;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const MAX_THROTTLE_ENTRIES = 5_000;
const INVALID_CREDENTIALS_ERROR = "Invalid username, email, or password.";
const THROTTLED_ERROR = "Too many sign-in attempts. Wait 15 minutes and try again.";
const UNAVAILABLE_ERROR = "Sign-in is temporarily unavailable. Try again shortly.";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(200),
}).strict();

type LoginResult = {
  officeId: string;
  role: string;
  canViewWholeOffice: boolean;
};

export type AuthSessionRouteDependencies = {
  resolveIdentifier: (identifier: string) => string;
  login: (identifier: string, password: string) => Promise<LoginResult | null>;
  sessionMaxAgeSeconds: number;
  consumePersistentAttempt: (input: { identity: string; maxAttempts: number }) => Promise<boolean>;
  persistentAttemptsExhausted: (identity: string, maxAttempts: number) => Promise<boolean>;
  now?: () => number;
};

export function passwordAddressIdentity(clientAddress: string) {
  return `login-password:${clientAddress}`;
}

export function passwordIdentifierIdentity(identifier: string) {
  return `login-password-id:${identifier}`;
}

type FailedAttempt = {
  count: number;
  firstAttemptAt: number;
};

// This throttle is per-instance best effort on serverless runtimes. The
// identifier-only key bounds per-account brute force when clients rotate
// x-forwarded-for.
const failedAttempts = new Map<string, FailedAttempt>();

async function readRequestJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return { tooLarge: true, body: null };
  }

  if (!request.body) return { tooLarge: false, body: null };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return { tooLarge: true, body: null };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { tooLarge: false, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { tooLarge: false, body: null };
  }
}

function response(body: unknown, status: number) {
  return Response.json(body, { status, headers: AUTH_SESSION_RESPONSE_HEADERS });
}

function clientIp(request: Request) {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function pruneFailedAttempts(now: number) {
  for (const [key, attempt] of failedAttempts) {
    if (now - attempt.firstAttemptAt >= THROTTLE_WINDOW_MS) {
      failedAttempts.delete(key);
    }
  }
  while (failedAttempts.size >= MAX_THROTTLE_ENTRIES) {
    const oldestKey = failedAttempts.keys().next().value;
    if (oldestKey === undefined) break;
    failedAttempts.delete(oldestKey);
  }
}

function isThrottled(key: string, now: number) {
  const attempt = failedAttempts.get(key);
  return Boolean(attempt && now - attempt.firstAttemptAt < THROTTLE_WINDOW_MS && attempt.count >= MAX_FAILED_ATTEMPTS);
}

function recordFailedAttempt(key: string, now: number) {
  const previous = failedAttempts.get(key);
  const attempt = previous && now - previous.firstAttemptAt < THROTTLE_WINDOW_MS
    ? { count: previous.count + 1, firstAttemptAt: previous.firstAttemptAt }
    : { count: 1, firstAttemptAt: now };
  failedAttempts.set(key, attempt);
  pruneFailedAttempts(now);
}

export async function handleAuthSessionPost(
  request: Request,
  dependencies: AuthSessionRouteDependencies,
) {
  const requestBody = await readRequestJson(request);
  if (requestBody.tooLarge) {
    return response({ error: "The sign-in request is too large." }, 413);
  }

  const parsed = credentialsSchema.safeParse(requestBody.body);
  if (!parsed.success) {
    return response(
      { error: parsed.error.issues[0]?.message ?? "The sign-in request is invalid." },
      400,
    );
  }

  const resolvedIdentifier = dependencies.resolveIdentifier(parsed.data.identifier);
  const now = dependencies.now?.() ?? Date.now();
  pruneFailedAttempts(now);
  const ipThrottleKey = `ip:${resolvedIdentifier}|${clientIp(request)}`;
  const identifierThrottleKey = `id:${resolvedIdentifier}`;
  if (
    isThrottled(ipThrottleKey, now)
    || isThrottled(identifierThrottleKey, now)
  ) {
    return response({ error: THROTTLED_ERROR }, 429);
  }

  // The in-memory counters above are per-instance, so this endpoint also spends
  // the persistent budget the login form uses. Without it, guessing survives an
  // instance swap.
  const clientAddress = clientIp(request);
  try {
    const withinAddressBudget = await dependencies.consumePersistentAttempt({
      identity: passwordAddressIdentity(clientAddress),
      maxAttempts: MAX_PASSWORD_ATTEMPTS_PER_ADDRESS,
    });
    if (!withinAddressBudget) {
      return response({ error: THROTTLED_ERROR }, 429);
    }
    if (await dependencies.persistentAttemptsExhausted(
      passwordIdentifierIdentity(resolvedIdentifier),
      MAX_PASSWORD_FAILURES_PER_IDENTIFIER,
    )) {
      return response({ error: THROTTLED_ERROR }, 429);
    }
  } catch {
    // Fail closed: an unmetered guess is worse than a refused sign-in.
    return response({ error: UNAVAILABLE_ERROR }, 503);
  }

  let loginResult: LoginResult | null;
  try {
    loginResult = await dependencies.login(resolvedIdentifier, parsed.data.password);
  } catch {
    return response({ error: "Unable to sign in." }, 500);
  }

  if (!loginResult) {
    recordFailedAttempt(ipThrottleKey, now);
    recordFailedAttempt(identifierThrottleKey, now);
    try {
      await dependencies.consumePersistentAttempt({
        identity: passwordIdentifierIdentity(resolvedIdentifier),
        maxAttempts: MAX_PASSWORD_FAILURES_PER_IDENTIFIER,
      });
    } catch {
      // The guess already failed, so answer it rather than losing the response
      // over accounting. The in-memory counter above still holds.
    }
    return response({ error: INVALID_CREDENTIALS_ERROR }, 401);
  }

  failedAttempts.delete(ipThrottleKey);
  failedAttempts.delete(identifierThrottleKey);
  return response({
    ok: true,
    officeId: loginResult.officeId,
    role: loginResult.role,
    canViewWholeOffice: loginResult.canViewWholeOffice,
    expiresInSeconds: dependencies.sessionMaxAgeSeconds,
  }, 200);
}
