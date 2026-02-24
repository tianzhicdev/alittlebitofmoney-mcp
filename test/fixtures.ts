import type { CatalogEndpoint, CatalogResponse } from "../src/types.js";

export function baseCatalog(): CatalogResponse {
  const endpoints: CatalogEndpoint[] = [
    {
      path: "/v1/chat/completions",
      method: "POST",
      price_type: "per_model",
      description: "Chat completions",
      example: {
        content_type: "json",
        body: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hello" }]
        }
      },
      models: {
        "gpt-4o-mini": { price_sats: 20 },
        "gpt-4.1-mini": { price_sats: 30 },
        _default: { price_sats: 20 }
      }
    },
    {
      path: "/v1/responses",
      method: "POST",
      price_type: "per_model",
      description: "Responses",
      example: {
        content_type: "json",
        body: {
          model: "gpt-4o-mini",
          input: "hello"
        }
      },
      models: {
        "gpt-4o-mini": { price_sats: 30 },
        "gpt-4.1-mini": { price_sats: 50 },
        _default: { price_sats: 30 }
      }
    },
    {
      path: "/v1/images/generations",
      method: "POST",
      price_type: "per_model",
      description: "Image generation",
      example: {
        content_type: "json",
        body: {
          model: "gpt-image-1-mini",
          prompt: "cat"
        }
      },
      models: {
        "gpt-image-1-mini": { price_sats: 120 },
        "dall-e-3": { price_sats: 300 },
        _default: { price_sats: 120 }
      }
    },
    {
      path: "/v1/images/edits",
      method: "POST",
      price_type: "per_model",
      description: "Image edits",
      example: {
        content_type: "multipart",
        file_field: "image",
        fields: {
          model: "gpt-image-1-mini",
          image: "@image.png",
          prompt: "edit"
        }
      },
      models: {
        "gpt-image-1-mini": { price_sats: 120 },
        "dall-e-2": { price_sats: 60 },
        _default: { price_sats: 120 }
      }
    },
    {
      path: "/v1/images/variations",
      method: "POST",
      price_type: "flat",
      description: "Image variations",
      example: {
        content_type: "multipart",
        file_field: "image",
        fields: {
          model: "dall-e-2",
          image: "@image.png"
        }
      },
      price_sats: 60
    },
    {
      path: "/v1/audio/speech",
      method: "POST",
      price_type: "per_model",
      description: "Audio speech",
      example: {
        content_type: "json",
        body: {
          model: "tts-1",
          voice: "alloy",
          input: "hello"
        }
      },
      models: {
        "tts-1": { price_sats: 200 },
        _default: { price_sats: 200 }
      }
    },
    {
      path: "/v1/audio/transcriptions",
      method: "POST",
      price_type: "per_model",
      description: "Audio transcriptions",
      example: {
        content_type: "multipart",
        file_field: "file",
        fields: {
          model: "whisper-1",
          file: "@sample.mp3"
        }
      },
      models: {
        "whisper-1": { price_sats: 200 },
        _default: { price_sats: 200 }
      }
    },
    {
      path: "/v1/audio/translations",
      method: "POST",
      price_type: "flat",
      description: "Audio translations",
      example: {
        content_type: "multipart",
        file_field: "file",
        fields: {
          file: "@sample.mp3"
        }
      },
      price_sats: 200
    },
    {
      path: "/v1/embeddings",
      method: "POST",
      price_type: "per_model",
      description: "Embeddings",
      example: {
        content_type: "json",
        body: {
          model: "text-embedding-3-small",
          input: "hello"
        }
      },
      models: {
        "text-embedding-3-small": { price_sats: 21 },
        _default: { price_sats: 21 }
      }
    },
    {
      path: "/v1/moderations",
      method: "POST",
      price_type: "per_model",
      description: "Moderations",
      example: {
        content_type: "json",
        body: {
          model: "omni-moderation-latest",
          input: "hello"
        }
      },
      models: {
        "omni-moderation-latest": { price_sats: 21 },
        _default: { price_sats: 21 }
      }
    },
    {
      path: "/v1/video/generations",
      method: "POST",
      price_type: "per_model",
      description: "Video generation",
      example: {
        content_type: "json",
        body: {
          model: "sora-2",
          prompt: "hello"
        }
      },
      models: {
        "sora-2": { price_sats: 3000 },
        _default: { price_sats: 3000 }
      }
    }
  ];

  return {
    apis: {
      openai: {
        name: "OpenAI",
        endpoints
      }
    }
  };
}

export function catalogWithPaths(paths: string[]): CatalogResponse {
  const base = baseCatalog();
  return {
    ...base,
    apis: {
      ...base.apis,
      openai: {
        ...base.apis.openai,
        endpoints: base.apis.openai.endpoints.filter((endpoint) => paths.includes(endpoint.path))
      }
    }
  };
}
