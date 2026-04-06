import type { KenoApplication } from "../http/application";

import { resolveWorkerEntryUrl } from "./worker-runtime";

export interface ThreadBootstrapContext {
  entryUrl: string;
  mode: "capture-app";
}

const CONTEXT_SYMBOL = Symbol.for("keno.thread-bootstrap.context");
const REGISTRY_SYMBOL = Symbol.for("keno.thread-bootstrap.apps");

function getRegistry(): Map<string, KenoApplication> {
  const scope = globalThis as Record<PropertyKey, unknown>;
  const existing = scope[REGISTRY_SYMBOL];

  if (existing instanceof Map) {
    return existing as Map<string, KenoApplication>;
  }

  const registry = new Map<string, KenoApplication>();
  scope[REGISTRY_SYMBOL] = registry;
  return registry;
}

export function consumeThreadBootstrapApp(entry: string | URL): KenoApplication | undefined {
  const key = resolveWorkerEntryUrl(entry);
  const registry = getRegistry();
  const application = registry.get(key);

  if (application) {
    registry.delete(key);
  }

  return application;
}

export function getThreadBootstrapContext(): ThreadBootstrapContext | undefined {
  const scope = globalThis as Record<PropertyKey, unknown>;
  return scope[CONTEXT_SYMBOL] as ThreadBootstrapContext | undefined;
}

export function registerThreadBootstrapApp(entry: string | URL, application: KenoApplication): void {
  getRegistry().set(resolveWorkerEntryUrl(entry), application);
}

export function setThreadBootstrapContext(context?: ThreadBootstrapContext): void {
  const scope = globalThis as Record<PropertyKey, unknown>;

  if (!context) {
    delete scope[CONTEXT_SYMBOL];
    return;
  }

  scope[CONTEXT_SYMBOL] = context;
}
