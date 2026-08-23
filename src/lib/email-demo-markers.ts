export const DEMO_EMAIL_CLASSIFICATION = "DEMO_TEST_ONLY";
export const DEMO_EMAIL_THREAD_MARKER = "DEMO_TEST_ONLY";

export function isDemoEmailMessageId(messageId: string | null | undefined) {
  return /^<derya-demo-[a-f0-9]{32}@app\.derya\.ai>$/.test(messageId?.trim() ?? "");
}
