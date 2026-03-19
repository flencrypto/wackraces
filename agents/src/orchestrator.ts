/**
 * Orchestrator Agent
 *
 * Responsibilities:
 *  - Acts as the central coordinator for all four agents.
 *  - Sends periodic HEARTBEAT messages and tracks which agents are alive.
 *  - Reacts to events from other agents:
 *      ALERT (from Ops) → commands Debug Agent to analyze logs
 *      DEBUG_REPORT     → if build-related issues found, commands Build Agent to rebuild
 *      BUILD_RESULT     → if build succeeded, commands Ops Agent to verify health
 *      HEALTH_REPORT    → updates internal state; logs overall health summary
 *  - Exposes a tiny HTTP dashboard on AGENTS_STATUS_PORT (default 4000) that
 *    returns the current system state as JSON.
 */

import * as http from 'http';
import { publish, subscribe } from './bus';
import { config } from './config';
import type {
  AgentMessage,
  AgentName,
  AgentStatus,
  BuildResult,
  DebugReport,
  HealthReport,
  OrchestratorState,
} from './types';

const AGENT = 'orchestrator' as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[Orchestrator] ${msg}`);
}

// ─── State ────────────────────────────────────────────────────────────────────

const agentNames: AgentName[] = ['build', 'ops', 'debug'];

const state: OrchestratorState = {
  agents: agentNames.map((name) => ({
    name,
    lastHeartbeat: null,
    alive: false,
  })),
  lastHealthReport: null,
  lastDebugReport: null,
  lastBuildResults: [],
};

function getAgent(name: AgentName): AgentStatus | undefined {
  return state.agents.find((a) => a.name === name);
}

function markAlive(name: AgentName): void {
  const a = getAgent(name);
  if (a) {
    a.lastHeartbeat = new Date().toISOString();
    a.alive = true;
  }
}

/** Refresh the alive flag based on last heartbeat timestamp. */
function refreshAliveness(): void {
  const now = Date.now();
  for (const a of state.agents) {
    if (a.lastHeartbeat) {
      const age = now - new Date(a.lastHeartbeat).getTime();
      a.alive = age < config.heartbeatTimeoutSec * 1_000;
    }
  }
}

// ─── Build-related pattern detection ─────────────────────────────────────────

const BUILD_RELATED_PATTERNS = new Set([
  'JS_RUNTIME_ERROR',
  'MODULE_NOT_FOUND',
  'UNHANDLED_REJECTION',
  'MISSING_TABLE',
]);

function serviceFromDebugReport(report: DebugReport): string | null {
  const buildIssue = report.issues.find((i) => BUILD_RELATED_PATTERNS.has(i.pattern));
  return buildIssue ? buildIssue.service : null;
}

// ─── Reaction logic ───────────────────────────────────────────────────────────

function onAlert(msg: AgentMessage): void {
  const { service, error } = msg.payload as { service?: string; error?: string };
  log(`🚨  ALERT received from ${msg.from}: service="${service}" error="${error}"`);

  // Command the Debug Agent to analyse logs for the affected service
  publish(AGENT, 'debug', 'COMMAND', {
    action: 'ANALYZE_LOGS',
    service: service ?? 'all',
    context: { triggeredBy: 'ALERT', from: msg.from, originalError: error },
  });
}

function onDebugReport(report: DebugReport): void {
  state.lastDebugReport = report;
  log(`📋  DEBUG_REPORT received – ${report.issueCount} issue(s)`);

  if (report.issueCount > 0) {
    log('    Suggested actions:');
    report.suggestedActions.forEach((a) => log(`      • ${a}`));
  }

  // If any build-related issue is detected, try to rebuild
  const service = serviceFromDebugReport(report);
  if (service && ['api', 'web', 'processor'].includes(service)) {
    log(`🔨  Build-related issue in "${service}" – ordering Build Agent to rebuild …`);
    publish(AGENT, 'build', 'COMMAND', { action: 'BUILD', service });
  }
}

function onBuildResult(result: BuildResult): void {
  // Keep last 10 results
  state.lastBuildResults.unshift(result);
  state.lastBuildResults = state.lastBuildResults.slice(0, 10);

  const icon = result.success ? '✅' : '❌';
  log(`${icon}  BUILD_RESULT: ${result.service} ${result.action} – success=${result.success} (${result.durationMs} ms)`);

  if (result.success) {
    // Ask the Ops Agent to verify health now that the build completed
    log('🔎  Build succeeded – requesting health check …');
    publish(AGENT, 'ops', 'COMMAND', { action: 'CHECK_HEALTH' });
  }
}

function onHealthReport(report: HealthReport): void {
  state.lastHealthReport = report;
  const icon = report.allHealthy ? '✅' : '⚠️ ';
  const unhealthy = report.checks.filter((c) => !c.healthy).map((c) => c.service).join(', ');
  log(`${icon}  HEALTH_REPORT: allHealthy=${report.allHealthy}${unhealthy ? ` (degraded: ${unhealthy})` : ''}`);
}

// ─── Message router ───────────────────────────────────────────────────────────

function handleMessage(msg: AgentMessage): void {
  // Ignore messages from self
  if (msg.from === AGENT) return;
  // Ignore messages not addressed to us (or broadcast)
  if (msg.to !== AGENT && msg.to !== 'all') return;

  switch (msg.type) {
    case 'HEARTBEAT_ACK':
      markAlive(msg.from as AgentName);
      break;

    case 'STATUS_UPDATE': {
      const payload = msg.payload as { agent?: string; status?: string };
      log(`ℹ️   STATUS from ${msg.from}: ${payload.status ?? JSON.stringify(msg.payload)}`);
      break;
    }

    case 'ALERT':
      onAlert(msg);
      break;

    case 'DEBUG_REPORT':
      onDebugReport(msg.payload as unknown as DebugReport);
      break;

    case 'BUILD_RESULT':
      onBuildResult(msg.payload as unknown as BuildResult);
      break;

    case 'HEALTH_REPORT':
      onHealthReport(msg.payload as unknown as HealthReport);
      break;

    default:
      break;
  }
}

// ─── Heartbeat loop ───────────────────────────────────────────────────────────

function startHeartbeat(): void {
  setInterval(() => {
    refreshAliveness();

    const alive = state.agents.filter((a) => a.alive).map((a) => a.name);
    const dead = state.agents.filter((a) => !a.alive).map((a) => a.name);

    log(`💓  Heartbeat – alive: [${alive.join(', ')}]${dead.length ? `  dead: [${dead.join(', ')}]` : ''}`);
    publish(AGENT, 'all', 'HEARTBEAT', { timestamp: new Date().toISOString() });
  }, config.heartbeatIntervalMs);
}

// ─── HTTP status dashboard ────────────────────────────────────────────────────

function startStatusServer(): void {
  const server = http.createServer((req, res) => {
    if (req.url === '/status' || req.url === '/') {
      refreshAliveness();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(config.statusPort, () => {
    log(`📊  Status dashboard listening on http://localhost:${config.statusPort}/status`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`⚠️   Port ${config.statusPort} already in use – status dashboard disabled.`);
    } else {
      log(`Status server error: ${err.message}`);
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startOrchestrator(): void {
  log('Orchestrator starting …');

  subscribe(handleMessage);
  startHeartbeat();
  startStatusServer();

  // Initial broadcast to all agents
  publish(AGENT, 'all', 'HEARTBEAT', { timestamp: new Date().toISOString() });

  log(
    `Orchestrator ready. Coordinating: [${agentNames.join(', ')}].` +
    ` Heartbeat every ${config.heartbeatIntervalMs / 1000} s.`,
  );
}
