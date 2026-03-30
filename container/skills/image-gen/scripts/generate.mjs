#!/usr/bin/env node

import { writeFileSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';

const BASE_URL = 'https://gen.pollinations.ai';
const MODELS_URL = `${BASE_URL}/image/models`;
const DEFAULT_MODEL = 'zimage';
const DEFAULT_OUTPUT_DIR = '/workspace/group';

// --- Help ---

const HELP = `
Pollinations Image Generator

Usage:
  generate.mjs --prompt "a cat in space" [OPTIONS]
  generate.mjs --list-models
  generate.mjs --help

Options:
  --prompt TEXT        Required. The image prompt
  --model MODEL        Model name (default: zimage)
  --negative TEXT      Negative prompt (max 5 entries, comma-separated)
  --enhance            Enable prompt enhancement (default: off)
  --image URL          Reference image URL for editing
  --output PATH        Output file path (default: /workspace/group/generated-<timestamp>.jpg)
  --list-models        List available free models and exit
  --help               Show this help message

Environment:
  POLLINATIONS_API_KEY  Required for generation.
`.trim();

// --- Args parser ---

function parseArgs(argv) {
  const args = {
    prompt: '',
    model: DEFAULT_MODEL,
    negative: '',
    enhance: false,
    image: '',
    output: '',
    listModels: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--prompt':
        args.prompt = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--negative':
        args.negative = argv[++i];
        break;
      case '--enhance':
        args.enhance = true;
        break;
      case '--image':
        args.image = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--list-models':
        args.listModels = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.error(`Unknown option: ${argv[i]}`);
        process.exit(1);
    }
  }

  return args;
}

// --- Model fetching and validation ---

async function fetchModels() {
  const res = await fetch(MODELS_URL);
  if (!res.ok) throw new Error(`Failed to fetch models: HTTP ${res.status}`);
  return res.json();
}

async function listModels() {
  const models = await fetchModels();

  const imageModels = models.filter((m) =>
    (m.output_modalities ?? []).includes('image'),
  );

  const free = imageModels.filter((m) => m.paid_only !== true);
  const paid = imageModels.filter((m) => m.paid_only === true);

  console.log('\nFree (non-paid) image models:');
  console.log('─'.repeat(50));
  for (const m of free) {
    const imgSupport = (m.input_modalities ?? []).includes('image')
      ? ' [supports image input]'
      : '';
    console.log(`  ${m.name.padEnd(20)} ${m.description}${imgSupport}`);
  }

  console.log('\nPaid models (excluded):');
  console.log('─'.repeat(50));
  for (const m of paid) {
    console.log(`  ${m.name} - ${m.description}`);
  }
}

async function validateModel(modelName, hasImage) {
  let models;
  try {
    models = await fetchModels();
  } catch {
    console.error('Warning: Could not fetch model list, skipping paid-check');
    return;
  }

  const match = models.find((m) => m.name === modelName);
  if (!match) {
    console.error(
      `Error: Model '${modelName}' not found. Use --list-models to see options.`,
    );
    process.exit(1);
  }

  if (match.paid_only === true) {
    console.error(
      `Error: Model '${modelName}' is paid-only. Use --list-models to see free options.`,
    );
    process.exit(1);
  }

  if (hasImage && !(match.input_modalities ?? []).includes('image')) {
    console.error(`Error: Model '${modelName}' does not support image input.`);
    const withImage = models
      .filter(
        (m) =>
          m.paid_only !== true && (m.input_modalities ?? []).includes('image'),
      )
      .map((m) => `  ${m.name}`);
    console.error('Models with image input support:\n' + withImage.join('\n'));
    process.exit(1);
  }
}

// --- Image generation ---

async function generateImage(args) {
  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    console.error(
      'Error: POLLINATIONS_API_KEY environment variable is not set',
    );
    process.exit(1);
  }

  if (!args.prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  await validateModel(args.model, !!args.image);

  // Build URL
  const encoded = encodeURIComponent(args.prompt);
  const params = new URLSearchParams({
    model: args.model,
    seed: '-1',
    safe: 'false',
  });

  if (args.negative) params.set('negative_prompt', args.negative);
  if (args.enhance) params.set('enhance', 'true');
  if (args.image) params.set('image', args.image);

  const url = `${BASE_URL}/image/${encoded}?${params}`;

  // Resolve output path
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const outputPath =
    args.output || `${DEFAULT_OUTPUT_DIR}/generated-${timestamp}.jpg`;

  mkdirSync(dirname(outputPath), { recursive: true });

  // Log what we're doing
  console.log(`Generating image with model: ${args.model}`);
  console.log(`Prompt: ${args.prompt}`);
  if (args.negative) console.log(`Negative prompt: ${args.negative}`);
  if (args.enhance) console.log('Enhancement: enabled');
  if (args.image) console.log(`Reference image: ${args.image}`);

  // Fetch
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error?.message) message = body.error.message;
    } catch {
      /* not JSON */
    }
    console.error(`Error: API returned ${message}`);
    process.exit(1);
  }

  // Save
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(outputPath, buffer);

  const size = statSync(outputPath).size;
  console.log(`\n--- Result ---`);
  console.log(`File: ${outputPath}`);
  console.log(`Size: ${size} bytes`);
  console.log(`Model: ${args.model}`);
  console.log(`Prompt: ${args.prompt}`);
}

// --- Main ---

const args = parseArgs(process.argv);

// Show help when --help or no flags are passed
if (args.help || process.argv.length <= 2) {
  console.log(HELP);
  process.exit(0);
}

if (args.listModels) {
  await listModels();
} else {
  await generateImage(args);
}
