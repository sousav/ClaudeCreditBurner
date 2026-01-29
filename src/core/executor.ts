/**
 * Task Executor - Executes tasks via Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Task, ExecutionResult, ClaudeConfig, TokenUsage, ExecutionError } from '../types';
import { PromptBuilder } from './prompt-builder';
import { Validator } from './validator';
import { getLogger } from '../utils/logger';
import { getMetrics } from '../utils/metrics';
import type { RateLimitManager } from '../rate-limit/manager';

interface ExecutorConfig {
  claudeConfig: ClaudeConfig;
  dryRun?: boolean;
  rateLimiter?: RateLimitManager;
}

interface ExecutionContext {
  projectDescription?: string;
  completedTasks?: Array<{ task: Task; result: ExecutionResult }>;
  relevantFiles?: Array<{ path: string; content: string }>;
  additionalInstructions?: string;
}

export class TaskExecutor {
  private client: Anthropic;
  private config: ClaudeConfig;
  private promptBuilder: PromptBuilder;
  private validator: Validator;
  private dryRun: boolean;
  private rateLimiter?: RateLimitManager;

  constructor(config: ExecutorConfig) {
    this.config = config.claudeConfig;
    this.dryRun = config.dryRun || false;
    this.rateLimiter = config.rateLimiter;
    this.promptBuilder = new PromptBuilder();
    this.validator = new Validator();

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  /**
   * Set or update the rate limiter
   */
  setRateLimiter(rateLimiter: RateLimitManager): void {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Execute a single task
   */
  async executeTask(task: Task, context?: ExecutionContext): Promise<ExecutionResult> {
    const logger = getLogger();
    const metrics = getMetrics();
    const startTime = Date.now();

    logger.taskEvent('started', task.id, { title: task.title });
    metrics.startTask(task.id);

    try {
      // Build the prompt
      const prompt = this.promptBuilder.buildTaskPrompt(task, context);
      const systemPrompt = this.promptBuilder.getSystemPrompt();

      // Estimate tokens for rate limiting
      const estimatedInputTokens = this.promptBuilder.estimateTokens(prompt + systemPrompt);

      logger.debug('Executing task', {
        taskId: task.id,
        estimatedInputTokens,
        model: this.config.model,
      });

      // Dry run mode - simulate execution
      if (this.dryRun) {
        logger.info('Dry run mode - skipping actual API call', { taskId: task.id });
        const dryRunResult: ExecutionResult = {
          taskId: task.id,
          success: true,
          output: '[DRY RUN] Task would be executed with the following prompt:\n\n' + prompt,
          artifacts: [],
          tokensUsed: { input: estimatedInputTokens, output: 0, total: estimatedInputTokens },
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        };
        metrics.completeTask(task.id, dryRunResult.tokensUsed);
        return dryRunResult;
      }

      // Call Claude API
      metrics.recordRequest();
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract response content
      const outputContent = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as Anthropic.TextBlock).text)
        .join('\n');

      // Calculate token usage
      const tokensUsed: TokenUsage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      };

      // Validate output
      const validation = this.validator.validate(outputContent, task);

      if (!validation.valid) {
        const error = this.validator.createValidationError(validation);
        logger.taskEvent('failed', task.id, {
          error: error.message,
          tokensUsed: tokensUsed.total,
        });
        metrics.failTask(task.id, error);

        return {
          taskId: task.id,
          success: false,
          output: outputContent,
          error,
          tokensUsed,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      // Log warnings if any
      for (const warning of validation.warnings) {
        logger.warn('Validation warning', { taskId: task.id, warning });
      }

      const result: ExecutionResult = {
        taskId: task.id,
        success: true,
        output: outputContent,
        artifacts: validation.artifacts,
        tokensUsed,
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
      };

      logger.taskEvent('completed', task.id, {
        tokensUsed: tokensUsed.total,
        durationMs: result.durationMs,
        artifactsCount: validation.artifacts.length,
      });
      metrics.completeTask(task.id, tokensUsed);

      return result;
    } catch (error) {
      const execError = this.handleApiError(error);

      logger.taskEvent('failed', task.id, {
        error: execError.message,
        code: execError.code,
        retryable: execError.retryable,
      });
      metrics.failTask(task.id, execError);

      return {
        taskId: task.id,
        success: false,
        error: execError,
        tokensUsed: { input: 0, output: 0, total: 0 },
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute multiple tasks in parallel
   */
  async executeBatch(
    tasks: Task[],
    context?: ExecutionContext
  ): Promise<Map<string, ExecutionResult>> {
    const results = new Map<string, ExecutionResult>();

    const executions = tasks.map(async (task) => {
      const result = await this.executeTask(task, context);
      results.set(task.id, result);
      return result;
    });

    await Promise.all(executions);
    return results;
  }

  /**
   * Handle API errors and convert to ExecutionError
   */
  private handleApiError(error: unknown): ExecutionError {
    if (error instanceof Anthropic.APIError) {
      const status = error.status;

      if (status === 429) {
        getMetrics().recordRateLimitHit();

        // Update rate limiter with headers if available
        if (this.rateLimiter && error.headers) {
          const headersObj: Record<string, string | string[] | undefined> = {};
          // Convert Headers to plain object
          if (error.headers instanceof Headers) {
            error.headers.forEach((value, key) => {
              headersObj[key] = value;
            });
          } else if (typeof error.headers === 'object') {
            Object.assign(headersObj, error.headers);
          }
          this.rateLimiter.updateFromHeaders(headersObj);
          getLogger().debug('Updated rate limiter from error headers', {
            requestsRemaining: headersObj['anthropic-ratelimit-requests-remaining'],
            tokensRemaining: headersObj['anthropic-ratelimit-tokens-remaining'],
          });
        }

        // Extract retry-after header if present
        let retryAfter: number | undefined;
        if (error.headers) {
          const retryAfterHeader =
            error.headers instanceof Headers
              ? error.headers.get('retry-after')
              : (error.headers as Record<string, string>)['retry-after'];
          if (retryAfterHeader) {
            retryAfter = parseInt(retryAfterHeader, 10);
          }
        }

        return {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
          retryable: true,
          context: {
            status,
            retryAfter,
          },
        };
      }

      if (status === 529) {
        return {
          code: 'API_OVERLOADED',
          message: 'API is temporarily overloaded',
          retryable: true,
          context: { status },
        };
      }

      if (status >= 500) {
        return {
          code: 'API_ERROR',
          message: `API error: ${error.message}`,
          retryable: true,
          context: { status },
        };
      }

      return {
        code: 'API_ERROR',
        message: error.message,
        retryable: false,
        context: { status },
      };
    }

    if (error instanceof Error) {
      return {
        code: 'UNKNOWN_ERROR',
        message: error.message,
        retryable: false,
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      retryable: false,
    };
  }

  /**
   * Get the prompt builder for customization
   */
  getPromptBuilder(): PromptBuilder {
    return this.promptBuilder;
  }

  /**
   * Get the validator for customization
   */
  getValidator(): Validator {
    return this.validator;
  }
}
