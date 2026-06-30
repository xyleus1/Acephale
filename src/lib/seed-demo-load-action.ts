"use server";

export async function seedDemoLoad(): Promise<{ ok: true; jobId: string; reference: string; created: boolean } | { error: string }> {
  return {
    error: "Legacy demo seed is disabled. Use `npm run demo:video-loads -- --apply` from the repo to reset the two Inbox video demo loads.",
  };
}
