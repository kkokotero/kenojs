import type { CookieOptions } from "./types";

export function parseCookies(headerValue: string | undefined): Readonly<Record<string, string>> {
  if (!headerValue) {
    return {};
  }

  const cookies: Record<string, string> = {};

  for (const entry of headerValue.split(";")) {
    const [rawName, ...valueParts] = entry.trim().split("=");

    if (!rawName) {
      continue;
    }

    const value = valueParts.join("=");
    cookies[decodeURIComponent(rawName)] = decodeURIComponent(value);
  }

  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${capitalize(options.sameSite)}`);
  }

  return parts.join("; ");
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}
