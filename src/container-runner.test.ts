import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Mock config
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000, // 30min
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000, // 30min
  OLLAMA_ADMIN_TOOLS: false,
  ONECLI_API_KEY: '',
  ONECLI_URL: 'http://localhost:10254',
  TIMEZONE: 'America/Los_Angeles',
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({
        isDirectory: () => false,
        isFile: () => false,
      })),
      copyFileSync: vi.fn(),
      cpSync: vi.fn(),
      rmSync: vi.fn(),
    },
  };
});

// Mock OneCLI SDK
vi.mock('@onecli-sh/sdk', () => ({
  OneCLI: class {
    applyContainerConfig = vi.fn().mockResolvedValue(true);
    createAgent = vi.fn().mockResolvedValue({ id: 'test' });
    ensureAgent = vi
      .fn()
      .mockResolvedValue({ name: 'test', identifier: 'test', created: true });
  },
}));

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

// Mock container-runtime
vi.mock('./container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  hostGatewayArgs: () => [],
  readonlyMountArgs: (h: string, c: string) => ['-v', `${h}:${c}:ro`],
  stopContainer: vi.fn(),
}));

// Mock credential-proxy
vi.mock('./credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => 'api-key'),
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (cb) cb(null);
        return new EventEmitter();
      },
    ),
  };
});

import {
  runContainerAgent,
  ContainerOutput,
  _syncAgentRunnerSrc,
  RUNTIME_ENV_KEYS,
  _syncContainerSkills,
  _syncRules,
} from './container-runner.js';
import type { RegisteredGroup } from './types.js';

const settingsFile =
  '/tmp/nanoclaw-test-data/sessions/test-group/.claude/settings.json';
const runtimeEnvFile =
  '/tmp/nanoclaw-test-data/sessions/test-group/.claude/runtime-env.sh';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(
  proc: ReturnType<typeof createFakeProcess>,
  output: ContainerOutput,
) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

function getWriteFileCall(pathname: string) {
  return vi
    .mocked(fs.writeFileSync)
    .mock.calls.find(([filePath]) => filePath === pathname);
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fakeProc = createFakeProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // No output emitted — fire the hard timeout
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });

  it('writes the allowlisted runtime env script for container skills', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      'TAVILY_API_KEY=tvly-test-key\n',
    );

    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      async () => {},
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      runtimeEnvFile,
      "export TAVILY_API_KEY='tvly-test-key'\n",
      {
        mode: 0o600,
      },
    );
  });

  it('writes model env values into generated Claude settings', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      [
        'ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-3-5-haiku-latest',
        'ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-5',
        'ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-1',
      ].join('\n'),
    );

    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      async () => {},
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const settingsWrite = getWriteFileCall(settingsFile);
    expect(settingsWrite).toBeTruthy();
    expect(JSON.parse(String(settingsWrite?.[1]))).toEqual({
      env: {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-3-5-haiku-latest',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-1',
      },
    });
  });

  it('resyncs managed model env keys without clobbering unrelated settings', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (filePath) => filePath === settingsFile,
    );
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (filePath === settingsFile) {
        return JSON.stringify({
          permissions: {
            allow: ['Bash'],
          },
          env: {
            KEEP_ME: 'yes',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'stale-haiku',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'stale-opus',
          },
        });
      }

      return [
        'ANTHROPIC_DEFAULT_HAIKU_MODEL=fresh-haiku',
        'ANTHROPIC_DEFAULT_SONNET_MODEL=fresh-sonnet',
      ].join('\n');
    });

    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      async () => {},
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const settingsWrite = getWriteFileCall(settingsFile);
    expect(settingsWrite).toBeTruthy();
    expect(JSON.parse(String(settingsWrite?.[1]))).toEqual({
      permissions: {
        allow: ['Bash'],
      },
      env: {
        KEEP_ME: 'yes',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fresh-haiku',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'fresh-sonnet',
      },
    });
  });
});

describe('_syncAgentRunnerSrc', () => {
  const agentRunnerSrc = path.join(
    process.cwd(),
    'container',
    'agent-runner',
    'src',
  );
  const groupAgentRunnerDir =
    '/tmp/nanoclaw-test-data/sessions/test-group/agent-runner-src';

  // Vitest overloads make mockImplementation strict; cast to any to avoid
  // PathLike vs string mismatches in test callbacks.
  const mockReaddir = (fn: (dir: string) => fs.Dirent[]) =>
    (fs.readdirSync as any).mockImplementation(fn);
  const mockStat = (fn: (p: string) => { mtimeMs: number }) =>
    (fs.statSync as any).mockImplementation(fn);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cache miss (first copy) — rmSync + cpSync called', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === agentRunnerSrc);
    mockReaddir((dir) => {
      if (dir === agentRunnerSrc)
        return [
          { name: 'index.ts', isDirectory: () => false },
        ] as unknown as fs.Dirent[];
      return [];
    });
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as fs.Stats);

    _syncAgentRunnerSrc('test-group');

    expect(fs.rmSync).toHaveBeenCalledWith(groupAgentRunnerDir, {
      recursive: true,
      force: true,
    });
    expect(fs.cpSync).toHaveBeenCalledWith(
      agentRunnerSrc,
      groupAgentRunnerDir,
      { recursive: true },
    );
  });

  it('cache hit (no copy needed) — neither called', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockReaddir((dir) => {
      if (dir === agentRunnerSrc || dir === groupAgentRunnerDir)
        return [
          { name: 'index.ts', isDirectory: () => false },
        ] as unknown as fs.Dirent[];
      return [];
    });
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as fs.Stats);

    _syncAgentRunnerSrc('test-group');

    expect(fs.cpSync).not.toHaveBeenCalled();
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('cache stale (source newer) — rmSync then cpSync called', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockReaddir((dir) => {
      if (dir === agentRunnerSrc || dir === groupAgentRunnerDir)
        return [
          { name: 'index.ts', isDirectory: () => false },
        ] as unknown as fs.Dirent[];
      return [];
    });
    mockStat((p) => {
      if (p.startsWith(agentRunnerSrc)) return { mtimeMs: 2000 };
      return { mtimeMs: 1000 };
    });

    _syncAgentRunnerSrc('test-group');

    expect(fs.rmSync).toHaveBeenCalledWith(groupAgentRunnerDir, {
      recursive: true,
      force: true,
    });
    expect(fs.cpSync).toHaveBeenCalledWith(
      agentRunnerSrc,
      groupAgentRunnerDir,
      { recursive: true },
    );
  });

  it('non-index.ts file change triggers copy (original bug this PR fixed)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockReaddir((dir) => {
      if (dir === agentRunnerSrc || dir === groupAgentRunnerDir)
        return [
          { name: 'index.ts', isDirectory: () => false },
          { name: 'ipc-mcp-stdio.ts', isDirectory: () => false },
        ] as unknown as fs.Dirent[];
      return [];
    });
    mockStat((p) => {
      const basename = path.basename(p);
      if (basename === 'index.ts') return { mtimeMs: 1000 };
      if (p.startsWith(agentRunnerSrc)) return { mtimeMs: 3000 };
      return { mtimeMs: 2000 };
    });

    _syncAgentRunnerSrc('test-group');

    expect(fs.rmSync).toHaveBeenCalledWith(groupAgentRunnerDir, {
      recursive: true,
      force: true,
    });
    expect(fs.cpSync).toHaveBeenCalledWith(
      agentRunnerSrc,
      groupAgentRunnerDir,
      { recursive: true },
    );
  });
});

// --- RUNTIME_ENV_KEYS allowlist ---

describe('RUNTIME_ENV_KEYS', () => {
  it('includes CONTEXT7_API_KEY for container env injection', () => {
    expect(RUNTIME_ENV_KEYS).toContain('CONTEXT7_API_KEY');
  });

  it('includes all other required runtime keys', () => {
    expect(RUNTIME_ENV_KEYS).toContain('TAVILY_API_KEY');
    expect(RUNTIME_ENV_KEYS).toContain('GH_TOKEN');
    expect(RUNTIME_ENV_KEYS).toContain('OPENROUTER_API_KEY');
    expect(RUNTIME_ENV_KEYS).toContain('POLLINATIONS_API_KEY');
  });
});

// --- _syncContainerSkills ---

describe('_syncContainerSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies skill directories into group sessions', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['find-docs'] as any);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
    } as fs.Stats);

    _syncContainerSkills('/sessions/.claude');

    expect(fs.cpSync).toHaveBeenCalledWith(
      expect.stringContaining('container/skills/find-docs'),
      expect.stringContaining('sessions/.claude/skills/find-docs'),
      { recursive: true },
    );
  });

  it('skips non-directory entries', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['README.md'] as any);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
    } as fs.Stats);

    _syncContainerSkills('/sessions/.claude');

    expect(fs.cpSync).not.toHaveBeenCalled();
  });

  it('does nothing when container/skills/ does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    _syncContainerSkills('/sessions/.claude');

    expect(fs.readdirSync).not.toHaveBeenCalled();
  });
});

// --- _syncRules ---

describe('_syncRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies rule files into group sessions', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['context7.md'] as any);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
    } as fs.Stats);

    _syncRules('/sessions/.claude');

    expect(fs.cpSync).toHaveBeenCalledWith(
      expect.stringContaining('.claude/rules/context7.md'),
      expect.stringContaining('sessions/.claude/rules/context7.md'),
    );
  });

  it('skips subdirectories inside .claude/rules/', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['nested-dir'] as any);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => false,
    } as fs.Stats);

    _syncRules('/sessions/.claude');

    expect(fs.cpSync).not.toHaveBeenCalled();
  });

  it('does nothing when .claude/rules/ does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    _syncRules('/sessions/.claude');

    expect(fs.readdirSync).not.toHaveBeenCalled();
  });
});
