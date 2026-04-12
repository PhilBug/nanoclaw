---
name: openrouter-models
description: Query and filter the OpenRouter model catalog. Use when the user asks about available models, pricing, capabilities (vision, audio, tool use), or wants to compare models on OpenRouter.
allowed-tools: Bash(node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs *)
---

# OpenRouter Model Filter

Search and filter OpenRouter's model catalog by capability, pricing, modality, and more.

## Quick start

```bash
# All free models
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --free

# Free models with image input
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --free --image

# Models supporting tool use with 100k+ context
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --tools --min-context 100000

# Search for a specific model
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --search "claude"
```

## Flags

| Flag | Description |
|------|-------------|
| `--free` | Only free models (zero pricing or `:free` suffix) |
| `--image` | Models with `image` input modality |
| `--audio` | Models with `audio` input modality |
| `--video` | Models with `video` input modality |
| `--tools` | Models where `supported_parameters` includes `tools` |
| `--output TEXT\|IMAGE\|AUDIO\|EMBEDDINGS` | Filter by output modality (case-insensitive) |
| `--min-context N` | Minimum context length in tokens |
| `--search QUERY` | Substring match on model ID, name, or description |
| `--json` | Output full JSON instead of table |
| `--limit N` | Max results (default 50) |

Flags can be combined. All filters are AND-ed together.

## Filtering with jq

Use `--json` and pipe to `jq` for ad-hoc queries the built-in flags don't cover:

```bash
# Get just the model IDs for scripting
... --json | jq '.[].id'

# Extract model name and context length
... --json | jq '.[] | {name, context_length}'

# Find models with the cheapest prompt pricing
... --json | jq '. | sort_by(.pricing.prompt | tonumber) | .[:5] | .[] | {id, prompt_pricing: .pricing.prompt}'

# Get supported_parameters for a specific model
... --json --search "claude" | jq '.[].supported_parameters'

# Count models by tokenizer
... --json | jq 'group_by(.architecture.tokenizer) | map({tokenizer: .[0].architecture.tokenizer, count: length})'
```

## Examples

```bash
# Free vision models
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --free --image

# All models that can generate images
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --output IMAGE

# Models with audio input and tool use
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --audio --tools

# Get full JSON for a specific model
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --search "gpt-4o" --json

# Large-context free models
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --free --min-context 32000

# Extract just IDs and context lengths for free image models
node /home/node/.claude/skills/openrouter-models/scripts/openrouter_models.mjs --free --image --json | jq '.[] | {id, context_length}'
```

## Environment

- `OPENROUTER_API_KEY` — optional; authenticated requests may see more models
