import { isIP } from "node:net";

import * as selfsigned from "selfsigned";

import type { TemporaryTlsOptions, TemporaryTlsResult } from "../shared/types";

const DEFAULT_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;
const temporaryTlsCache = new Map<string, Promise<TemporaryTlsResult>>();

export async function createTemporaryTlsOptions(
  options: TemporaryTlsOptions = {},
): Promise<TemporaryTlsResult> {
  const normalized = normalizeTemporaryTlsOptions(options);

  if (!normalized.cache) {
    return generateTemporaryTlsOptions(normalized);
  }

  const cacheKey = JSON.stringify(normalized);
  const cached = temporaryTlsCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const generation = generateTemporaryTlsOptions(normalized);
  temporaryTlsCache.set(cacheKey, generation);

  try {
    return await generation;
  } catch (error) {
    temporaryTlsCache.delete(cacheKey);
    throw error;
  }
}

export const temporaryTls = createTemporaryTlsOptions;

export function clearTemporaryTlsCache(): void {
  temporaryTlsCache.clear();
}

async function generateTemporaryTlsOptions(
  options: NormalizedTemporaryTlsOptions,
): Promise<TemporaryTlsResult> {
  const generated = await selfsigned.generate(
    [{ name: "commonName", value: options.commonName }],
    {
      algorithm: options.algorithm,
      curve: options.curve,
      extensions: [
        {
          cA: false,
          critical: true,
          name: "basicConstraints",
        },
        {
          critical: true,
          dataEncipherment: true,
          digitalSignature: true,
          keyEncipherment: true,
          name: "keyUsage",
        },
        {
          clientAuth: true,
          critical: true,
          name: "extKeyUsage",
          serverAuth: true,
        },
        {
          altNames: options.hosts.map((host) =>
            isIP(host)
              ? {
                  ip: host,
                  type: 7 as const,
                }
              : {
                  type: 2 as const,
                  value: host,
                }),
          critical: true,
          name: "subjectAltName",
        },
      ],
      keySize: options.keySize,
      keyType: options.keyType,
      notAfterDate: new Date(Date.now() + options.days * 24 * 60 * 60 * 1000),
      notBeforeDate: new Date(Date.now() - 60_000),
      ...(options.passphrase ? { passphrase: options.passphrase } : {}),
    },
  );

  return {
    cert: generated.cert,
    commonName: options.commonName,
    fingerprint: generated.fingerprint,
    hosts: options.hosts,
    key: generated.private,
    ...(options.passphrase ? { passphrase: options.passphrase } : {}),
  };
}

type NormalizedTemporaryTlsOptions = Required<
  Pick<
    TemporaryTlsOptions,
    "algorithm" | "cache" | "commonName" | "curve" | "days" | "keySize" | "keyType"
  >
> &
  Pick<TemporaryTlsOptions, "passphrase"> & {
    hosts: readonly string[];
  };

function normalizeTemporaryTlsOptions(options: TemporaryTlsOptions): NormalizedTemporaryTlsOptions {
  const uniqueHosts = new Set<string>(DEFAULT_HOSTS);

  for (const value of options.hosts ?? []) {
    const host = normalizeHost(value);

    if (host) {
      uniqueHosts.add(host);
    }
  }

  const commonName = normalizeHost(options.commonName) ?? "localhost";
  uniqueHosts.add(commonName);

  return {
    algorithm: options.algorithm ?? "sha256",
    cache: options.cache ?? true,
    commonName,
    curve: options.curve ?? "P-256",
    days: normalizeDays(options.days),
    hosts: Array.from(uniqueHosts),
    keySize: options.keySize ?? 2048,
    keyType: options.keyType ?? "rsa",
    ...(options.passphrase ? { passphrase: options.passphrase } : {}),
  };
}

function normalizeHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDays(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 7;
  }

  return Math.max(1, Math.floor(value as number));
}
