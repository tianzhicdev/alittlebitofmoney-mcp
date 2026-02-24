import { basename, extname } from "node:path";
import { readFile as defaultReadFile } from "node:fs/promises";
import type { PreparedUpload } from "./types.js";
import { AlbomRuntimeError } from "./errors.js";

interface PrepareUploadOptions {
  fieldName: string;
  label: string;
  filePath?: string;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  maxBytes: number;
  required?: boolean;
  readFileFn?: typeof defaultReadFile;
}

const EXTENSION_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac"
};

function inferredMimeType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

function decodeBase64(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AlbomRuntimeError("invalid_base64", "Base64 payload is empty", 400);
  }

  let normalized = trimmed;
  const commaIndex = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && commaIndex > 0) {
    normalized = trimmed.slice(commaIndex + 1);
  }

  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) {
    throw new AlbomRuntimeError("invalid_base64", "Base64 payload could not be decoded", 400);
  }

  return buffer;
}

function validateUploadSize(sizeBytes: number, maxBytes: number, label: string): void {
  if (sizeBytes <= 0) {
    throw new AlbomRuntimeError("empty_upload", `${label} is empty`, 400);
  }
  if (sizeBytes > maxBytes) {
    throw new AlbomRuntimeError("file_too_large", `${label} exceeds max upload size`, 413, {
      max_bytes: maxBytes,
      size_bytes: sizeBytes
    });
  }
}

export async function prepareUpload(options: PrepareUploadOptions): Promise<PreparedUpload | undefined> {
  const sourceCount = Number(Boolean(options.filePath)) + Number(Boolean(options.fileBase64));

  if (sourceCount === 0) {
    if (options.required) {
      throw new AlbomRuntimeError(
        "missing_file",
        `${options.label} requires exactly one of file_path or file_base64`,
        400
      );
    }
    return undefined;
  }

  if (sourceCount > 1) {
    throw new AlbomRuntimeError(
      "invalid_file_input",
      `${options.label} requires exactly one of file_path or file_base64`,
      400
    );
  }

  const readFileFn = options.readFileFn ?? defaultReadFile;

  let buffer: Buffer;
  let resolvedFileName: string;

  if (options.filePath) {
    resolvedFileName = options.fileName?.trim() || basename(options.filePath);
    try {
      buffer = await readFileFn(options.filePath);
    } catch (error) {
      throw new AlbomRuntimeError(
        "file_read_failed",
        `Could not read ${options.label} from ${options.filePath}`,
        400,
        {
          cause: error instanceof Error ? error.message : String(error)
        }
      );
    }
  } else {
    buffer = decodeBase64(options.fileBase64 ?? "");
    resolvedFileName = options.fileName?.trim() || `${options.fieldName}.bin`;
  }

  validateUploadSize(buffer.byteLength, options.maxBytes, options.label);

  return {
    fieldName: options.fieldName,
    fileName: resolvedFileName,
    mimeType: options.mimeType?.trim() || inferredMimeType(resolvedFileName),
    buffer,
    sizeBytes: buffer.byteLength
  };
}
