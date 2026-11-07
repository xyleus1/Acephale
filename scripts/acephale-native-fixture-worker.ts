import { NativeGateway } from "../services/acephale-runtime/gateway-client";

async function main() {
  const gateway = new NativeGateway(process.env.ACEPHALE_GATEWAY_URL!, process.env.ACEPHALE_GATEWAY_TOKEN!);
  for (let turn = 0; turn < 2; turn++) {
    let boundary: { runId: string; boundaryId: string } | null = null;
    while (!boundary) boundary = await gateway.request("/next", {});
    const response = turn === 0 ? { role: "assistant", content: null, tool_calls: [{ id: "create-1", name: "create_task", arguments: { user_id: "user_1", title: "Important Meeting" }, requestor: "assistant" }] }
      : { role: "assistant", content: "The task was created successfully.", tool_calls: null };
    await gateway.request("/respond", { ...boundary, response });
  }
}
void main();
