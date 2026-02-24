import { z } from "zod";
import type { ToolAnnotations } from "../types.js";
import type { PlannedTool } from "../types.js";
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

const anyRecordSchema = z.record(z.string(), z.unknown());

function toolInputSchema(tool: PlannedTool): z.ZodRawShape {
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

export function registerPlannedTool(
  server: ToolServerLike,
  tool: PlannedTool,
  executor: AlbomToolExecutor
): RegisteredToolHandle {
  return server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: toolInputSchema(tool),
      annotations: tool.annotations
    },
    async (args) => {
      const result = await executor.execute(tool, args);

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
