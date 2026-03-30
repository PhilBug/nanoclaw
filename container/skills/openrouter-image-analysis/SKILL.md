---
name: openrouter-image-analysis
description: >
  Analyze images using OpenRouter vision models. Use this skill whenever you need to
  understand, describe, or extract information from an image — including screenshots,
  photos, diagrams, charts, UI mockups, error messages, handwritten notes, or any visual
  content. Also triggers when the user shares an image path or URL and asks about it,
  says "look at this", "what's in this image", "read this screenshot", "extract text from",
  or otherwise needs visual understanding that requires a vision model. Supports local files
  (png, jpg, jpeg, webp, gif, bmp) and HTTP/HTTPS URLs.
---

# OpenRouter Image Analysis

Analyze images on demand using OpenRouter's vision-capable models. The script at `/home/node/.claude/skills/openrouter-image-analysis/scripts/analyze_image.mjs` handles everything: model discovery, image encoding, and API calls.

## Quick Start

```bash
# Source runtime env (makes OPENROUTER_API_KEY available)
source /home/node/.claude/runtime-env.sh

# Analyze an image
node /home/node/.claude/skills/openrouter-image-analysis/scripts/analyze_image.mjs \
  "/workspace/group/photo.jpg" "what text is visible?"
```

The script prints the model's analysis to stdout and the model name to stderr.

## When to use

Use this skill whenever:
- The user shares an image and asks about it ("what's in this image?", "read this screenshot")
- You encounter a local image file or URL that needs visual understanding
- The user asks to extract text, describe contents, or analyze visual content
- You need to understand a diagram, chart, or UI mockup

If no specific analysis instruction is given, the script uses a sensible default that covers description, text extraction, UI elements, errors, and notable details.

## How to call

```bash
source /home/node/.claude/runtime-env.sh

node /home/node/.claude/skills/openrouter-image-analysis/scripts/analyze_image.mjs \
  "<image_path_or_url>" "<prompt>"
```

Both arguments are positional — quote them to handle spaces and special characters safely.

## Supported formats

Local files: png, jpg, jpeg, webp, gif, bmp. Also accepts HTTP/HTTPS URLs.

## After analysis

1. Use the script's stdout as the factual basis for your response
2. Present the analysis naturally — don't dump raw output
3. You may reformat, summarize, or add context, but do not fabricate details not present in the output
4. Mention which model was used only if the user asked about model choice

## Environment variables

These are injected from the host `.env` via `runtime-env.sh` — no manual setup needed inside the container.

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | Yes | API key for OpenRouter |
| `OPENROUTER_VISION_MODEL` | No | Pin a specific model (skips auto-discovery) |

If the script fails with `OPENROUTER_API_KEY not set`, the user needs to add it to their host `.env` file.

## How it works

The script (`analyze_image.mjs`) is a zero-dependency Node.js script that:
1. Accepts a local file path or URL plus an optional prompt
2. For local files: detects MIME type and base64-encodes as a data URL
3. For URLs: passes the URL directly to the API
4. Resolves the model — uses `OPENROUTER_VISION_MODEL` if set, otherwise calls `find_free_models.mjs` to discover a free vision-capable model
5. Calls OpenRouter's chat completions API with the image and prompt
6. Returns plain-text analysis to stdout
