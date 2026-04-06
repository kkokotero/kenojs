import type { HeartbeatPluginOptions } from "../shared/types";

import { definePlugin } from "./define";

export const heartbeatPlugin = definePlugin<HeartbeatPluginOptions>(async (app, options = {}) => {
  const healthPath = options.healthPath ?? "/health";
  const livePath = options.livePath ?? "/live";
  const readyPath = options.readyPath ?? "/ready";
  const startedAt = Date.now();

  const buildPayload = async (status: "ok" | "degraded") => ({
    name: options.name ?? "keno",
    startedAt: new Date(startedAt).toISOString(),
    status,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    ...(await resolveDetails(options.details)),
  });

  app.get(healthPath, async (_request, response) => {
    response.json(await buildPayload("ok"));
  });

  app.get(livePath, async (_request, response) => {
    response.json(await buildPayload("ok"));
  });

  app.get(readyPath, async (_request, response) => {
    const ready = await options.readyWhen?.() ?? true;
    const payload = await buildPayload(ready ? "ok" : "degraded");

    if (!ready) {
      response.status(503);
    }

    response.json(payload);
  });
}, {
  name: "heartbeat",
});

async function resolveDetails(
  details: HeartbeatPluginOptions["details"],
): Promise<Record<string, unknown>> {
  if (!details) {
    return {};
  }

  return typeof details === "function"
    ? await details()
    : details;
}
