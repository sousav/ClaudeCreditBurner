/**
 * Core types and interfaces for the Autonomous Task Executor
 */

// ============================================================================
// Task & Execution Types
// ============================================================================

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  teamId: string;
  labels: string[];
  dependencies: string[];
  assigneeId?: string;
  createdAt: Date;
  updatedAt: Date;
  estimatedTokens?: number;
}

export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'cancelled';

export interface ExecutionResult {
  taskId: string;
  success: boolean;
  output?: string;
  artifacts?: Artifact[];
  error?: ExecutionError;
  tokensUsed: TokenUsage;
  durationMs: number;
  timestamp: Date;
}

export interface Artifact {
  type: 'code' | 'markdown' | 'json' | 'text';
  filename?: string;
  content: string;
  language?: string;
}

export interface ExecutionError {
  code: string;
  message: string;
  retryable: boolean;
  context?: Record<string, unknown>;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

// ============================================================================
// State & Checkpoint Types
// ============================================================================

export interface ExecutionState {
  checkpointId: string;
  timestamp: Date;
  completedTasks: Set<string>;
  failedTasks: Map<string, ExecutionError>;
  inProgressTasks: Set<string>;
  totalTokensUsed: number;
  executionTimeMs: number;
}

export interface CheckpointData {
  checkpointId: string;
  timestamp: string;
  completedTasks: string[];
  failedTasks: Array<{ taskId: string; error: ExecutionError }>;
  inProgressTasks: string[];
  totalTokensUsed: number;
  executionTimeMs: number;
}

export interface CheckpointInfo {
  id: string;
  path: string;
  timestamp: Date;
  tasksCompleted: number;
  tasksFailed: number;
}

// ============================================================================
// Rate Limiting Types
// ============================================================================

export interface RateLimitConfig {
  rpm: number; // Requests per minute
  itpm: number; // Input tokens per minute
  otpm: number; // Output tokens per minute
  backoffBase: number; // Base backoff in seconds
  backoffMax: number; // Max backoff in seconds
  maxRetries: number;
}

export interface UsageMetrics {
  currentRpm: number;
  currentItpm: number;
  currentOtpm: number;
  windowStart: Date;
  requestsInWindow: number;
  tokensInWindow: TokenUsage;
  nextResetTime: Date;
}

export interface RateLimitStatus {
  isLimited: boolean;
  waitTimeMs: number;
  reason?: 'rpm' | 'itpm' | 'otpm';
  usage: UsageMetrics;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface Config {
  linear: LinearConfig;
  claude: ClaudeConfig;
  execution: ExecutionConfig;
  rateLimits: RateLimitConfig;
  logging: LoggingConfig;
}

export interface LinearConfig {
  mcpUrl: string;
  teamId?: string;
  apiKey?: string;
}

export interface ClaudeConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  apiKey?: string;
}

export interface ExecutionConfig {
  maxParallel: number;
  checkpointInterval: number;
  dryRun: boolean;
  resumeFromCheckpoint?: string;
}

export interface LoggingConfig {
  level: LogLevel;
  file: string;
  console: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIOptions {
  team?: string;
  resume?: string;
  dryRun: boolean;
  maxParallel: number;
  config?: string;
  verbose: boolean;
}

export interface ExecutionSummary {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  totalTokensUsed: number;
  totalDurationMs: number;
  errors: Array<{ taskId: string; error: ExecutionError }>;
}

// ============================================================================
// DAG Types
// ============================================================================

export interface TaskNode {
  taskId: string;
  dependencies: Set<string>;
  dependents: Set<string>;
  status: 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'blocked';
}

export interface DAGValidationResult {
  valid: boolean;
  cycles?: string[][];
  orphanedDependencies?: Array<{ taskId: string; missingDeps: string[] }>;
}
