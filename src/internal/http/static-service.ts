import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type {
  NextFunction,
  RequestHandler,
  StaticMiddlewareOptions,
} from "../shared/types";
import type { KenoRequest } from "./request";
import type { KenoResponse } from "./response";

import { HttpError } from "../shared/errors";
import { filePathToMime } from "../shared/media";
import { parseSize } from "../shared/utils";
import { stripTrailingSlash } from "./path";

export const STATIC_SERVICE_SYMBOL = Symbol("keno.static-service");
const MAX_CACHED_SMALL_FILES = 128;
const SMALL_FILE_CACHE_LIMIT = 64 * 1024;

interface CachedFileEntry {
  buffer: Buffer;
  mtimeMs: number;
  size: number;
}

type StaticContext = {
  mountPath: string;
  pathname: string;
};

export interface StaticService {
  handle(
    request: KenoRequest,
    response: KenoResponse,
    next: NextFunction,
    context: StaticContext,
  ): Promise<void>;
}

type StaticMiddlewareHandler = RequestHandler & {
  [STATIC_SERVICE_SYMBOL]?: StaticService;
};

export function createStaticService(
  root: string,
  options: StaticMiddlewareOptions = {},
): StaticService {
  const absoluteRoot = resolve(root);
  const {
    cacheControl = true,
    dotfiles = "ignore",
    etag = true,
    fallthrough = true,
    immutable = false,
    index = "index.html",
    lastModified = true,
  } = options;
  const maxAge = options.maxAge === undefined ? 0 : parseSize(options.maxAge, 0);
  const cacheControlValue = cacheControl
    ? immutable && maxAge > 0
      ? `public, max-age=${Math.floor(maxAge / 1000)}, immutable`
      : `public, max-age=${Math.floor(maxAge / 1000)}`
    : undefined;
  const smallFileCache = new Map<string, CachedFileEntry>();

  return {
    async handle(request, response, next, context): Promise<void> {
      const relativePath = relativePathForRequest(context.pathname, context.mountPath);
      const decodedPath = safeDecode(relativePath);

      if (decodedPath === undefined) {
        if (fallthrough) {
          await next();
          return;
        }

        throw new HttpError(400, "Malformed static asset path");
      }

      if (shouldBlockDotfile(decodedPath, dotfiles)) {
        if (dotfiles === "deny") {
          throw new HttpError(403, "Forbidden static asset path");
        }

        if (fallthrough) {
          await next();
          return;
        }

        throw new HttpError(404, "Static asset not found");
      }

      const assetPath = resolve(absoluteRoot, `.${decodedPath}`);

      if (!isSafeSubpath(absoluteRoot, assetPath)) {
        if (fallthrough) {
          await next();
          return;
        }

        throw new HttpError(403, "Forbidden static asset path");
      }

      const details = await stat(assetPath).catch(() => undefined);
      const finalPath =
        details?.isDirectory() && index !== false
          ? resolve(assetPath, index)
          : assetPath;
      const finalDetails = finalPath === assetPath ? details : await stat(finalPath).catch(() => undefined);

      if (!finalDetails?.isFile()) {
        if (fallthrough) {
          await next();
          return;
        }

        throw new HttpError(404, "Static asset not found");
      }

      if (cacheControlValue) {
        response.set("cache-control", cacheControlValue);
      }

      const buffer = await getSmallFileBuffer(smallFileCache, finalPath, finalDetails.mtimeMs, finalDetails.size);
      const sendFileOptions = {
        cacheControl: false,
        etag,
        lastModified,
        stat: {
          mtime: finalDetails.mtime,
          mtimeMs: finalDetails.mtimeMs,
          size: finalDetails.size,
        },
      };
      const contentType = filePathToMime(finalPath);

      await response.sendFile(
        finalPath,
        {
          ...sendFileOptions,
          ...(buffer ? { buffer } : {}),
          ...(contentType ? { contentType } : {}),
        },
      );
    },
  };
}

export function createStaticHandler(
  root: string,
  options: StaticMiddlewareOptions = {},
): RequestHandler {
  const service = createStaticService(root, options);
  const handler = (async (request, response, next) => {
    const mountPath = request.routePath
      ? `${request.baseUrl}${request.routePath === "/" ? "" : request.routePath}`
      : request.baseUrl;

    await service.handle(request, response, next, {
      mountPath: mountPath || "/",
      pathname: request.path,
    });
  }) as StaticMiddlewareHandler;

  Object.defineProperty(handler, STATIC_SERVICE_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: service,
    writable: false,
  });

  return handler;
}

export function getStaticService(handler: RequestHandler): StaticService | undefined {
  return (handler as StaticMiddlewareHandler)[STATIC_SERVICE_SYMBOL];
}

export function matchesStaticMount(pathname: string, mountPath: string): boolean {
  if (mountPath === "/") {
    return pathname.startsWith("/");
  }

  if (pathname === mountPath) {
    return true;
  }

  return pathname.startsWith(mountPath) && pathname.charCodeAt(mountPath.length) === 47;
}

function relativePathForRequest(pathname: string, mountPath: string): string {
  const normalizedMount = stripTrailingSlash(mountPath) || "/";

  if (normalizedMount === "/" || !pathname.startsWith(normalizedMount)) {
    return pathname;
  }

  const relative = pathname.slice(normalizedMount.length);
  return relative === "" ? "/" : relative;
}

function safeDecode(value: string): string | undefined {
  if (!value.includes("%")) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function shouldBlockDotfile(pathname: string, mode: "allow" | "deny" | "ignore"): boolean {
  if (mode === "allow" || !pathname.includes(".")) {
    return false;
  }

  let segmentStart = 0;

  for (let index = 0; index <= pathname.length; index += 1) {
    const char = pathname[index];

    if (char !== "/" && char !== undefined) {
      continue;
    }

    if (pathname[segmentStart] === "." && index - segmentStart > 0) {
      const segment = pathname.slice(segmentStart, index);

      if (segment !== "." && segment !== "..") {
        return true;
      }
    }

    segmentStart = index + 1;
  }

  return false;
}

function isSafeSubpath(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function getSmallFileBuffer(
  cache: Map<string, CachedFileEntry>,
  pathname: string,
  mtimeMs: number,
  size: number,
): Promise<Buffer | undefined> {
  if (size > SMALL_FILE_CACHE_LIMIT) {
    return undefined;
  }

  const cached = cache.get(pathname);

  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    cache.delete(pathname);
    cache.set(pathname, cached);
    return cached.buffer;
  }

  const buffer = await readFile(pathname);

  if (buffer.byteLength !== size) {
    return buffer;
  }

  cache.set(pathname, {
    buffer,
    mtimeMs,
    size,
  });

  if (cache.size > MAX_CACHED_SMALL_FILES) {
    const firstKey = cache.keys().next().value;

    if (firstKey) {
      cache.delete(firstKey);
    }
  }

  return buffer;
}
