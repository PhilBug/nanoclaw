#!/usr/bin/env node

/**
 * Discover free OpenRouter models that support image input and text output.
 * Prints sorted model IDs to stdout, one per line.
 *
 * Environment:
 *   OPENROUTER_API_KEY  - optional, authenticated requests may see more models
 *   FREE_BY             - "pricing" (default), "suffix", or "either"
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FREE_BY = process.env.FREE_BY || 'pricing';

const URL = 'https://openrouter.ai/api/v1/models?output_modalities=text';

function isZero(value) {
  return String(value || '0').trim() === '0';
}

function isFree(model) {
  const modelId = model.id || '';
  const pricing = model.pricing || {};

  const bySuffix = modelId.endsWith(':free');
  const byPricing = ['prompt', 'completion', 'request', 'image'].every(
    (field) => isZero(pricing[field]),
  );

  if (FREE_BY === 'suffix') return bySuffix;
  if (FREE_BY === 'pricing') return byPricing;
  if (FREE_BY === 'either') return bySuffix || byPricing;

  throw new Error('FREE_BY must be one of: pricing, suffix, either');
}

async function main() {
  const headers = {};
  if (OPENROUTER_API_KEY) {
    headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;
  }

  const resp = await fetch(URL, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `OpenRouter API returned ${resp.status}: ${body.slice(0, 300)}`,
    );
  }

  const json = await resp.json();
  const data = json.data || [];

  const result = [];

  for (const model of data) {
    const arch = model.architecture || {};
    const inputModalities = new Set(arch.input_modalities || []);
    const outputModalities = new Set(arch.output_modalities || []);

    if (
      inputModalities.has('image') &&
      outputModalities.has('text') &&
      isFree(model)
    ) {
      result.push(model.id);
    }
  }

  result.sort();

  if (result.length === 0) {
    throw new Error('No free vision-capable models found on OpenRouter');
  }

  for (const id of result) {
    console.log(id);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
