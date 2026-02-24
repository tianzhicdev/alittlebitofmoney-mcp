# alittlebitofmoney-mcp

Catalog-aware MCP server for `https://alittlebitofmoney.com` with compact/full tool profiles, bearer-first paid API routing, and dynamic tool refresh notifications.

## Quick start

```bash
npm install
npm run build
npm test
```

Run over stdio:

```bash
ALBOM_BEARER_TOKEN=... npm start
```

## Environment

- `ALBOM_BASE_URL` default: `https://alittlebitofmoney.com`
- `ALBOM_BEARER_TOKEN` optional but strongly recommended
- `ALBOM_TOOL_PROFILE` default: `compact` (`compact` or `full`)
- `ALBOM_INCLUDE_MODERATION` default: `false` in compact, `true` in full
- `ALBOM_INCLUDE_EMBEDDINGS` default: `false` in compact, `true` in full
- `ALBOM_INCLUDE_VIDEO` default: `true`
- `ALBOM_ALLOW_RAW_TOOL` default: `false`
- `ALBOM_CATALOG_TTL_MS` default: `300000`
- `ALBOM_HTTP_TIMEOUT_MS` default: `90000`
- `ALBOM_MAX_RETRIES` default: `2`
- `ALBOM_MAX_UPLOAD_BYTES` default: `26214400`

## Compact profile tools

- `albom_catalog_get`
- `albom_text_generate`
- `albom_image_generate`
- `albom_image_edit`
- `albom_audio_transcribe`
- `albom_audio_speech`
- `albom_video_generate` (if enabled)
- `albom_safety_moderate` (if enabled)
- `albom_embedding_create` (if enabled)

## Full profile tools

- One tool per catalog endpoint, for example:
  - `albom_openai_chat_completions`
  - `albom_openai_responses`
  - `albom_openai_images_generations`
  - `albom_openai_audio_translations`
- Plus `albom_catalog_get`
- Optional `albom_raw_call` when `ALBOM_ALLOW_RAW_TOOL=true`

## Testing

```bash
npm test
```

The test suite covers catalog validation/normalization, dedup logic, HTTP/error normalization, multipart uploads (path + base64), and tools list-changed behavior.

## Publish

1. Build and test:
```bash
npm run build
npm test
```

2. Check publish artifact:
```bash
npm pack --dry-run
```

3. Publish:
```bash
npm login
npm version patch
npm publish --access public
```
