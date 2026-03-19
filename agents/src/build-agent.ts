/**
 * Build Agent
 *
 * Responsibilities:
 *  - Receives BUILD / RUN_TESTS commands from the Orchestrator.
 *  - Runs `npm run build` and `npm test` in the relevant service directories.
 *  - Reports results back to the Orchestrator via BUILD_RESULT messages.
 *  - Watches source directories for changes and auto-triggers an incremental
 *    build (debounced 5 s) so stale binaries never go unnoticed.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { publish, subscribe } from './bus';
import { config } from './config';
import type {
  AgentMessage,
  BuildCommand,
  BuildResult,
  ServiceName,
} from './types';

const AGENT = 'build' as const;

// Map service → absolute directory
const SERVICE_DIRS: Record<Exclude<ServiceName, 'all'>, string> = {
  api: path.join(config.rootDir, 'api'),
  web: path.join(config.rootDir, 'web'),
  processor: path.join(config.rootDir, 'processor'),
};

// Services that have a `test` npm script
const TESTABLE_SERVICES: Array<Exclude<ServiceName, 'all'>> = ['api'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[BuildAgent] ${msg}`);
}

/** Run an npm script in the given directory. */
function runNpm(
  cwd: string,
  script: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(`npm run ${script} --if-present`, { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        reject({ stdout, stderr, message: err.message });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/** Build one service and return a BuildResult. */
async function buildService(
  service: Exclude<ServiceName, 'all'>,
): Promise<BuildResult> {
  const cwd = SERVICE_DIRS[service];
  const start = Date.now();
  log(`Building ${service} in ${cwd} …`);

  try {
    const { stdout, stderr } = await runNpm(cwd, 'build');
    const durationMs = Date.now() - start;
    log(`✅  ${service} built in ${durationMs} ms`);
    return {
      service,
      action: 'BUILD',
      success: true,
      durationMs,
      output: stdout + stderr,
      errors: [],
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const durationMs = Date.now() - start;
    const errors = [(e.message ?? 'unknown error'), e.stderr ?? ''].filter(Boolean);
    log(`❌  ${service} build failed: ${errors[0]}`);
    return {
      service,
      action: 'BUILD',
      success: false,
      durationMs,
      output: (e.stdout ?? '') + (e.stderr ?? ''),
      errors,
    };
  }
}

/** Run tests for one service. */
async function testService(
  service: Exclude<ServiceName, 'all'>,
): Promise<BuildResult> {
  const cwd = SERVICE_DIRS[service];
  const start = Date.now();
  log(`Testing ${service} …`);

  if (!TESTABLE_SERVICES.includes(service)) {
    log(`⚠️  No test script for ${service}, skipping.`);
    return {
      service,
      action: 'TEST',
      success: true,
      durationMs: 0,
      output: 'No test script configured for this service.',
      errors: [],
    };
  }

  try {
    const { stdout, stderr } = await runNpm(cwd, 'test');
    const durationMs = Date.now() - start;
    log(`✅  ${service} tests passed in ${durationMs} ms`);
    return {
      service,
      action: 'TEST',
      success: true,
      durationMs,
      output: stdout + stderr,
      errors: [],
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const durationMs = Date.now() - start;
    const errors = [(e.message ?? 'unknown error'), e.stderr ?? ''].filter(Boolean);
    log(`❌  ${service} tests failed: ${errors[0]}`);
    return {
      service,
      action: 'TEST',
      success: false,
      durationMs,
      output: (e.stdout ?? '') + (e.stderr ?? ''),
      errors,
    };
  }
}

// ─── Debounced auto-build on file change ─────────────────────────────────────

const buildTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
const DEBOUNCE_MS = 5_000;

function watchService(service: Exclude<ServiceName, 'all'>): void {
  const srcDir = path.join(SERVICE_DIRS[service], 'src');
  if (!fs.existsSync(srcDir)) return;

  log(`Watching ${srcDir} for changes …`);
  fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.ts')) return;

    const existing = buildTimers.get(service);
    if (existing) clearTimeout(existing);

    buildTimers.set(
      service,
      setTimeout(async () => {
        log(`🔄  Change detected in ${service}/${filename}, rebuilding …`);
        const result = await buildService(service);
        publish(AGENT, 'orchestrator', 'BUILD_RESULT', result as unknown as Record<string, unknown>);
      }, DEBOUNCE_MS),
    );
  });
}

// ─── Command handler ─────────────────────────────────────────────────────────

async function handleCommand(cmd: BuildCommand): Promise<void> {
  const services: Array<Exclude<ServiceName, 'all'>> =
    cmd.service === 'all'
      ? ['api', 'web', 'processor']
      : [cmd.service as Exclude<ServiceName, 'all'>];

  for (const svc of services) {
    let result: BuildResult;
    if (cmd.action === 'BUILD') {
      result = await buildService(svc);
    } else {
      result = await testService(svc);
    }
    publish(AGENT, 'orchestrator', 'BUILD_RESULT', result as unknown as Record<string, unknown>);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startBuildAgent(): void {
  log('Build Agent starting …');

  // Listen for commands from the orchestrator
  subscribe((msg: AgentMessage) => {
    if (msg.to !== AGENT && msg.to !== 'all') return;

    switch (msg.type) {
      case 'HEARTBEAT':
        publish(AGENT, 'orchestrator', 'HEARTBEAT_ACK', { agent: AGENT });
        break;

      case 'COMMAND': {
        const cmd = msg.payload as unknown as BuildCommand;
        if (cmd.action === 'BUILD' || cmd.action === 'RUN_TESTS') {
          handleCommand(cmd).catch((err: unknown) =>
            log(`Error handling command: ${String(err)}`),
          );
        }
        break;
      }

      default:
        break;
    }
  });

  // Watch source directories for live reloading
  (['api', 'web', 'processor'] as Array<Exclude<ServiceName, 'all'>>).forEach(watchService);

  // Announce readiness
  publish(AGENT, 'orchestrator', 'STATUS_UPDATE', {
    agent: AGENT,
    status: 'ready',
    capabilities: ['BUILD', 'RUN_TESTS'],
    watching: Object.keys(SERVICE_DIRS),
  });

  log('Build Agent ready. Watching for changes and awaiting commands.');
}
