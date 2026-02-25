import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  parseL402Challenge,
  buildL402Authorization,
  paymentHashFromPreimage,
  L402TokenCache
} from "../src/l402.js";

describe("parseL402Challenge", () => {
  it("parses standard L402 challenge with macaroon and body data", () => {
    const headers = {
      "www-authenticate": 'L402 macaroon="mac_abc123", invoice="lnbc100n"'
    };
    const body = { payment_hash: "ph_001", amount_sats: 30 };

    const result = parseL402Challenge(headers, body);
    expect(result).toEqual({
      macaroon: "mac_abc123",
      invoice: "lnbc100n",
      paymentHash: "ph_001",
      amountSats: 30
    });
  });

  it("parses simplified token= form", () => {
    const headers = {
      "www-authenticate": 'L402 token="mac_simple"'
    };
    const body = { invoice: "lnbc200n", payment_hash: "ph_002", amount_sats: 50 };

    const result = parseL402Challenge(headers, body);
    expect(result).toEqual({
      macaroon: "mac_simple",
      invoice: "lnbc200n",
      paymentHash: "ph_002",
      amountSats: 50
    });
  });

  it("strips trailing colon from macaroon (preimage placeholder)", () => {
    const headers = {
      "www-authenticate": 'L402 macaroon="mac_test:"'
    };
    const body = { invoice: "lnbc300n", payment_hash: "ph_003", amount_sats: 10 };

    const result = parseL402Challenge(headers, body);
    expect(result?.macaroon).toBe("mac_test");
  });

  it("returns undefined when no WWW-Authenticate header", () => {
    const result = parseL402Challenge({}, {});
    expect(result).toBeUndefined();
  });

  it("returns undefined when WWW-Authenticate is not L402", () => {
    const headers = { "www-authenticate": "Bearer realm=test" };
    const result = parseL402Challenge(headers, {});
    expect(result).toBeUndefined();
  });

  it("returns undefined when no macaroon found", () => {
    const headers = { "www-authenticate": "L402 foo=bar" };
    const result = parseL402Challenge(headers, { invoice: "lnbc" });
    expect(result).toBeUndefined();
  });

  it("returns undefined when no invoice found", () => {
    const headers = { "www-authenticate": 'L402 macaroon="mac"' };
    const result = parseL402Challenge(headers, {});
    expect(result).toBeUndefined();
  });

  it("handles non-record body", () => {
    const headers = {
      "www-authenticate": 'L402 macaroon="mac", invoice="lnbc"'
    };
    const result = parseL402Challenge(headers, "not an object");
    expect(result).toEqual({
      macaroon: "mac",
      invoice: "lnbc",
      paymentHash: "",
      amountSats: 0
    });
  });
});

describe("buildL402Authorization", () => {
  it("builds correct authorization header value", () => {
    const result = buildL402Authorization("mac_abc", "preimage_xyz");
    expect(result).toBe("L402 mac_abc:preimage_xyz");
  });
});

describe("paymentHashFromPreimage", () => {
  it("computes SHA256 of the preimage bytes", () => {
    // Known test vector: SHA256 of all-zero 32 bytes
    const preimage = "00".repeat(32);
    const hash = paymentHashFromPreimage(preimage);
    // SHA256 of 32 zero bytes
    expect(hash).toBe("66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925");
  });
});

describe("L402TokenCache", () => {
  let cache: L402TokenCache;

  beforeEach(() => {
    cache = new L402TokenCache({ maxEntries: 5, defaultTtlMs: 1000 });
  });

  afterEach(() => {
    cache.dispose();
  });

  it("stores and retrieves entries", () => {
    cache.set({
      macaroon: "mac_1",
      invoice: "lnbc_1",
      paymentHash: "ph_1",
      amountSats: 10
    });

    const entry = cache.get("ph_1");
    expect(entry).toBeDefined();
    expect(entry?.macaroon).toBe("mac_1");
    expect(entry?.invoice).toBe("lnbc_1");
    expect(entry?.amountSats).toBe(10);
  });

  it("returns undefined for missing entries", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("expires entries after TTL", async () => {
    cache = new L402TokenCache({ defaultTtlMs: 50 });
    cache.set({
      macaroon: "mac_exp",
      invoice: "lnbc_exp",
      paymentHash: "ph_exp",
      amountSats: 5
    });

    expect(cache.get("ph_exp")).toBeDefined();

    await new Promise((r) => setTimeout(r, 100));

    expect(cache.get("ph_exp")).toBeUndefined();
  });

  it("evicts oldest entry when at capacity", () => {
    for (let i = 0; i < 5; i++) {
      cache.set({
        macaroon: `mac_${i}`,
        invoice: `lnbc_${i}`,
        paymentHash: `ph_${i}`,
        amountSats: i
      });
    }
    expect(cache.size).toBe(5);

    // Adding a 6th should evict the first
    cache.set({
      macaroon: "mac_5",
      invoice: "lnbc_5",
      paymentHash: "ph_5",
      amountSats: 5
    });

    expect(cache.size).toBe(5);
    expect(cache.get("ph_0")).toBeUndefined();
    expect(cache.get("ph_5")).toBeDefined();
  });

  it("purgeExpired removes stale entries", async () => {
    cache = new L402TokenCache({ defaultTtlMs: 50 });
    cache.set({
      macaroon: "mac_stale",
      invoice: "lnbc_stale",
      paymentHash: "ph_stale",
      amountSats: 1
    });

    await new Promise((r) => setTimeout(r, 100));

    cache.set({
      macaroon: "mac_fresh",
      invoice: "lnbc_fresh",
      paymentHash: "ph_fresh",
      amountSats: 2
    }, 10_000);

    const removed = cache.purgeExpired();
    expect(removed).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get("ph_fresh")).toBeDefined();
  });

  it("dispose clears everything", () => {
    cache.set({
      macaroon: "mac",
      invoice: "lnbc",
      paymentHash: "ph",
      amountSats: 1
    });
    cache.startCleanup();
    cache.dispose();

    expect(cache.size).toBe(0);
    expect(cache.get("ph")).toBeUndefined();
  });
});
