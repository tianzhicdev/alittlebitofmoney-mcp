import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { AlbomConfig } from "../src/config.js";
import { normalizeCatalog, parseCatalog } from "../src/catalog.js";
import { buildToolState } from "../src/dedup.js";
import { AlbomHttpClient } from "../src/httpClient.js";
import type { PlannedTool, ToolState } from "../src/types.js";
import { AlbomToolExecutor } from "../src/tools/executor.js";
import { baseCatalog } from "./fixtures.js";

function makeConfig(overrides: Partial<AlbomConfig> = {}): AlbomConfig {
  return {
    baseUrl: "https://alittlebitofmoney.com",
    bearerToken: "test-token",
    toolProfile: "compact",
    includeModeration: true,
    includeEmbeddings: true,
    includeVideo: true,
    allowRawTool: false,
    catalogTtlMs: 300_000,
    httpTimeoutMs: 90_000,
    maxRetries: 0,
    maxUploadBytes: 5 * 1024 * 1024,
    ...overrides
  };
}

function makeExecutor(
  fetchFn: typeof fetch,
  configOverrides: Partial<AlbomConfig> = {}
): { executor: AlbomToolExecutor; toolState: ToolState } {
  const config = makeConfig(configOverrides);
  const catalogState = normalizeCatalog(parseCatalog(baseCatalog()));
  const toolState = buildToolState(catalogState, config);

  const httpClient = new AlbomHttpClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    timeoutMs: config.httpTimeoutMs,
    maxRetries: config.maxRetries,
    fetchFn
  });

  const executor = new AlbomToolExecutor({
    config,
    httpClient,
    getCatalogState: () => catalogState,
    refreshCatalog: async () => catalogState,
    getToolState: () => toolState
  });

  return { executor, toolState };
}

function findTool(tools: PlannedTool[], name: string): PlannedTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool;
}

describe("tool executor integration", () => {
  it("handles success 200 response", async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response(JSON.stringify({ id: "resp_1", output: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_text_generate"), {
      model: "gpt-4o-mini",
      input: "hello"
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.endpoint).toBe("/v1/responses");
    if (result.ok) {
      expect(result.price_sats).toBe(30);
    }
  });

  it("maps payment_required 402 with invoice metadata", async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          status: "payment_required",
          amount_sats: 30,
          invoice: "lnbc_test",
          payment_hash: "abc123",
          expires_in: 120
        }),
        {
          status: 402,
          headers: {
            "content-type": "application/json",
            "x-topup-url": "/topup"
          }
        }
      );
    };

    const { executor, toolState } = makeExecutor(fetchFn, { bearerToken: undefined });
    const result = await executor.execute(findTool(toolState.tools, "albom_text_generate"), {
      model: "gpt-4o-mini",
      input: "hello",
      allow_l402_quote: true
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.error.code).toBe("payment_required");
      expect(result.error.invoice).toBe("lnbc_test");
      expect(result.error.topup_url).toBe("/topup");
      expect(result.error.amount_sats).toBe(30);
    }
  });

  it("maps invalid_token 401", async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "invalid_token",
            message: "Token invalid"
          }
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_text_generate"), {
      model: "gpt-4o-mini",
      input: "hello"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error.code).toBe("invalid_token");
    }
  });

  it("supports multipart uploads from file_path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "albom-test-"));
    const filePath = join(tempDir, "audio.wav");
    await writeFile(filePath, "sample-audio-data");

    try {
      const fetchFn: typeof fetch = async (_url, init) => {
        const body = init?.body;
        expect(body).toBeInstanceOf(FormData);

        const formData = body as FormData;
        const filePart = formData.get("file");
        expect(filePart).toBeTruthy();
        expect(typeof filePart).not.toBe("string");

        if (typeof filePart !== "string") {
          const content = Buffer.from(await filePart.arrayBuffer()).toString("utf8");
          expect(content).toBe("sample-audio-data");
        }

        return new Response(JSON.stringify({ text: "ok" }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      };

      const { executor, toolState } = makeExecutor(fetchFn);
      const result = await executor.execute(findTool(toolState.tools, "albom_audio_transcribe"), {
        audio_file_path: filePath
      });

      expect(result.ok).toBe(true);
      expect(result.endpoint).toBe("/v1/audio/transcriptions");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("supports multipart uploads from base64", async () => {
    const payload = Buffer.from("base64-audio").toString("base64");

    const fetchFn: typeof fetch = async (_url, init) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);

      const formData = body as FormData;
      const filePart = formData.get("file");
      expect(filePart).toBeTruthy();
      expect(typeof filePart).not.toBe("string");

      if (typeof filePart !== "string") {
        const content = Buffer.from(await filePart.arrayBuffer()).toString("utf8");
        expect(content).toBe("base64-audio");
      }

      return new Response(JSON.stringify({ text: "ok" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_audio_transcribe"), {
      audio_file_base64: payload,
      audio_file_name: "audio.wav"
    });

    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/v1/audio/transcriptions");
  });
});
