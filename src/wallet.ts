import { NWCClient } from "@getalby/sdk/nwc";
import { AlbomRuntimeError } from "./errors.js";
import { toErrorMessage } from "./utils.js";

export interface NwcWalletOptions {
  nwcUrl: string;
}

export interface PayInvoiceResult {
  preimage: string;
  feesPaidMsat: number;
}

/**
 * Pay-only NWC wallet client.
 *
 * Wraps @getalby/sdk NWCClient to pay Lightning invoices via Nostr Wallet Connect.
 * Used by Mode A (auto-pay downstream L402 invoices from the user's wallet).
 */
export class NwcWallet {
  private client: NWCClient;

  public constructor(options: NwcWalletOptions) {
    const nwcUrl = options.nwcUrl.trim();
    if (!nwcUrl.startsWith("nostr+walletconnect://")) {
      throw new AlbomRuntimeError(
        "invalid_nwc_url",
        "ALBOM_NWC_URL must start with nostr+walletconnect://",
        400
      );
    }

    this.client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
  }

  /** Pay a BOLT-11 Lightning invoice. Returns the preimage on success. */
  public async payInvoice(bolt11: string): Promise<PayInvoiceResult> {
    try {
      const response = await this.client.payInvoice({ invoice: bolt11 });
      return {
        preimage: response.preimage,
        feesPaidMsat: response.fees_paid
      };
    } catch (error) {
      throw new AlbomRuntimeError(
        "payment_failed",
        `NWC payment failed: ${toErrorMessage(error)}`,
        502
      );
    }
  }

  /** Close the NWC relay connection. */
  public dispose(): void {
    try {
      this.client.close();
    } catch {
      // Ignore close errors on shutdown.
    }
  }
}
