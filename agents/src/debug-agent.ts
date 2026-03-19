/**
 * Debug Agent
 *
 * Responsibilities:
 *  - Waits for ALERT messages forwarded by the Orchestrator.
 *  - Collects recent logs for the affected service via Docker Compose
 *    (when AGENTS_USE_DOCKER=true) or by reading files under logs/.
 *  - Runs pattern-matching heuristics to identify the root cause.
 *  - Publishes a DEBUG_REPORT back to the Orchestrator that includes:
 *      • identified issues with severity levels
 *      • the evidence (matching log lines)
 *      • a suggested remediation action per issue
 *  - Can also perform a full-stack analysis on-demand via COMMAND.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { publish, subscribe } from './bus';
import { config } from './config';
import type {
  AgentMessage,
  DebugIssue,
  DebugReport,
} from './types';

const AGENT = 'debug' as const;

// ─── Log patterns ─────────────────────────────────────────────────────────────

interface LogPattern {
  regex: RegExp;
  severity: DebugIssue['severity'];
  pattern: string;
  description: string;
  suggestedFix: string;
}

const LOG_PATTERNS: LogPattern[] = [
  {
    regex: /ECONNREFUSED/i,
    severity: 'critical',
    pattern: 'ECONNREFUSED',
    description: 'A service cannot reach a dependency (database, Redis, or another service).',
    suggestedFix:
      'Verify the target service is running and its port is reachable. Check REDIS_HOST, DATABASE_URL, and docker-compose service dependencies.',
  },
  {
    regex: /ENOTFOUND/i,
    severity: 'critical',
    pattern: 'ENOTFOUND',
    description: 'DNS resolution failed – hostname cannot be resolved.',
    suggestedFix:
      'Check the hostname in DATABASE_URL / REDIS_HOST. In Docker Compose, use service names (e.g. "db", "redis") not "localhost".',
  },
  {
    regex: /password authentication failed/i,
    severity: 'critical',
    pattern: 'DB_AUTH_FAILURE',
    description: 'PostgreSQL rejected the database credentials.',
    suggestedFix:
      'Verify POSTGRES_USER, POSTGRES_PASSWORD, and DATABASE_URL in .env match the actual database configuration.',
  },
  {
    regex: /relation ".+" does not exist/i,
    severity: 'critical',
    pattern: 'MISSING_TABLE',
    description: 'A required database table is missing – migrations have not been applied.',
    suggestedFix: 'Run `npm run migrate` (or `docker compose exec api npm run migrate`) to apply pending migrations.',
  },
  {
    regex: /out of memory|ENOMEM/i,
    severity: 'critical',
    pattern: 'OOM',
    description: 'Process ran out of memory.',
    suggestedFix: 'Increase the Node.js heap with --max-old-space-size or scale the container\'s memory limit.',
  },
  {
    regex: /SyntaxError|TypeError|ReferenceError/,
    severity: 'critical',
    pattern: 'JS_RUNTIME_ERROR',
    description: 'A JavaScript runtime error crashed the process.',
    suggestedFix:
      'Review the stack trace above this line, fix the code issue, and rebuild with `npm run build`.',
  },
  {
    regex: /Cannot find module/i,
    severity: 'critical',
    pattern: 'MODULE_NOT_FOUND',
    description: 'A required Node.js module is missing.',
    suggestedFix: 'Run `npm install` in the affected service directory and rebuild.',
  },
  {
    regex: /ETIMEDOUT|timed? ?out/i,
    severity: 'warning',
    pattern: 'TIMEOUT',
    description: 'A network connection or query timed out.',
    suggestedFix:
      'Check network latency, database query performance, and whether the target service is under heavy load.',
  },
  {
    regex: /too many connections/i,
    severity: 'warning',
    pattern: 'PG_TOO_MANY_CONNECTIONS',
    description: 'PostgreSQL connection pool is exhausted.',
    suggestedFix:
      'Reduce the `max` pool size in the API or processor, or increase max_connections in postgresql.conf.',
  },
  {
    regex: /jwt (expired|invalid|malformed)/i,
    severity: 'warning',
    pattern: 'JWT_ERROR',
    description: 'JWT token validation failed.',
    suggestedFix: 'Ensure JWT_SECRET in .env matches across all services and that system clocks are in sync.',
  },
  {
    regex: /CORS/i,
    severity: 'warning',
    pattern: 'CORS_ERROR',
    description: 'A CORS policy violation was detected.',
    suggestedFix: 'Verify CORS_ORIGINS in .env includes the frontend origin.',
  },
  {
    regex: /disk.*full|ENOSPC/i,
    severity: 'critical',
    pattern: 'DISK_FULL',
    description: 'Disk space is exhausted.',
    suggestedFix: 'Free up disk space, prune Docker images (`docker system prune`), or expand the volume.',
  },
  {
    regex: /unhandledRejection|UnhandledPromiseRejection/i,
    severity: 'warning',
    pattern: 'UNHANDLED_REJECTION',
    description: 'An unhandled Promise rejection was detected.',
    suggestedFix: 'Add proper error handling / catch clauses to the identified async code path.',
  },
  {
    regex: /error: relation/i,
    severity: 'warning',
    pattern: 'PG_RELATION_ERROR',
    description: 'PostgreSQL reported a relation/schema error.',
    suggestedFix: 'Check migration status and verify the schema matches the expected table structure.',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[DebugAgent] ${msg}`);
}

/** Execute a shell command and return stdout, tolerating non-zero exit codes. */
function runCommand(cmd: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (_err, stdout, stderr) => {
      resolve(stdout + stderr);
    });
  });
}

/** Collect logs via Docker Compose. */
async function collectDockerLogs(service: string, lines = 200): Promise<string> {
  const cwd = config.rootDir;
  const cmd = `docker compose logs --no-color --tail=${lines} ${service}`;
  log(`Collecting Docker logs: ${cmd}`);
  return runCommand(cmd);
}

/** Collect logs from a local log file (if the service writes to logs/). */
function collectFileLogs(service: string, lines = 200): string {
  const candidates = [
    path.join(config.rootDir, 'logs', `${service}.log`),
    path.join(config.rootDir, service, `${service}.log`),
    path.join('/tmp', `${service}.log`),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const logLines = content.split('\n');
        return logLines.slice(-lines).join('\n');
      } catch {
        // continue to next candidate
      }
    }
  }
  return '';
}

/** Gather logs for the given service, trying Docker first if configured. */
async function gatherLogs(service: string): Promise<string> {
  if (config.useDocker) {
    const dockerLogs = await collectDockerLogs(service);
    if (dockerLogs.trim()) return dockerLogs;
  }
  return collectFileLogs(service) || `(no logs found for service "${service}")`;
}

/** Gather logs for all known services for a full-stack analysis. */
async function gatherAllLogs(): Promise<Record<string, string>> {
  const services = ['api', 'processor', 'db', 'redis', 'web', 'nginx'];
  const results: Record<string, string> = {};
  await Promise.all(
    services.map(async (svc) => {
      results[svc] = await gatherLogs(svc);
    }),
  );
  return results;
}

/** Scan log text for known patterns and return matched issues. */
function analyzeLog(service: string, logText: string): DebugIssue[] {
  const issues: DebugIssue[] = [];
  const logLines = logText.split('\n');

  for (const pattern of LOG_PATTERNS) {
    const matchingLines = logLines.filter((line) => pattern.regex.test(line));
    if (matchingLines.length > 0) {
      issues.push({
        severity: pattern.severity,
        service,
        pattern: pattern.pattern,
        description: pattern.description,
        // Include up to 3 example lines as evidence
        evidence: matchingLines.slice(0, 3).map((l) => l.trim()),
        suggestedFix: pattern.suggestedFix,
      });
    }
  }
  return issues;
}

/** Derive a list of high-level suggested actions from all detected issues. */
function deriveSuggestedActions(issues: DebugIssue[]): string[] {
  const actionSet = new Set<string>();

  if (issues.some((i) => i.pattern === 'MISSING_TABLE')) {
    actionSet.add('Run database migrations: `npm run migrate` in the api directory.');
  }
  if (issues.some((i) => ['ECONNREFUSED', 'ENOTFOUND'].includes(i.pattern))) {
    actionSet.add('Restart the affected service and verify network configuration.');
  }
  if (issues.some((i) => i.pattern === 'MODULE_NOT_FOUND')) {
    actionSet.add('Re-install dependencies: `npm install` in the affected service directory.');
  }
  if (issues.some((i) => ['JS_RUNTIME_ERROR', 'UNHANDLED_REJECTION'].includes(i.pattern))) {
    actionSet.add('Fix the code error shown in the evidence and rebuild: `npm run build`.');
  }
  if (issues.some((i) => i.pattern === 'DB_AUTH_FAILURE')) {
    actionSet.add('Verify database credentials in .env match the running PostgreSQL instance.');
  }
  if (issues.some((i) => i.pattern === 'OOM')) {
    actionSet.add('Increase Node.js memory limit or restart the service to free memory.');
  }
  if (issues.some((i) => i.severity === 'critical')) {
    actionSet.add('Review full logs with: `docker compose logs --tail=500 <service>`');
  }

  if (actionSet.size === 0) {
    actionSet.add('No known patterns detected. Review raw logs manually for clues.');
  }

  return Array.from(actionSet);
}

// ─── Core analysis routine ────────────────────────────────────────────────────

async function runAnalysis(triggeredBy: string, service?: string): Promise<DebugReport> {
  log(`Running analysis (triggered by: ${triggeredBy}, service: ${service ?? 'all'}) …`);

  let allIssues: DebugIssue[] = [];

  if (service && service !== 'all') {
    const logText = await gatherLogs(service);
    allIssues = analyzeLog(service, logText);
  } else {
    const allLogs = await gatherAllLogs();
    for (const [svc, logText] of Object.entries(allLogs)) {
      allIssues.push(...analyzeLog(svc, logText));
    }
  }

  // Sort: critical first
  allIssues.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const report: DebugReport = {
    triggeredBy,
    issueCount: allIssues.length,
    issues: allIssues,
    suggestedActions: deriveSuggestedActions(allIssues),
    timestamp: new Date().toISOString(),
  };

  if (allIssues.length === 0) {
    log('🔍  Analysis complete – no known patterns detected.');
  } else {
    log(`🔍  Analysis complete – found ${allIssues.length} issue(s):`);
    allIssues.forEach((i) => log(`    [${i.severity.toUpperCase()}] ${i.service}: ${i.pattern}`));
  }

  return report;
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startDebugAgent(): void {
  log('Debug Agent starting …');

  subscribe((msg: AgentMessage) => {
    if (msg.to !== AGENT && msg.to !== 'all') return;

    switch (msg.type) {
      case 'HEARTBEAT':
        publish(AGENT, 'orchestrator', 'HEARTBEAT_ACK', { agent: AGENT });
        break;

      case 'COMMAND': {
        const { action, service } = msg.payload as {
          action?: string;
          service?: string;
        };
        if (action === 'ANALYZE_LOGS') {
          runAnalysis(`COMMAND from ${msg.from}`, service).then((report) => {
            publish(
              AGENT,
              'orchestrator',
              'DEBUG_REPORT',
              report as unknown as Record<string, unknown>,
            );
          }).catch((err: unknown) => log(`Analysis error: ${String(err)}`));
        }
        break;
      }

      default:
        break;
    }
  });

  publish(AGENT, 'orchestrator', 'STATUS_UPDATE', {
    agent: AGENT,
    status: 'ready',
    capabilities: ['ANALYZE_LOGS'],
  });

  log('Debug Agent ready. Waiting for COMMAND messages from the Orchestrator.');
}

// Export for use by Orchestrator
export { runAnalysis };
