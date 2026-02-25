import { describe, expect, it, vi } from "vitest";
import { AlbomRuntimeError } from "../src/errors.js";

// Mock the @getalby/sdk/nwc module before importing wallet
vi.mock("@getalby/sdk/nwc", () => {
  class MockNWCClient {
    _nwcUrl: string | undefined;
    payInvoice = vi.fn();
    close = vi.fn();

    constructor(options?: { nostrWalletConnectUrl?: string }) {
      this._nwcUrl = options?.nostrWalletConnectUrl;
    }
  }

  return { NWCClient: MockNWCClient };
});

import { NwcWallet } from "../src/wallet.js";

const VALID_NWC_URL = "nostr+walletconnect://abc123?relay=wss://relay.test&secret=sec123";

describe("NwcWallet", () => {
  it("rejects invalid NWC URL", () => {
    expect(() => new NwcWallet({ nwcUrl: "https://example.com" })).toThrow(AlbomRuntimeError);
    expect(() => new NwcWallet({ nwcUrl: "https://example.com" })).toThrow("nostr+walletconnect://");
  });

  it("accepts valid NWC URL", () => {
    const wallet = new NwcWallet({ nwcUrl: VALID_NWC_URL });
    expect(wallet).toBeDefined();
    wallet.dispose();
  });

  it("payInvoice returns preimage on success", async () => {
    const wallet = new NwcWallet({ nwcUrl: VALID_NWC_URL });

    const mockClient = (wallet as unknown as { client: { payInvoice: ReturnType<typeof vi.fn> } }).client;
    mockClient.payInvoice.mockResolvedValueOnce({
      preimage: "abc123preimage",
      fees_paid: 10
    });

    const result = await wallet.payInvoice("lnbc100n1test");
    expect(result).toEqual({
      preimage: "abc123preimage",
      feesPaidMsat: 10
    });

    expect(mockClient.payInvoice).toHaveBeenCalledWith({ invoice: "lnbc100n1test" });
    wallet.dispose();
  });

  it("payInvoice wraps NWC errors as AlbomRuntimeError", async () => {
    const wallet = new NwcWallet({ nwcUrl: VALID_NWC_URL });

    const mockClient = (wallet as unknown as { client: { payInvoice: ReturnType<typeof vi.fn> } }).client;
    mockClient.payInvoice.mockRejectedValue(new Error("Insufficient balance"));

    await expect(wallet.payInvoice("lnbc_fail")).rejects.toThrow(AlbomRuntimeError);

    try {
      await wallet.payInvoice("lnbc_fail2");
    } catch (error) {
      expect(error).toBeInstanceOf(AlbomRuntimeError);
      expect((error as AlbomRuntimeError).code).toBe("payment_failed");
      expect((error as AlbomRuntimeError).message).toContain("Insufficient balance");
    }

    wallet.dispose();
  });

  it("dispose calls close on client", () => {
    const wallet = new NwcWallet({ nwcUrl: VALID_NWC_URL });
    const mockClient = (wallet as unknown as { client: { close: ReturnType<typeof vi.fn> } }).client;

    wallet.dispose();
    expect(mockClient.close).toHaveBeenCalled();
  });
});
