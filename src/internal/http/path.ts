import type { RouteParams } from "../shared/types";

import { decodeComponent } from "../shared/utils";

export interface PathMatcher {
  end: boolean;
  expression: RegExp;
  keys: string[];
  path: string;
}

export interface PathMatch {
  matchedPath: string;
  params: RouteParams;
}

const ESCAPE_PATTERN = /[|\\{}()[\]^$+?.]/g;

export function normalizePath(path: string): string {
  if (path === "" || path === "/") {
    return "/";
  }

  const normalized = `/${path}`.replace(/\/+/g, "/");
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

export function compilePath(path: string, end: boolean): PathMatcher {
  const normalized = normalizePath(path);

  if (normalized === "/*" || normalized === "/*wildcard" || normalized === "/*rest") {
    return {
      end,
      expression: end ? /^\/(.*)?$/ : /^\//,
      keys: ["wildcard"],
      path: normalized,
    };
  }

  if (normalized === "/") {
    return {
      end,
      expression: end ? /^\/?$/ : /^\//,
      keys: [],
      path: normalized,
    };
  }

  const keys: string[] = [];
  const segments = normalized.split("/").filter(Boolean);
  let pattern = "^";

  for (const segment of segments) {
    pattern += "/";

    if (segment === "*") {
      keys.push("wildcard");
      pattern += "(.*)";
      break;
    }

    if (segment.startsWith("*")) {
      keys.push(segment.slice(1) || "wildcard");
      pattern += "(.*)";
      break;
    }

    if (segment.startsWith(":")) {
      keys.push(segment.slice(1));
      pattern += "([^/]+)";
      continue;
    }

    pattern += segment.replace(ESCAPE_PATTERN, "\\$&");
  }

  pattern += end ? "/?$" : "(?:/|$)";

  return {
    end,
    expression: new RegExp(pattern),
    keys,
    path: normalized,
  };
}

export function matchPath(matcher: PathMatcher, pathname: string): PathMatch | null {
  const match = matcher.expression.exec(pathname);

  if (!match) {
    return null;
  }

  const params: RouteParams = {};

  matcher.keys.forEach((key, index) => {
    const value = match[index + 1];
    if (value !== undefined) {
      params[key] = decodeComponent(value);
    }
  });

  const matchedPath = stripTrailingSlash(match[0]) || "/";
  return { matchedPath, params };
}

export function stripTrailingSlash(value: string): string {
  if (value === "/") {
    return value;
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function consumePath(pathname: string, matchedPath: string): string {
  if (matchedPath === "/") {
    return pathname;
  }

  const stripped = stripTrailingSlash(matchedPath);
  const remainder = pathname.slice(stripped.length);
  return remainder === "" ? "/" : remainder;
}

export function joinPaths(baseUrl: string, path: string): string {
  if (path === "/" || path === "") {
    return baseUrl || "";
  }

  if (!baseUrl || baseUrl === "/") {
    return normalizePath(path);
  }

  return normalizePath(`${baseUrl}/${path}`);
}
