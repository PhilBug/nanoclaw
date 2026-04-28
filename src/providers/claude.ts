/**
 * Claude provider container config — only registered when the user has
 * configured a custom Anthropic-compatible endpoint via setup. Setup
 * appends `import './claude.js'` to providers/index.ts at that point;
 * standard installs hitting api.anthropic.com don't need this file
 * loaded.
 *
 * The real auth token never enters the container. Setup creates an
 * OneCLI generic secret (host-pattern = base URL hostname, header-name
 * = Authorization, value-format = "Bearer {value}") so the proxy
 * rewrites the Authorization header on the wire. The container only
 * needs:
 *   - ANTHROPIC_BASE_URL — so the SDK knows where to call
 *   - ANTHROPIC_AUTH_TOKEN=placeholder — so the SDK adds an
 *     Authorization: Bearer header for OneCLI to overwrite
 */
import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

registerProviderContainerConfig('claude', () => {
  const dotenv = readEnvFile([
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'GH_TOKEN',
    'TAVILY_API_KEY',
    'OPENROUTER_API_KEY',
    'CONTEXT7_API_KEY',
    'POLLINATIONS_API_KEY',
  ]);
  const env: Record<string, string> = {};
  if (dotenv.ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = dotenv.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_AUTH_TOKEN = dotenv.ANTHROPIC_API_KEY || 'placeholder';
  }
  if (dotenv.GH_TOKEN) env.GH_TOKEN = dotenv.GH_TOKEN;
  if (dotenv.TAVILY_API_KEY) env.TAVILY_API_KEY = dotenv.TAVILY_API_KEY;
  if (dotenv.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = dotenv.OPENROUTER_API_KEY;
  if (dotenv.CONTEXT7_API_KEY) env.CONTEXT7_API_KEY = dotenv.CONTEXT7_API_KEY;
  if (dotenv.POLLINATIONS_API_KEY) env.POLLINATIONS_API_KEY = dotenv.POLLINATIONS_API_KEY;
  return { env };
});
