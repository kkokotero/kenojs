import type { HostPattern } from "../shared/types";

interface HostMatcher {
  pattern: HostPattern;
  test: (value: string) => boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((segment) => escapeRegExp(segment))
    .join(".*");

  return new RegExp(`^${source}$`, "i");
}

export function compileHostMatcher(pattern: HostPattern): HostMatcher {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const matchers = patterns.map((entry) => {
    if (entry instanceof RegExp) {
      return entry;
    }

    return patternToRegExp(entry.toLowerCase());
  });

  return {
    pattern,
    test: (value: string) => matchers.some((matcher) => matcher.test(value)),
  };
}
