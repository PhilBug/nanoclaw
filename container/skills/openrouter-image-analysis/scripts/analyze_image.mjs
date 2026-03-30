#!/usr/bin/env node

/**
 * Analyze an image using OpenRouter's vision models.
 *
 * Zero external dependencies — uses only Node.js built-ins.
 * Accepts local file paths (png, jpg, jpeg, webp, gif, bmp) or HTTP/HTTPS URLs.
 */

import { readFileSync, existsSync } from 'fs';
import { extname, resolve, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_PROMPT =
  'Describe the image and extract any important visible text, errors, UI elements, diagrams, or notable details.';

const SUPPORTED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
]);

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function encodeLocalImage(filePath) {
  const abs = resolve(filePath.replace(/^~/, process.env.HOME || '~'));
  if (!existsSync(abs)) die(`file not found: ${abs}`);

  const ext = extname(abs).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    die(
      `unsupported image format '${ext}'. Supported: ${[...SUPPORTED_EXTENSIONS].sort().join(', ')}`,
    );
  }

  const mime = MIME_MAP[ext] || `image/${ext.slice(1)}`;
  const data = readFileSync(abs);
  const b64 = Buffer.from(data).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function resolveModel() {
  const pinned = process.env.OPENROUTER_VISION_MODEL;
  if (pinned) return pinned;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const helper = resolve(__dirname, 'find_free_models.mjs');

  if (!existsSync(helper)) die(`helper script not found: ${helper}`);

  let stdout;
  try {
    stdout = execFileSync('node', [helper], {
      encoding: 'utf-8',
      timeout: 30_000,
    });
  } catch (e) {
    if (e.code === 'ENOENT')
      die(
        "'node' not found in PATH. Set OPENROUTER_VISION_MODEL to skip discovery.",
      );
    if (e.killed) die('model discovery timed out after 30s');
    die(`model discovery failed: ${(e.stderr || '').trim()}`);
  }

  const models = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (models.length === 0) {
    die(
      'no free vision-capable models found on OpenRouter. Set OPENROUTER_VISION_MODEL to specify one manually.',
    );
  }

  return models[0];
}

async function analyzeImage(imageRef, prompt, model) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) die('OPENROUTER_API_KEY environment variable not set');

  const imageUrl =
    imageRef.startsWith('http://') || imageRef.startsWith('https://')
      ? imageRef
      : encodeLocalImage(imageRef);

  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 4096,
  };

  let resp;
  try {
    resp = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    die(`request failed: ${e.message}`);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    die(`OpenRouter API returned ${resp.status}: ${body.slice(0, 500)}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    die('failed to parse API response as JSON');
  }

  try {
    return data.choices[0].message.content;
  } catch {
    die(`unexpected API response: ${JSON.stringify(data).slice(0, 500)}`);
  }
}

// --- main ---

const args = process.argv.slice(2);
if (args.length < 1) {
  process.stderr.write(
    'Usage: analyze_image.mjs <image_path_or_url> [prompt]\n' +
      '  image_path_or_url  local file path or http(s) URL\n' +
      '  prompt             optional analysis instruction\n',
  );
  process.exit(1);
}

const imageRef = args[0];
const prompt = args.slice(1).join(' ') || DEFAULT_PROMPT;
const model = resolveModel();

process.stderr.write(`[using model: ${model}]\n`);

const result = await analyzeImage(imageRef, prompt, model);
process.stdout.write(result + '\n');
