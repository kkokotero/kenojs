const MIME_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  text: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp",
  xml: "application/xml; charset=utf-8",
};

interface AcceptEntry {
  quality: number;
  value: string;
}

export function extensionToMime(value: string): string {
  const normalized = value.replace(/^\./u, "").toLowerCase();
  return MIME_TYPES[normalized] ?? value;
}

export function filePathToMime(pathname: string): string | undefined {
  const extensionIndex = pathname.lastIndexOf(".");

  if (extensionIndex === -1 || extensionIndex === pathname.length - 1) {
    return undefined;
  }

  const extension = pathname.slice(extensionIndex + 1);
  return MIME_TYPES[extension.toLowerCase()];
}

export function stripCharset(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? value.toLowerCase();
}

export function matchesMime(actual: string, expected: string): boolean {
  const normalizedActual = stripCharset(actual);
  const normalizedExpected = stripCharset(extensionToMime(expected));

  if (normalizedExpected === "*/*" || normalizedExpected === normalizedActual) {
    return true;
  }

  const [expectedType, expectedSubtype] = normalizedExpected.split("/");
  const [actualType, actualSubtype] = normalizedActual.split("/");

  if (!expectedType || !expectedSubtype || !actualType || !actualSubtype) {
    return false;
  }

  if (expectedSubtype === "*" && expectedType === actualType) {
    return true;
  }

  return false;
}

export function negotiateMedia(headerValue: string | undefined, candidates: readonly string[]): string | false {
  return negotiateToken(headerValue, candidates, extensionToMime);
}

export function negotiateToken(
  headerValue: string | undefined,
  candidates: readonly string[],
  normalize: (value: string) => string = (value) => value.toLowerCase(),
): string | false {
  if (candidates.length === 0) {
    return false;
  }

  if (!headerValue) {
    return candidates[0] ?? false;
  }

  const accepted = parseAcceptHeader(headerValue, normalize);
  let bestAcceptedIndex = Number.POSITIVE_INFINITY;
  let bestCandidate: string | false = false;
  let bestCandidateIndex = Number.POSITIVE_INFINITY;
  let bestQuality = -1;

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const normalizedCandidate = normalize(candidate);

    for (const [acceptedIndex, entry] of accepted.entries()) {
      if (entry.quality <= 0) {
        continue;
      }

      if (matchesToken(entry.value, normalizedCandidate)) {
        if (
          entry.quality > bestQuality ||
          (entry.quality === bestQuality && acceptedIndex < bestAcceptedIndex) ||
          (
            entry.quality === bestQuality &&
            acceptedIndex === bestAcceptedIndex &&
            candidateIndex < bestCandidateIndex
          )
        ) {
          bestAcceptedIndex = acceptedIndex;
          bestCandidate = candidate;
          bestCandidateIndex = candidateIndex;
          bestQuality = entry.quality;
        }

        break;
      }
    }
  }

  return bestCandidate;
}

function parseAcceptHeader(
  headerValue: string,
  normalize: (value: string) => string,
): AcceptEntry[] {
  return headerValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawValue, ...params] = entry.split(";").map((part) => part.trim());
      const quality = params
        .find((param) => param.startsWith("q="))
        ?.slice(2);

      return {
        quality: quality ? Number.parseFloat(quality) : 1,
        value: normalize(rawValue ?? "*/*"),
      };
    })
    .sort((left, right) => right.quality - left.quality);
}

function matchesToken(accepted: string, candidate: string): boolean {
  if (accepted === "*" || accepted === "*/*" || accepted === candidate) {
    return true;
  }

  if (accepted.includes("/") && candidate.includes("/")) {
    return matchesMime(candidate, accepted);
  }

  if (accepted.startsWith(`${candidate}-`) || candidate.startsWith(`${accepted}-`)) {
    return true;
  }

  return accepted === candidate;
}
