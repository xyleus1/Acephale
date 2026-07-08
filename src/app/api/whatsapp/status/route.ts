import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { whatsAppProvider, whatsAppSendConfigured } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 30;

// Live WhatsApp channel health for the settings page's "Check status" button:
// provider, gateway instance state (Green API), and the last inbound stamp.
export async function GET() {
  const session = await requireSession();
  const provider = whatsAppProvider();

  const account = await prisma.emailAccount.findFirst({
    where: { officeId: session.officeId, provider: "WHATSAPP" },
    orderBy: { lastSyncAt: "desc" },
    select: { lastSyncAt: true },
  });

  let instanceState: string | null = null;
  if (provider === "greenapi") {
    const idInstance = process.env.GREEN_API_ID_INSTANCE;
    const token = process.env.GREEN_API_TOKEN;
    const baseUrl = (process.env.GREEN_API_BASE_URL ?? "https://api.green-api.com").replace(/\/+$/, "");
    if (idInstance && token) {
      try {
        const res = await fetch(`${baseUrl}/waInstance${idInstance}/getStateInstance/${token}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { stateInstance?: string } | null;
          instanceState = body?.stateInstance ?? "unknown";
        } else {
          instanceState = `error ${res.status}`;
        }
      } catch {
        instanceState = "unreachable";
      }
    } else {
      instanceState = "credentials missing";
    }
  }

  return NextResponse.json({
    provider,
    instanceState,
    sendEnabled: whatsAppSendConfigured(),
    autoRead: process.env.WHATSAPP_AUTO_READ_ENABLED === "true",
    lastInboundAt: account?.lastSyncAt?.toISOString() ?? null,
  });
}
