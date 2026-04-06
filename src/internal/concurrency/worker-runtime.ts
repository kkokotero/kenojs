import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function createInlineWorkerUrl(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

export function resolveWorkerEntryUrl(entry: string | URL): string {
  if (entry instanceof URL) {
    return entry.href;
  }

  if (/^[a-z][a-z0-9+.-]*:/iu.test(entry)) {
    return new URL(entry).href;
  }

  return pathToFileURL(resolve(entry)).href;
}

export function resolveWorkerExecArgv(execArgv?: readonly string[]): string[] {
  if (execArgv) {
    return [...execArgv];
  }

  return [...process.execArgv];
}
