import { request as httpRequestFn, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AppListenOptions, KenoApplication, KenoServer } from "../src";

const testsDir = dirname(fileURLToPath(import.meta.url));

export async function startServer(
  application: KenoApplication,
  options: AppListenOptions = {},
): Promise<{ port: number; server: KenoServer }> {
  const server = application.listen({ port: 0, threaded: false, ...options });
  await server.ready();
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    server,
  };
}

export function fixturePath(name: string): string {
  return join(testsDir, "fixtures", name);
}

export function readFixture(name: string): Buffer {
  return readFileSync(fixturePath(name));
}

export async function getAvailablePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  const { port } = address;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

export function onceEvent<T extends Event>(target: EventTarget, type: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    type EventHandler = (event: Event) => void;

    const abort = () => {
      target.removeEventListener(type, handle as EventHandler);
      target.removeEventListener("error", handleError as EventHandler);
    };

    const handle = (event: Event) => {
      abort();
      resolve(event as T);
    };

    const handleError = (event: Event) => {
      abort();
      reject(event);
    };

    target.addEventListener(type, handle as EventHandler, { once: true });
    target.addEventListener("error", handleError as EventHandler, { once: true });
  });
}

export async function messageData(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Blob) {
    return await data.text();
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  return String(data);
}

export async function httpRequest(
  options: RequestOptions & { body?: string | Buffer },
): Promise<{
  body: string;
  headers: IncomingHttpHeaders;
  rawHeaders: string[];
  statusCode: number;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequestFn(options, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          body,
          headers: response.headers,
          rawHeaders: [...response.rawHeaders],
          statusCode: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}
