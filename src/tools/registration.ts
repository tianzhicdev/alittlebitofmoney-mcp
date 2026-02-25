import { z } from "zod";
import type { ToolAnnotations } from "../types.js";
import type { L402AuthCredentials, PlannedTool } from "../types.js";
import type { PaymentMode } from "../config.js";
import type { L402TokenCache } from "../l402.js";
import { paymentHashFromPreimage } from "../l402.js";
import { summarizeResult } from "../results.js";
import type { AlbomToolExecutor } from "./executor.js";

export interface RegisteredToolHandle {
  remove: () => void;
}

export interface ToolServerLike {
  registerTool: (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodRawShape;
      annotations?: ToolAnnotations;
    },
    cb: (args: unknown) => Promise<{
      structuredContent: Record<string, unknown>;
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }>
  ) => RegisteredToolHandle;
  sendToolListChanged: () => void;
  isConnected: () => boolean;
}

export interface L402PassthroughContext {
  tokenCache: L402TokenCache;
}

const anyRecordSchema = z.record(z.string(), z.unknown());

function toolInputSchema(tool: PlannedTool, l402Passthrough: boolean): z.ZodRawShape {
  const schema = baseToolInputSchema(tool);

  if (l402Passthrough && tool.kind !== "catalog_get") {
    return {
      ...schema,
      payment_preimage: z.string().optional().describe(
        "L402 payment preimage (hex). Omit on first call to receive invoice. After paying, retry with preimage."
      )
    };
  }

  return schema;
}

function baseToolInputSchema(tool: PlannedTool): z.ZodRawShape {
  switch (tool.kind) {
    case "catalog_get":
      return {
        refresh: z.boolean().optional().describe("If true, force a fresh catalog pull before returning")
      };

    case "text_generate":
      return {
        model: z.string().describe("Model name"),
        input: z.union([z.string(), z.array(z.unknown())]).describe("Text or structured input"),
        instructions: z.string().optional(),
        max_output_tokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        extra: anyRecordSchema.optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "image_generate":
      return {
        model: z.string(),
        prompt: z.string(),
        size: z.string().optional(),
        quality: z.string().optional(),
        style: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "image_edit":
      return {
        model: z.string(),
        prompt: z.string(),
        image_file_path: z.string().optional(),
        image_file_base64: z.string().optional(),
        image_file_name: z.string().optional(),
        image_mime_type: z.string().optional(),
        mask_file_path: z.string().optional(),
        mask_file_base64: z.string().optional(),
        mask_file_name: z.string().optional(),
        mask_mime_type: z.string().optional(),
        size: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "audio_transcribe":
      return {
        model: z.string().optional(),
        audio_file_path: z.string().optional(),
        audio_file_base64: z.string().optional(),
        audio_file_name: z.string().optional(),
        audio_mime_type: z.string().optional(),
        translate_to_english: z.boolean().optional(),
        prompt: z.string().optional(),
        language: z.string().optional(),
        response_format: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "audio_speech":
      return {
        model: z.string(),
        voice: z.string(),
        input: z.string(),
        format: z.string().optional(),
        speed: z.number().positive().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "video_generate":
      return {
        model: z.string(),
        prompt: z.string(),
        duration: z.number().int().positive().optional(),
        size: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "safety_moderate":
      return {
        model: z.string().optional(),
        input: z.union([z.string(), z.array(z.unknown())]),
        allow_l402_quote: z.boolean().optional()
      };

    case "embedding_create":
      return {
        model: z.string().optional(),
        input: z.union([z.string(), z.array(z.unknown())]),
        allow_l402_quote: z.boolean().optional()
      };

    case "full_endpoint":
      if (tool.contentType === "json") {
        return {
          model: z.string().optional(),
          body: anyRecordSchema.optional(),
          allow_l402_quote: z.boolean().optional()
        };
      }

      return {
        model: z.string().optional(),
        fields: anyRecordSchema.optional(),
        file_path: z.string().optional(),
        file_base64: z.string().optional(),
        file_name: z.string().optional(),
        mime_type: z.string().optional(),
        file_field: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "raw_call":
      return {
        endpoint: z.string().describe("Catalog endpoint path, e.g. /v1/responses"),
        content_type: z.enum(["json", "multipart"]).optional(),
        model: z.string().optional(),
        body: anyRecordSchema.optional(),
        fields: anyRecordSchema.optional(),
        file_path: z.string().optional(),
        file_base64: z.string().optional(),
        file_name: z.string().optional(),
        mime_type: z.string().optional(),
        file_field: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    default:
      return {};
  }
}

function l402Description(baseDescription: string): string {
  return `${baseDescription} Requires L402 payment — first call returns invoice, pay it, retry with payment_preimage.`;
}

export function registerPlannedTool(
  server: ToolServerLike,
  tool: PlannedTool,
  executor: AlbomToolExecutor,
  paymentMode: PaymentMode,
  l402Context?: L402PassthroughContext
): RegisteredToolHandle {
  const isL402Passthrough = paymentMode === "l402_passthrough";
  const isPaidTool = tool.kind !== "catalog_get";
  const description = isL402Passthrough && isPaidTool
    ? l402Description(tool.description)
    : tool.description;

  return server.registerTool(
    tool.name,
    {
      title: tool.title,
      description,
      inputSchema: toolInputSchema(tool, isL402Passthrough),
      annotations: tool.annotations
    },
    async (args) => {
      const typedArgs = asRecord(args);

      // Mode C: resolve L402 auth from payment_preimage
      let l402Auth: L402AuthCredentials | undefined;
      if (isL402Passthrough && isPaidTool && typeof typedArgs.payment_preimage === "string") {
        const preimage = typedArgs.payment_preimage as string;
        const paymentHash = paymentHashFromPreimage(preimage);
        const cached = l402Context?.tokenCache.get(paymentHash);

        if (!cached) {
          return {
            structuredContent: {
              ok: false,
              status: 400,
              error: {
                code: "unknown_payment",
                message: "No cached L402 token for this preimage. Make a call without payment_preimage first to get an invoice."
              }
            },
            content: [{ type: "text", text: "Unknown payment — call without payment_preimage first to get an invoice." }],
            isError: true
          };
        }

        l402Auth = { macaroon: cached.macaroon, preimage };
        delete typedArgs.payment_preimage;
      }

      // In l402_passthrough mode without auth, force allow_l402_quote
      if (isL402Passthrough && isPaidTool && !l402Auth) {
        typedArgs.allow_l402_quote = true;
      }

      const result = await executor.execute(tool, typedArgs, l402Auth);

      // Mode C: cache macaroon from 402 responses for subsequent retries
      if (!result.ok && result.status === 402 && l402Context) {
        const macaroon = extractMacaroon(result);
        const paymentHash = extractString(result.error, "payment_hash");
        const invoice = extractString(result.error, "invoice");
        const amountSats = extractNumber(result.error, "amount_sats");

        if (macaroon && paymentHash && invoice) {
          l402Context.tokenCache.set({
            macaroon,
            invoice,
            paymentHash,
            amountSats: amountSats ?? 0
          });
        }
      }

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [
          {
            type: "text",
            text: summarizeResult(result)
          }
        ],
        isError: !result.ok
      };
    }
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function extractMacaroon(result: { error: Record<string, unknown> }): string | undefined {
  const macaroon = result.error.macaroon;
  return typeof macaroon === "string" && macaroon.length > 0 ? macaroon : undefined;
}

function extractString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
