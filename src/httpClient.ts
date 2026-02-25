import type { L402AuthCredentials, NormalizedHttpResponse, PreparedUpload } from "./types.js";
import { parseL402Challenge, buildL402Authorization } from "./l402.js";
import { AlbomRuntimeError } from "./errors.js";
import { sleep, toErrorMessage } from "./utils.js";

export interface L402Handler {
  /** Called when a 402 with L402 challenge is received. Should pay and return the preimage. */
  handlePaymentRequired(challenge: {
    macaroon: string;
    invoice: string;
    paymentHash: string;
    amountSats: number;
  }): Promise<{ preimage: string }>;
}

interface HttpClientOptions {
  baseUrl: string;
  bearerToken?: string;
  l402Handler?: L402Handler;
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: typeof fetch;
}

interface RequestOptions {
  allowL402Quote?: boolean;
  l402Auth?: L402AuthCredentials;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeEndpointPath(endpointPath: string): string {
  if (!endpointPath.startsWith("/")) {
    return `/${endpointPath}`;
  }
  return endpointPath;
}

function composeEndpointUrl(baseUrl: string, endpointPath: string): string {
  return `${baseUrl}/openai${normalizeEndpointPath(endpointPath)}`;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

async function parseResponseData(response: Response): Promise<NormalizedHttpResponse["data"]> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  if (contentType.startsWith("text/")) {
    return response.text();
  }

  const arrayBuffer = await response.arrayBuffer();
  const binary = Buffer.from(arrayBuffer);
  return {
    mime_type: contentType || "application/octet-stream",
    base64: binary.toString("base64"),
    size_bytes: binary.byteLength
  };
}

export class AlbomHttpClient {
  private readonly fetchFn: typeof fetch;

  public constructor(private readonly options: HttpClientOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;

    if (!this.fetchFn) {
      throw new Error("No fetch implementation available");
    }
  }

  public async postJson(
    endpointPath: string,
    body: Record<string, unknown>,
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);
    headers["content-type"] = "application/json";

    const response = await this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    return response;
  }

  public async postMultipart(
    endpointPath: string,
    fields: Record<string, unknown>,
    uploads: PreparedUpload[],
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);

    const formData = new FormData();
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined || value === null) {
        continue;
      }

      const finalValue =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      formData.set(field, finalValue);
    }

    for (const upload of uploads) {
      formData.set(
        upload.fieldName,
        new Blob([new Uint8Array(upload.buffer)], {
          type: upload.mimeType
        }),
        upload.fileName
      );
    }

    const response = await this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "POST",
      headers,
      body: formData
    });

    return response;
  }

  public async rawPost(
    endpointPath: string,
    body: BodyInit,
    contentType: string | undefined,
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);
    if (contentType) {
      headers["content-type"] = contentType;
    }

    return this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "POST",
      headers,
      body
    });
  }

  private resolveHeaders(requestOptions: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "*/*"
    };

    // Mode C retry: caller supplied L402 credentials (macaroon + preimage)
    if (requestOptions.l402Auth) {
      headers.authorization = buildL402Authorization(
        requestOptions.l402Auth.macaroon,
        requestOptions.l402Auth.preimage
      );
      return headers;
    }

    // Mode B: bearer token
    if (this.options.bearerToken) {
      headers.authorization = `Bearer ${this.options.bearerToken}`;
      return headers;
    }

    // Mode A: NWC auto-pay (l402Handler set) — send unauthenticated, handle 402 in requestWithRetries
    if (this.options.l402Handler) {
      return headers;
    }

    // Mode C first call: no auth, will get 402 back
    if (requestOptions.allowL402Quote) {
      return headers;
    }

    throw new AlbomRuntimeError(
      "missing_bearer_token",
      "ALBOM_BEARER_TOKEN is not set. Configure it, set ALBOM_NWC_URL for auto-pay, or set allow_l402_quote=true to request a payment quote.",
      401
    );
  }

  private async requestWithRetries(url: string, requestInit: RequestInit): Promise<NormalizedHttpResponse> {
    const maxAttempts = this.options.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url, requestInit);

        // Mode A: auto-pay L402 invoices via NWC wallet
        if (response.status === 402 && this.options.l402Handler) {
          const responseHeaders = headersToRecord(response.headers);
          const data = await parseResponseData(response);
          const challenge = parseL402Challenge(responseHeaders, data);

          if (challenge) {
            try {
              const { preimage } = await this.options.l402Handler.handlePaymentRequired(challenge);

              // Retry the same request with L402 authorization
              const retryHeaders = {
                ...(requestInit.headers as Record<string, string>),
                authorization: buildL402Authorization(challenge.macaroon, preimage)
              };

              const retryResponse = await this.fetchWithTimeout(url, {
                ...requestInit,
                headers: retryHeaders
              });

              return {
                status: retryResponse.status,
                headers: headersToRecord(retryResponse.headers),
                data: await parseResponseData(retryResponse)
              };
            } catch {
              // Auto-pay failed — return the original 402 response
              return { status: 402, headers: responseHeaders, data };
            }
          }

          // No valid L402 challenge in the 402 response — return as-is
          return { status: 402, headers: responseHeaders, data };
        }

        if (isRetryableStatus(response.status) && attempt < maxAttempts - 1) {
          await sleep(this.backoffMs(attempt));
          continue;
        }

        return {
          status: response.status,
          headers: headersToRecord(response.headers),
          data: await parseResponseData(response)
        };
      } catch (error) {
        const shouldRetry = attempt < maxAttempts - 1;
        if (shouldRetry) {
          await sleep(this.backoffMs(attempt));
          continue;
        }

        const code = error instanceof DOMException && error.name === "AbortError" ? "upstream_timeout" : "network_error";
        const status = code === "upstream_timeout" ? 504 : 503;
        throw new AlbomRuntimeError(code, `HTTP request failed: ${toErrorMessage(error)}`, status);
      }
    }

    throw new AlbomRuntimeError("internal_retry_error", "Retry loop exited unexpectedly", 500);
  }

  private async fetchWithTimeout(url: string, requestInit: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await this.fetchFn(url, {
        ...requestInit,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private backoffMs(attempt: number): number {
    return Math.round(200 * 2 ** attempt + Math.random() * 80);
  }
}
