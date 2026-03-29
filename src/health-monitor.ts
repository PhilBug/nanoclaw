/**
 * Health Monitor & Auto-Alerting for NanoClaw
 *
 * Proactive monitoring that runs inside the main NanoClaw process.
 * Detects Docker daemon downtime, channel disconnections, queue backlogs,
 * and container error rates. Sends alerts to the main group with deduplication
 * and recovery notifications.
 *
 * Health snapshots are written to the main group's IPC directory so the
 * /health container skill can read them.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  HEALTH_ALERT_COOLDOWN_CHANNEL,
  HEALTH_ALERT_COOLDOWN_DOCKER,
  HEALTH_ALERT_COOLDOWN_QUEUE,
  HEALTH_CHECK_INTERVAL,
  HEALTH_CONTAINER_ERROR_THRESHOLD,
  HEALTH_DOCKER_TIMEOUT,
  HEALTH_ERROR_WINDOW_MS,
  HEALTH_QUEUE_BACKLOG_THRESHOLD,
} from './config.js';
import { DATA_DIR } from './config.js';
import {
  getRecentContainerErrors,
  getRouterState,
  setRouterState,
} from './db.js';
import { logger } from './logger.js';
import type { Channel, HealthStatus, RegisteredGroup } from './types.js';
import { QueueStats } from './group-queue.js';

export interface HealthMonitorDependencies {
  channels: () => Channel[];
  queue: {
    getStats(): QueueStats;
  };
  registeredGroups: () => Record<string, RegisteredGroup>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

let healthMonitorRunning = false;

export function _resetHealthMonitorForTests(): void {
  healthMonitorRunning = false;
}

/**
 * Start the health monitoring loop.
 * Runs independently alongside the message loop and scheduler.
 */
export function startHealthMonitor(deps: HealthMonitorDependencies): void {
  if (healthMonitorRunning) {
    logger.warn('Health monitor already running, skipping');
    return;
  }
  healthMonitorRunning = true;
  logger.info(
    { intervalMs: HEALTH_CHECK_INTERVAL },
    'Starting health monitor',
  );
  runHealthLoop(deps);
}

async function runHealthLoop(deps: HealthMonitorDependencies): Promise<void> {
  while (true) {
    try {
      await runHealthCheck(deps);
    } catch (err) {
      logger.error({ err }, 'Health monitor check failed');
    }
    await sleep(HEALTH_CHECK_INTERVAL);
  }
}

async function runHealthCheck(deps: HealthMonitorDependencies): Promise<void> {
  const now = new Date().toISOString();

  // 1. Check Docker daemon (highest priority)
  const dockerResult = checkDockerDaemon();

  // 2. Check channel connections
  const channels = deps.channels();
  const channelStatuses = channels.map((ch) => ({
    name: ch.name,
    connected: ch.isConnected(),
  }));

  // 3. Check queue health
  const queueStats = deps.queue.getStats();

  // 4. Check container error rate
  const recentErrors = getRecentContainerErrors(HEALTH_ERROR_WINDOW_MS);

  // Build health status snapshot
  const healthStatus: HealthStatus = {
    timestamp: now,
    docker: dockerResult,
    channels: channelStatuses,
    queue: {
      activeCount: queueStats.activeCount,
      waitingCount: queueStats.waitingCount,
      groupCount: queueStats.groupCount,
    },
    containerErrors: {
      recentErrors,
      consecutiveFailures: getConsecutiveFailures(),
    },
    uptime: process.uptime(),
  };

  // Write snapshot to main group IPC directory
  writeHealthSnapshot(healthStatus, deps);

  // Find main group JID for alerts
  const mainGroup = findMainGroup(deps);
  if (!mainGroup) return;

  // Process alerts
  await processAlerts(deps, mainGroup.jid, mainGroup, healthStatus, channels);
}

function checkDockerDaemon(): { ok: boolean; latencyMs: number } {
  const start = Date.now();
  try {
    execSync('docker info', {
      stdio: 'pipe',
      timeout: HEALTH_DOCKER_TIMEOUT,
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

function getConsecutiveFailures(): number {
  const raw = getRouterState('health_consecutive_failures');
  return raw ? parseInt(raw, 10) || 0 : 0;
}

function incrementConsecutiveFailures(): void {
  const current = getConsecutiveFailures();
  setRouterState('health_consecutive_failures', String(current + 1));
}

function resetConsecutiveFailures(): void {
  setRouterState('health_consecutive_failures', '0');
}

function findMainGroup(deps: HealthMonitorDependencies):
  | (RegisteredGroup & { jid: string })
  | undefined {
  const groups = deps.registeredGroups();
  for (const [jid, group] of Object.entries(groups)) {
    if (group.isMain) return { ...group, jid };
  }
  return undefined;
}

async function processAlerts(
  deps: HealthMonitorDependencies,
  mainJid: string,
  _mainGroup: RegisteredGroup & { jid: string },
  status: HealthStatus,
  channels: Channel[],
): Promise<void> {
  // --- Docker daemon ---
  const wasDockerDown = getRouterState('health_was_docker_down') === '1';

  if (!status.docker.ok) {
    setRouterState('health_was_docker_down', '1');
    incrementConsecutiveFailures();
    if (shouldAlert('docker')) {
      await sendAlert(
        deps,
        mainJid,
        channels,
        `🔴 CRITICAL: Docker daemon is unreachable (latency: ${status.docker.latencyMs}ms). Agent containers cannot run. Consecutive failures: ${getConsecutiveFailures()}.`,
      );
    }
  } else if (wasDockerDown) {
    // Recovery!
    setRouterState('health_was_docker_down', '0');
    resetConsecutiveFailures();
    await sendAlert(
      deps,
      mainJid,
      channels,
      `🟢 RECOVERY: Docker daemon is back online (latency: ${status.docker.latencyMs}ms).`,
    );
  } else {
    resetConsecutiveFailures();
  }

  // --- Channel disconnections ---
  const disconnectedChannels = status.channels.filter((ch) => !ch.connected);
  const wasChannelsDown =
    getRouterState('health_was_channels_down') === '1';

  if (disconnectedChannels.length > 0) {
    const names = disconnectedChannels.map((ch) => ch.name).join(', ');
    setRouterState('health_was_channels_down', '1');
    if (shouldAlert('channel')) {
      await sendAlert(
        deps,
        mainJid,
        channels,
        `🟡 WARNING: Channel(s) disconnected: ${names}`,
      );
    }
  } else if (wasChannelsDown) {
    setRouterState('health_was_channels_down', '0');
    await sendAlert(
      deps,
      mainJid,
      channels,
      `🟢 RECOVERY: All channels reconnected.`,
    );
  }

  // --- Queue backlog ---
  if (status.queue.waitingCount > HEALTH_QUEUE_BACKLOG_THRESHOLD) {
    if (shouldAlert('queue')) {
      await sendAlert(
        deps,
        mainJid,
        channels,
        `🟡 WARNING: ${status.queue.waitingCount} groups waiting in queue (${status.queue.activeCount}/${5} containers active).`,
      );
    }
  }

  // --- Container error rate ---
  if (status.containerErrors.recentErrors > HEALTH_CONTAINER_ERROR_THRESHOLD) {
    const lastAlertKey = 'health_last_alert_errors';
    const lastAlert = getRouterState(lastAlertKey);
    const cooldown = HEALTH_ALERT_COOLDOWN_CHANNEL;
    if (!lastAlert || Date.now() - new Date(lastAlert).getTime() > cooldown) {
      await sendAlert(
        deps,
        mainJid,
        channels,
        `🟡 WARNING: ${status.containerErrors.recentErrors} container errors in the last ${HEALTH_ERROR_WINDOW_MS / 60000} minutes.`,
      );
      setRouterState(lastAlertKey, new Date().toISOString());
    }
  }
}

function shouldAlert(type: 'docker' | 'channel' | 'queue'): boolean {
  const key = `health_last_alert_${type}`;
  const cooldown =
    type === 'docker'
      ? HEALTH_ALERT_COOLDOWN_DOCKER
      : type === 'channel'
        ? HEALTH_ALERT_COOLDOWN_CHANNEL
        : HEALTH_ALERT_COOLDOWN_QUEUE;

  const lastAlert = getRouterState(key);
  if (lastAlert) {
    const elapsed = Date.now() - new Date(lastAlert).getTime();
    if (elapsed < cooldown) return false;
  }

  setRouterState(key, new Date().toISOString());
  return true;
}

async function sendAlert(
  deps: HealthMonitorDependencies,
  jid: string,
  channels: Channel[],
  text: string,
): Promise<void> {
  try {
    await deps.sendMessage(jid, text);
    logger.info({ jid }, 'Health alert sent');
  } catch (err) {
    // If primary channel fails, try fallback
    logger.warn(
      { jid, err },
      'Failed to send health alert via primary channel, trying fallback',
    );
    const fallback = channels.find((ch) => ch.isConnected());
    if (fallback) {
      try {
        await fallback.sendMessage(jid, text);
        logger.info(
          { jid, fallbackChannel: fallback.name },
          'Health alert sent via fallback channel',
        );
      } catch (fallbackErr) {
        logger.error(
          { jid, fallbackChannel: fallback.name, err: fallbackErr },
          'Failed to send health alert via fallback channel',
        );
      }
    } else {
      logger.error(
        { jid },
        'No connected channel available for health alert',
      );
    }
  }
}

function writeHealthSnapshot(
  status: HealthStatus,
  deps: HealthMonitorDependencies,
): void {
  try {
    const groups = deps.registeredGroups();
    for (const [, group] of Object.entries(groups)) {
      if (!group.isMain) continue;

      const ipcDir = path.join(DATA_DIR, 'ipc', group.folder);
      fs.mkdirSync(ipcDir, { recursive: true });
      const snapshotPath = path.join(ipcDir, 'health_snapshot.json');
      const tmpPath = `${snapshotPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
      fs.renameSync(tmpPath, snapshotPath);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to write health snapshot');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
