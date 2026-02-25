import { createHash } from "node:crypto";

export interface L402CacheEntry {
  macaroon: string;
  invoice: string;
  paymentHash: string;
  amountSats: number;
  expiresAt: number;
}

export interface L402Challenge {
  macaroon: string;
  invoice: string;
  paymentHash: string;
  amountSats: number;
}

/**
 * Parse the L402 challenge from a 402 response's WWW-Authenticate header.
 * Expected format: `L402 macaroon="<macaroon>", invoice="<invoice>"`
 * Also accepts: `L402 token="<macaroon>"` (simplified form)
 */
export function parseL402Challenge(
  headers: Record<string, string>,
  body: unknown
): L402Challenge | undefined {
  const wwwAuth = headers["www-authenticate"];
  if (!wwwAuth) {
    return undefined;
  }

  const l402Match = /^L402\s+/i.exec(wwwAuth);
  if (!l402Match) {
    return undefined;
  }

  const paramStr = wwwAuth.slice(l402Match[0].length);

  let macaroon = extractParam(paramStr, "macaroon") ?? extractParam(paramStr, "token");
  if (!macaroon) {
    return undefined;
  }

  // Trim any trailing colon placeholder (L402 spec: macaroon:preimage_placeholder)
  if (macaroon.endsWith(":")) {
    macaroon = macaroon.slice(0, -1);
  }

  const bodyRecord = isRecord(body) ? body : {};

  const invoice =
    extractParam(paramStr, "invoice") ??
    asString(bodyRecord.invoice);

  const paymentHash = asString(bodyRecord.payment_hash) ?? "";
  const amountSats = asNumber(bodyRecord.amount_sats) ?? 0;

  if (!invoice) {
    return undefined;
  }

  return { macaroon, invoice, paymentHash, amountSats };
}

/**
 * Build the Authorization header value for an L402 authenticated retry.
 */
export function buildL402Authorization(macaroon: string, preimage: string): string {
  return `L402 ${macaroon}:${preimage}`;
}

/**
 * Compute payment_hash from a preimage (both hex-encoded).
 */
export function paymentHashFromPreimage(preimageHex: string): string {
  return createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex");
}

/**
 * In-memory cache for L402 tokens (macaroons) keyed by payment_hash.
 *
 * Used by Mode C to hold the macaroon between the first call (which receives
 * the 402 + macaroon) and the second call (which supplies the preimage).
 */
export class L402TokenCache {
  private readonly entries = new Map<string, L402CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  public constructor(options?: { maxEntries?: number; defaultTtlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 1000;
    this.defaultTtlMs = options?.defaultTtlMs ?? 300_000; // 5 min
  }

  /** Store a macaroon + invoice from a 402 response. */
  public set(challenge: L402Challenge, ttlMs?: number): void {
    if (this.entries.size >= this.maxEntries) {
      this.purgeExpired();
    }

    if (this.entries.size >= this.maxEntries) {
      // Still at capacity after purge — evict the oldest entry.
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(challenge.paymentHash, {
      macaroon: challenge.macaroon,
      invoice: challenge.invoice,
      paymentHash: challenge.paymentHash,
      amountSats: challenge.amountSats,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs)
    });
  }

  /** Look up a cached macaroon by payment_hash. Returns undefined if missing or expired. */
  public get(paymentHash: string): L402CacheEntry | undefined {
    const entry = this.entries.get(paymentHash);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(paymentHash);
      return undefined;
    }

    return entry;
  }

  /** Remove expired entries. */
  public purgeExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Start a periodic cleanup timer. */
  public startCleanup(intervalMs = 60_000): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => this.purgeExpired(), intervalMs);
    this.cleanupTimer.unref();
  }

  /** Stop the cleanup timer and clear all entries. */
  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.entries.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}

// --- Helpers ---

function extractParam(paramStr: string, name: string): string | undefined {
  // Match: name="value" or name=value
  const quoted = new RegExp(`${name}="([^"]*)"`, "i");
  const match = quoted.exec(paramStr);
  if (match?.[1]) {
    return match[1];
  }

  const unquoted = new RegExp(`${name}=([^,\\s]+)`, "i");
  const match2 = unquoted.exec(paramStr);
  return match2?.[1] ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
