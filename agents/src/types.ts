/**
 * Shared types used by all four agents.
 */

export type AgentName = 'orchestrator' | 'build' | 'ops' | 'debug';

export type MessageType =
  | 'HEARTBEAT'
  | 'HEARTBEAT_ACK'
  | 'STATUS_UPDATE'
  | 'ALERT'
  | 'COMMAND'
  | 'BUILD_RESULT'
  | 'HEALTH_REPORT'
  | 'DEBUG_REPORT';

/** Generic envelope for every inter-agent message. */
export interface AgentMessage {
  id: string;
  from: AgentName;
  to: AgentName | 'all';
  type: MessageType;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ─── Build Agent ─────────────────────────────────────────────────────────────

export type ServiceName = 'api' | 'web' | 'processor' | 'all';

export interface BuildCommand {
  action: 'BUILD' | 'RUN_TESTS';
  service: ServiceName;
}

export interface BuildResult {
  service: string;
  action: 'BUILD' | 'TEST';
  success: boolean;
  durationMs: number;
  output: string;
  errors: string[];
}

// ─── Operations Agent ─────────────────────────────────────────────────────────

export interface HealthCheck {
  service: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

export interface HealthReport {
  allHealthy: boolean;
  checks: HealthCheck[];
  timestamp: string;
}

// ─── Debug Agent ─────────────────────────────────────────────────────────────

export interface DebugIssue {
  severity: 'critical' | 'warning' | 'info';
  service: string;
  pattern: string;
  description: string;
  evidence: string[];
  suggestedFix: string;
}

export interface DebugReport {
  triggeredBy: string;
  issueCount: number;
  issues: DebugIssue[];
  suggestedActions: string[];
  timestamp: string;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface AgentStatus {
  name: AgentName;
  lastHeartbeat: string | null;
  alive: boolean;
}

export interface OrchestratorState {
  agents: AgentStatus[];
  lastHealthReport: HealthReport | null;
  lastDebugReport: DebugReport | null;
  lastBuildResults: BuildResult[];
}
