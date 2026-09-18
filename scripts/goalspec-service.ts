import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve, type Bootstrap } from "../services/goalspec-runtime/host";

async function main() {
  const [bootstrapPath, artifactDirectory] = process.argv.slice(2);
  if (!bootstrapPath || !artifactDirectory) throw new Error("Usage: goalspec-service <trusted-bootstrap-module> <artifact-directory>");
  const gatewayUrl = process.env.GOALSPEC_GATEWAY_URL;
  const token = process.env.GOALSPEC_GATEWAY_TOKEN;
  if (!gatewayUrl || !token) throw new Error("Configure gateway credentials in the process environment");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const lifetime = setTimeout(stop, 24 * 60 * 60 * 1000);
  try {
    const imported = await import(pathToFileURL(resolve(bootstrapPath)).href);
    const bootstrap = (imported.build ? imported : imported.default) as Bootstrap;
    if (typeof bootstrap.build !== "function") throw new Error("Bootstrap must export build(context)");
    await serve(bootstrap, { gatewayUrl, token, artifactDirectory, signal: controller.signal });
  } finally {
    clearTimeout(lifetime);
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Research service failed"); process.exitCode = 1; });
