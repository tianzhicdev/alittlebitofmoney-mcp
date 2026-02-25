#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { CatalogManager } from "./catalog.js";
import { AlbomHttpClient, type L402Handler } from "./httpClient.js";
import { L402TokenCache } from "./l402.js";
import { NwcWallet } from "./wallet.js";
import { AlbomToolRegistry } from "./tools/registry.js";
import { toErrorMessage } from "./utils.js";

const SERVER_NAME = "alittlebitofmoney-mcp";
const SERVER_VERSION = "1.0.0";

async function main(): Promise<void> {
  const config = loadConfig();

  const catalogManager = new CatalogManager({
    baseUrl: config.baseUrl,
    timeoutMs: config.httpTimeoutMs,
    ttlMs: config.catalogTtlMs
  });

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {
          listChanged: true
        }
      }
    }
  );

  // Mode A: NWC wallet for auto-paying L402 invoices
  let wallet: NwcWallet | undefined;
  let l402Handler: L402Handler | undefined;

  if (config.paymentMode === "nwc" && config.nwcUrl) {
    wallet = new NwcWallet({ nwcUrl: config.nwcUrl });
    l402Handler = {
      async handlePaymentRequired(challenge) {
        const result = await wallet!.payInvoice(challenge.invoice);
        return { preimage: result.preimage };
      }
    };
    console.error(`[${SERVER_NAME}] NWC wallet configured — L402 auto-pay enabled`);
  }

  // L402 token cache (used by Mode C for macaroon caching, and lightweight enough to always create)
  const l402TokenCache = new L402TokenCache();
  l402TokenCache.startCleanup();

  const httpClient = new AlbomHttpClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    l402Handler,
    timeoutMs: config.httpTimeoutMs,
    maxRetries: config.maxRetries
  });

  const registry = new AlbomToolRegistry({
    config,
    server,
    catalogProvider: {
      getState: (options) => catalogManager.getState(options),
      snapshot: () => catalogManager.snapshot()
    },
    httpClient,
    l402TokenCache
  });

  if (config.paymentMode === "bearer") {
    console.error(`[${SERVER_NAME}] bearer token configured — direct API access`);
  } else if (config.paymentMode === "l402_passthrough") {
    console.error(`[${SERVER_NAME}] no auth configured — L402 passthrough mode (tools will return invoices)`);
  }

  await registry.initialize();

  const refreshTimer = setInterval(async () => {
    try {
      await registry.syncTools({
        forceRefresh: true,
        emitNotification: true
      });
    } catch (error) {
      console.error(`[${SERVER_NAME}] catalog refresh failed: ${toErrorMessage(error)}`);
    }
  }, config.catalogTtlMs);

  refreshTimer.unref();

  const cleanup = async (): Promise<void> => {
    clearInterval(refreshTimer);
    registry.dispose();
    l402TokenCache.dispose();
    wallet?.dispose();
    try {
      await server.close();
    } catch {
      // Ignore close failures on shutdown.
    }
  };

  process.once("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal error: ${toErrorMessage(error)}`);
  process.exit(1);
});
