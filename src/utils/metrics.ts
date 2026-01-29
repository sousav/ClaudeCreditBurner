/**
 * Performance metrics tracking for the Autonomous Task Executor
 */

import type { TokenUsage, ExecutionSummary, ExecutionError } from '../types';

interface TaskMetrics {
  taskId: string;
  startTime: number;
  endTime?: number;
  tokensUsed?: TokenUsage;
  status: 'running' | 'completed' | 'failed';
  error?: ExecutionError;
}

interface GlobalMetrics {
  startTime: number;
  totalRequests: number;
  totalTokens: TokenUsage;
  taskMetrics: Map<string, TaskMetrics>;
  rateLimitHits: number;
  retryCount: number;
}

class MetricsCollector {
  private metrics: GlobalMetrics;

  constructor() {
    this.metrics = {
      startTime: Date.now(),
      totalRequests: 0,
      totalTokens: { input: 0, output: 0, total: 0 },
      taskMetrics: new Map(),
      rateLimitHits: 0,
      retryCount: 0,
    };
  }

  /**
   * Record the start of a task execution
   */
  startTask(taskId: string): void {
    this.metrics.taskMetrics.set(taskId, {
      taskId,
      startTime: Date.now(),
      status: 'running',
    });
  }

  /**
   * Record successful task completion
   */
  completeTask(taskId: string, tokensUsed: TokenUsage): void {
    const task = this.metrics.taskMetrics.get(taskId);
    if (task) {
      task.endTime = Date.now();
      task.tokensUsed = tokensUsed;
      task.status = 'completed';

      // Update global totals
      this.metrics.totalTokens.input += tokensUsed.input;
      this.metrics.totalTokens.output += tokensUsed.output;
      this.metrics.totalTokens.total += tokensUsed.total;
    }
  }

  /**
   * Record task failure
   */
  failTask(taskId: string, error: ExecutionError): void {
    const task = this.metrics.taskMetrics.get(taskId);
    if (task) {
      task.endTime = Date.now();
      task.status = 'failed';
      task.error = error;
    }
  }

  /**
   * Record an API request
   */
  recordRequest(): void {
    this.metrics.totalRequests++;
  }

  /**
   * Record a rate limit hit
   */
  recordRateLimitHit(): void {
    this.metrics.rateLimitHits++;
  }

  /**
   * Record a retry attempt
   */
  recordRetry(): void {
    this.metrics.retryCount++;
  }

  /**
   * Get task duration in milliseconds
   */
  getTaskDuration(taskId: string): number | null {
    const task = this.metrics.taskMetrics.get(taskId);
    if (task && task.endTime) {
      return task.endTime - task.startTime;
    }
    return null;
  }

  /**
   * Get total execution time in milliseconds
   */
  getTotalDuration(): number {
    return Date.now() - this.metrics.startTime;
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): GlobalMetrics {
    return { ...this.metrics };
  }

  /**
   * Generate execution summary
   */
  generateSummary(): ExecutionSummary {
    const tasks = Array.from(this.metrics.taskMetrics.values());

    const completed = tasks.filter((t) => t.status === 'completed');
    const failed = tasks.filter((t) => t.status === 'failed');

    return {
      totalTasks: tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length,
      skippedTasks: 0, // Will be calculated from DAG
      totalTokensUsed: this.metrics.totalTokens.total,
      totalDurationMs: this.getTotalDuration(),
      errors: failed
        .filter((t) => t.error)
        .map((t) => ({
          taskId: t.taskId,
          error: t.error!,
        })),
    };
  }

  /**
   * Get average task duration
   */
  getAverageTaskDuration(): number {
    const completedTasks = Array.from(this.metrics.taskMetrics.values()).filter(
      (t) => t.status === 'completed' && t.endTime
    );

    if (completedTasks.length === 0) {
      return 0;
    }

    const totalDuration = completedTasks.reduce((sum, t) => sum + (t.endTime! - t.startTime), 0);

    return totalDuration / completedTasks.length;
  }

  /**
   * Get tokens per minute rate
   */
  getTokensPerMinute(): number {
    const durationMinutes = this.getTotalDuration() / 60000;
    if (durationMinutes === 0) {
      return 0;
    }
    return this.metrics.totalTokens.total / durationMinutes;
  }

  /**
   * Get requests per minute rate
   */
  getRequestsPerMinute(): number {
    const durationMinutes = this.getTotalDuration() / 60000;
    if (durationMinutes === 0) {
      return 0;
    }
    return this.metrics.totalRequests / durationMinutes;
  }

  /**
   * Reset metrics (for new execution run)
   */
  reset(): void {
    this.metrics = {
      startTime: Date.now(),
      totalRequests: 0,
      totalTokens: { input: 0, output: 0, total: 0 },
      taskMetrics: new Map(),
      rateLimitHits: 0,
      retryCount: 0,
    };
  }
}

// Global metrics instance
let metricsCollector: MetricsCollector | null = null;

/**
 * Get the global metrics collector
 */
export function getMetrics(): MetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new MetricsCollector();
  }
  return metricsCollector;
}

/**
 * Reset the global metrics collector
 */
export function resetMetrics(): void {
  metricsCollector = new MetricsCollector();
}

export { MetricsCollector };
