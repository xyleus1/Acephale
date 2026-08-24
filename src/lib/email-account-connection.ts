import type { Prisma } from "@prisma/client";
import { GMAIL_APP_PASSWORD_PROVIDER } from "@/lib/gmail-app-password";

export const CONNECTED_GMAIL_ACCOUNT_FILTER = {
  OR: [
    {
      provider: "GMAIL",
      refreshToken: { not: null },
    },
    {
      provider: GMAIL_APP_PASSWORD_PROVIDER,
      credentialSecret: { not: null },
    },
  ],
} satisfies Prisma.EmailAccountWhereInput;
