import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") {
      return input;
    }

    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }

    if (seen.has(input)) {
      throw new Error("Cannot stable-stringify circular structure");
    }

    seen.add(input);
    const sortedEntries = Object.entries(input as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, normalize(val)]);

    return Object.fromEntries(sortedEntries);
  };

  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function modelSetJaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);

  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const value of setA) {
    if (setB.has(value)) {
      intersection += 1;
    }
  }

  const union = new Set([...setA, ...setB]).size;
  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

export function sanitizeToolName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}
