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
allowed-tools: Bash(python3 *)
---

# OpenRouter Image Analysis

This skill delegates image understanding to OpenRouter's vision-capable models through bundled scripts. It bridges the gap for non-vision models by calling an external vision API and returning plain-text analysis.

## Instructions

When this skill triggers (when you encounter an image that needs analysis), follow these steps:

### 1. Parse the arguments

From `$ARGUMENTS`, extract:
- **image_ref**: the first value — a local file path or HTTP/HTTPS URL
- **prompt**: everything after the first value — the analysis instruction

If the user only provides an image with no prompt, use this default:

> Describe the image and extract any important visible text, errors, UI elements, diagrams, or notable details.

If the arguments are ambiguous (no clear image path/URL), ask one short clarifying question before proceeding.

### 2. Run the analysis script

```bash
source /home/node/.claude/runtime-env.sh

python3 /home/node/.claude/skills/openrouter-image-analysis/scripts/analyze_image.py "<image_ref>" "<prompt>"
```

Pass the image reference and prompt as separate arguments. Quote them to handle spaces and special characters safely.

### 3. Handle the result

The script prints the vision model's analysis to **stdout** and the model name to **stderr**.

- **On success**: Use the stdout output as the factual basis for your response. You may reformat, summarize, or add context — but do not fabricate details not present in the script output.
- **On failure**: Report the error message clearly. Common fixes:
  - `OPENROUTER_API_KEY not set` — the user needs to add `OPENROUTER_API_KEY` to the host `.env` file
  - `file not found` — verify the image path exists
  - `unsupported format` — remind them of supported formats (png, jpg, jpeg, webp, gif, bmp)
  - `no free vision-capable models` — suggest setting `OPENROUTER_VISION_MODEL` in the host `.env` to a specific model

### 4. Respond naturally

Present the analysis in a way that's useful for whatever the user was asking. Don't just dump raw output — integrate it into your response. Mention which model was used only if it seems relevant (e.g., the user asked about model choice, or you want to flag that a free model was used).

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | Yes | API key for OpenRouter (injected from host `.env`) |
| `OPENROUTER_VISION_MODEL` | No | Pin a specific model (skips auto-discovery) |

Both variables are injected into the container at startup. To configure them, add them to the host `.env` file:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_VISION_MODEL=google/gemma-3-27b-it:free
```

## How it works

The analysis script (`scripts/analyze_image.py`) is a zero-dependency Python script that:
1. Accepts a local file path or URL plus an optional prompt
2. For local files: detects MIME type and base64-encodes as a data URL
3. For URLs: passes the URL directly to the API
4. Resolves the model — uses `OPENROUTER_VISION_MODEL` if set, otherwise calls `scripts/find_free_models.mjs` to discover a free vision-capable model
5. Calls OpenRouter's chat completions API with the image and prompt
6. Returns plain-text analysis to stdout
