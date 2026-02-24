import type { AlbomConfig } from "./config.js";
import type {
  CatalogState,
  EndpointDescriptor,
  PlannedTool,
  ToolState,
  ToolProfile,
  ToolAnnotations
} from "./types.js";
import { modelSetJaccard, sanitizeToolName, sha256Hex, stableStringify } from "./utils.js";

const TEXT_ENDPOINTS = ["/v1/responses", "/v1/chat/completions"] as const;

const READ_ONLY_ANNOTATION: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false
};

const DEFAULT_ANNOTATION: ToolAnnotations = {
  destructiveHint: false,
  openWorldHint: true
};

function isTextPath(path: string): boolean {
  return path === "/v1/responses" || path.startsWith("/v1/chat/");
}

export function isDuplicateCandidate(a: EndpointDescriptor, b: EndpointDescriptor): boolean {
  const sameMethod = a.method === b.method;
  const sameContentType = a.contentType === b.contentType;
  const jaccard = modelSetJaccard(a.models, b.models);

  const sameFamily =
    a.family === b.family ||
    (isTextPath(a.path) && isTextPath(b.path));

  return sameMethod && sameContentType && sameFamily && jaccard >= 0.95;
}

function endpointByPath(catalog: CatalogState, path: string): EndpointDescriptor | undefined {
  return catalog.endpoints.find((endpoint) => endpoint.path === path && endpoint.method === "POST");
}

function chooseCompactTextEndpoint(catalog: CatalogState): EndpointDescriptor | undefined {
  const responses = endpointByPath(catalog, "/v1/responses");
  const chat = endpointByPath(catalog, "/v1/chat/completions");

  if (!responses) {
    return chat;
  }

  if (!chat) {
    return responses;
  }

  if (isDuplicateCandidate(chat, responses)) {
    return responses;
  }

  // Compact profile intentionally keeps the responses surface canonical.
  return responses;
}

function makeCompactTools(catalog: CatalogState, config: AlbomConfig): PlannedTool[] {
  const tools: PlannedTool[] = [
    {
      kind: "catalog_get",
      name: "albom_catalog_get",
      title: "Get ALBOM Catalog",
      description: "Get normalized ALBOM catalog data and derived tool summary.",
      annotations: READ_ONLY_ANNOTATION
    }
  ];

  const textEndpoint = chooseCompactTextEndpoint(catalog);
  if (textEndpoint) {
    tools.push({
      kind: "text_generate",
      name: "albom_text_generate",
      title: "Text Generation",
      description: `Generate text responses via ${textEndpoint.path}.`,
      endpointPath: textEndpoint.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const imageGenerate = endpointByPath(catalog, "/v1/images/generations");
  if (imageGenerate) {
    tools.push({
      kind: "image_generate",
      name: "albom_image_generate",
      title: "Image Generation",
      description: "Generate new images from text prompts.",
      endpointPath: imageGenerate.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const imageEdit = endpointByPath(catalog, "/v1/images/edits");
  if (imageEdit) {
    tools.push({
      kind: "image_edit",
      name: "albom_image_edit",
      title: "Image Edit",
      description: "Edit an input image with prompt instructions.",
      endpointPath: imageEdit.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const audioTranscribe = endpointByPath(catalog, "/v1/audio/transcriptions");
  if (audioTranscribe) {
    tools.push({
      kind: "audio_transcribe",
      name: "albom_audio_transcribe",
      title: "Audio Transcribe",
      description: "Transcribe audio. Set translate_to_english=true to route to translation.",
      endpointPath: audioTranscribe.path,
      translationEndpointPath: endpointByPath(catalog, "/v1/audio/translations")?.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const audioSpeech = endpointByPath(catalog, "/v1/audio/speech");
  if (audioSpeech) {
    tools.push({
      kind: "audio_speech",
      name: "albom_audio_speech",
      title: "Audio Speech",
      description: "Synthesize speech from text input.",
      endpointPath: audioSpeech.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  if (config.includeVideo) {
    const videoGenerate = endpointByPath(catalog, "/v1/video/generations");
    if (videoGenerate) {
      tools.push({
        kind: "video_generate",
        name: "albom_video_generate",
        title: "Video Generation",
        description: "Generate videos from text prompts. This endpoint can be expensive.",
        endpointPath: videoGenerate.path,
        annotations: {
          ...DEFAULT_ANNOTATION,
          idempotentHint: false
        }
      });
    }
  }

  if (config.includeModeration) {
    const moderation = endpointByPath(catalog, "/v1/moderations");
    if (moderation) {
      tools.push({
        kind: "safety_moderate",
        name: "albom_safety_moderate",
        title: "Safety Moderate",
        description: "Classify text content with moderation models.",
        endpointPath: moderation.path,
        annotations: READ_ONLY_ANNOTATION
      });
    }
  }

  if (config.includeEmbeddings) {
    const embeddings = endpointByPath(catalog, "/v1/embeddings");
    if (embeddings) {
      tools.push({
        kind: "embedding_create",
        name: "albom_embedding_create",
        title: "Embedding Create",
        description: "Generate embeddings for text input.",
        endpointPath: embeddings.path,
        annotations: READ_ONLY_ANNOTATION
      });
    }
  }

  if (config.allowRawTool) {
    tools.push({
      kind: "raw_call",
      name: "albom_raw_call",
      title: "Raw ALBOM Call",
      description: "Raw allowlisted endpoint caller for advanced use only.",
      annotations: DEFAULT_ANNOTATION
    });
  }

  return tools;
}

function shouldIncludeFullEndpoint(endpoint: EndpointDescriptor, config: AlbomConfig): boolean {
  if (!config.includeVideo && endpoint.path === "/v1/video/generations") {
    return false;
  }
  if (!config.includeModeration && endpoint.path === "/v1/moderations") {
    return false;
  }
  if (!config.includeEmbeddings && endpoint.path === "/v1/embeddings") {
    return false;
  }

  return true;
}

function fullToolName(profileApi: string, endpointPath: string): string {
  const segments = endpointPath
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "v1");

  return sanitizeToolName(["albom", profileApi, ...segments].join("_"));
}

function makeFullTools(catalog: CatalogState, config: AlbomConfig): PlannedTool[] {
  const tools: PlannedTool[] = [
    {
      kind: "catalog_get",
      name: "albom_catalog_get",
      title: "Get ALBOM Catalog",
      description: "Get normalized ALBOM catalog data and derived tool summary.",
      annotations: READ_ONLY_ANNOTATION
    }
  ];

  const usedNames = new Set<string>(tools.map((tool) => tool.name));

  for (const endpoint of catalog.endpoints) {
    if (endpoint.method !== "POST") {
      continue;
    }

    if (!shouldIncludeFullEndpoint(endpoint, config)) {
      continue;
    }

    let name = fullToolName(endpoint.apiKey, endpoint.path);
    if (usedNames.has(name)) {
      name = sanitizeToolName(`${name}_${endpoint.method.toLowerCase()}`);
    }

    usedNames.add(name);

    tools.push({
      kind: "full_endpoint",
      name,
      title: `${endpoint.apiName} ${endpoint.path}`,
      description: endpoint.description,
      endpointPath: endpoint.path,
      contentType: endpoint.contentType,
      fileField: endpoint.fileField,
      annotations: DEFAULT_ANNOTATION
    });
  }

  if (config.allowRawTool) {
    tools.push({
      kind: "raw_call",
      name: "albom_raw_call",
      title: "Raw ALBOM Call",
      description: "Raw allowlisted endpoint caller for advanced use only.",
      annotations: DEFAULT_ANNOTATION
    });
  }

  return tools;
}

function buildToolSignature(profile: ToolProfile, tools: PlannedTool[]): string {
  return sha256Hex(
    stableStringify({
      profile,
      tools: tools.map((tool) => ({
        kind: tool.kind,
        name: tool.name,
        endpointPath: "endpointPath" in tool ? tool.endpointPath : undefined,
        translationEndpointPath:
          tool.kind === "audio_transcribe" ? tool.translationEndpointPath : undefined,
        contentType: tool.kind === "full_endpoint" ? tool.contentType : undefined
      }))
    })
  );
}

export function buildToolState(catalog: CatalogState, config: AlbomConfig): ToolState {
  const tools = config.toolProfile === "compact" ? makeCompactTools(catalog, config) : makeFullTools(catalog, config);

  return {
    profile: config.toolProfile,
    tools,
    signature: buildToolSignature(config.toolProfile, tools)
  };
}

export function endpointByPathFromCatalog(catalog: CatalogState, path: string): EndpointDescriptor | undefined {
  return endpointByPath(catalog, path);
}

export function textEndpointCandidates(catalog: CatalogState): EndpointDescriptor[] {
  return TEXT_ENDPOINTS.map((path) => endpointByPath(catalog, path)).filter(
    (endpoint): endpoint is EndpointDescriptor => endpoint !== undefined
  );
}
