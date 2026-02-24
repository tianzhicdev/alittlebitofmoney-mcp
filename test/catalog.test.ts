import { describe, expect, it } from "vitest";
import { normalizeCatalog, parseCatalog } from "../src/catalog.js";
import { baseCatalog } from "./fixtures.js";

describe("catalog", () => {
  it("parses a valid catalog", () => {
    const parsed = parseCatalog(baseCatalog());
    expect(Object.keys(parsed.apis)).toContain("openai");
  });

  it("rejects per_model endpoint without models", () => {
    const catalog = baseCatalog();
    catalog.apis.openai.endpoints[0] = {
      ...catalog.apis.openai.endpoints[0],
      models: {}
    };

    expect(() => parseCatalog(catalog)).toThrow(/per_model/);
  });

  it("rejects flat endpoint without price_sats", () => {
    const catalog = baseCatalog();
    const flatEndpointIndex = catalog.apis.openai.endpoints.findIndex((endpoint) => endpoint.path === "/v1/audio/translations");
    catalog.apis.openai.endpoints[flatEndpointIndex] = {
      ...catalog.apis.openai.endpoints[flatEndpointIndex],
      price_sats: undefined
    };

    expect(() => parseCatalog(catalog)).toThrow(/flat/);
  });

  it("normalizes catalog and computes summary", () => {
    const normalized = normalizeCatalog(parseCatalog(baseCatalog()));

    expect(normalized.summary.apiCount).toBe(1);
    expect(normalized.summary.endpointCount).toBe(11);
    expect(normalized.summary.perModelCount).toBe(9);
    expect(normalized.summary.flatCount).toBe(2);

    const editEndpoint = normalized.endpoints.find((endpoint) => endpoint.path === "/v1/images/edits");
    expect(editEndpoint?.contentType).toBe("multipart");
    expect(editEndpoint?.fileField).toBe("image");
  });
});
