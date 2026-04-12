#!/usr/bin/env node

/**
 * Query and filter the OpenRouter model catalog.
 *
 * Environment:
 *   OPENROUTER_API_KEY  - optional, authenticated requests may see more models
 *
 * Flags:
 *   --free              - only free models (zero pricing or :free suffix)
 *   --image             - models with image input modality
 *   --audio             - models with audio input modality
 *   --video             - models with video input modality
 *   --tools             - models supporting tool use
 *   --output MODALITY   - filter by output modality (text|image|audio|embeddings)
 *   --min-context N     - minimum context length in tokens
 *   --search QUERY      - substring match on model ID, name, or description
 *   --json              - output full JSON instead of table
 *   --limit N           - max results (default 50)
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const URL = 'https://openrouter.ai/api/v1/models';

// --- Arg parsing ---

function parseArgs(argv) {
  const flags = {
    free: false,
    image: false,
    audio: false,
    video: false,
    tools: false,
    output: null,
    minContext: 0,
    search: null,
    json: false,
    limit: 50,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--free':
        flags.free = true;
        break;
      case '--image':
        flags.image = true;
        break;
      case '--audio':
        flags.audio = true;
        break;
      case '--video':
        flags.video = true;
        break;
      case '--tools':
        flags.tools = true;
        break;
      case '--output':
        flags.output = argv[++i]?.toUpperCase();
        break;
      case '--min-context':
        flags.minContext = parseInt(argv[++i], 10) || 0;
        break;
      case '--search':
        flags.search = argv[++i]?.toLowerCase();
        break;
      case '--json':
        flags.json = true;
        break;
      case '--limit':
        flags.limit = parseInt(argv[++i], 10) || 50;
        break;
      default:
        process.stderr.write(`Unknown flag: ${arg}\n`);
        process.exit(1);
    }
  }

  return flags;
}

// --- Filters ---

function isZero(value) {
  return String(value || '0').trim() === '0';
}

function isFree(model) {
  const bySuffix = (model.id || '').endsWith(':free');
  const pricing = model.pricing || {};
  const byPricing = ['prompt', 'completion', 'request'].every((f) =>
    isZero(pricing[f]),
  );
  return bySuffix || byPricing;
}

function matchesFilters(model, flags) {
  const arch = model.architecture || {};
  const inputModalities = new Set(arch.input_modalities || []);
  const outputModalities = new Set(
    (model.output_modalities || []).map((m) => m.toUpperCase()),
  );
  const supportedParams = new Set(model.supported_parameters || []);
  const contextLength = model.context_length || 0;

  if (flags.free && !isFree(model)) return false;

  if (flags.image && !inputModalities.has('image')) return false;
  if (flags.audio && !inputModalities.has('audio')) return false;
  if (flags.video && !inputModalities.has('video')) return false;

  if (flags.tools && !supportedParams.has('tools')) return false;

  if (flags.output && !outputModalities.has(flags.output)) return false;

  if (flags.minContext && contextLength < flags.minContext) return false;

  if (flags.search) {
    const q = flags.search;
    const haystack = [
      model.id || '',
      model.name || '',
      model.description || '',
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

// --- Output formatting ---

function formatPricing(pricing) {
  const prompt = pricing?.prompt;
  const completion = pricing?.completion;
  if (
    isZero(prompt) &&
    isZero(completion) &&
    isZero(pricing?.request)
  ) {
    return 'free';
  }
  const p = parseFloat(prompt || 0);
  const c = parseFloat(completion || 0);
  if (p === 0 && c === 0) return 'free';
  return `$${p}/$${c}`;
}

function formatModalities(modalities) {
  if (!modalities || modalities.length === 0) return '-';
  return modalities.join(',');
}

function printTable(models) {
  if (models.length === 0) {
    console.log('No models matched the given filters.');
    return;
  }

  // Determine column widths
  let idW = 8; // "Model ID"
  let ctxW = 7; // "Context"
  let inW = 5; // "Input"
  let priceW = 6; // "Pricing"

  const rows = models.map((m) => {
    const id = m.id || '';
    const ctx = String(m.context_length || 0);
    const input = formatModalities(m.architecture?.input_modalities);
    const price = formatPricing(m.pricing);
    idW = Math.max(idW, id.length);
    ctxW = Math.max(ctxW, ctx.length);
    inW = Math.max(inW, input.length);
    priceW = Math.max(priceW, price.length);
    return { id, ctx, input, price };
  });

  const header = [
    'Model ID'.padEnd(idW),
    'Context'.padEnd(ctxW),
    'Input'.padEnd(inW),
    'Pricing'.padEnd(priceW),
  ].join('  ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of rows) {
    console.log(
      [
        r.id.padEnd(idW),
        r.ctx.padEnd(ctxW),
        r.input.padEnd(inW),
        r.price.padEnd(priceW),
      ].join('  '),
    );
  }

  console.log(`\n${models.length} model(s)`);
}

// --- Main ---

async function main() {
  const flags = parseArgs(process.argv);

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

  const results = data
    .filter((m) => matchesFilters(m, flags))
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
    .slice(0, flags.limit);

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printTable(results);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
