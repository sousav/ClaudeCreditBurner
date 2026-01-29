#!/usr/bin/env bun
/**
 * Claude Credit Burner - Autonomous Task Execution CLI
 *
 * Executes queued development tasks from Linear using Claude API
 */

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config as loadEnv } from 'dotenv';
import type { CLIOptions, ExecutionState, Task, ExecutionResult } from './types';
import { loadConfig, validateConfig } from './config';
import { initLogger, getLogger } from './utils/logger';
import { getMetrics, resetMetrics } from './utils/metrics';
import { TaskGraph } from './core/task-graph';
import { TaskExecutor } from './core/executor';
import { RateLimitManager } from './rate-limit/manager';
import { CheckpointManager } from './state/checkpoint';
import { RecoveryManager } from './state/recovery';
import { createLinearMCPClient, LinearAdapter } from './mcp';

// Load environment variables
loadEnv();

// Version from package.json
const VERSION = '0.1.0';

/**
 * Main execution loop
 */
async function executeTaskLoop(
  linearAdapter: LinearAdapter,
  executor: TaskExecutor,
  rateLimiter: RateLimitManager,
  state: ExecutionState,
  checkpointManager: CheckpointManager,
  maxParallel: number,
  dryRun: boolean
): Promise<void> {
  const logger = getLogger();
  const metrics = getMetrics();
  const spinner = ora();

  // Fetch tasks from Linear
  spinner.start('Fetching tasks from Linear...');
  const allTasks = await linearAdapter.fetchTasks({
    status: ['Todo', 'Backlog', 'In Progress'],
  });
  spinner.succeed(`Fetched ${allTasks.length} tasks`);

  if (allTasks.length === 0) {
    logger.info('No tasks to execute');
    return;
  }

  // Build task graph
  spinner.start('Building task dependency graph...');
  const taskGraph = new TaskGraph();

  for (const task of allTasks) {
    taskGraph.addTask(task);
  }

  // Validate graph
  const validation = taskGraph.validateAcyclic();
  if (!validation.valid) {
    spinner.fail('Task graph contains cycles');
    logger.error('Circular dependencies detected', { cycles: validation.cycles });
    throw new Error('Cannot execute tasks with circular dependencies');
  }

  if (validation.orphanedDependencies) {
    logger.warn('Some tasks have missing dependencies', {
      orphaned: validation.orphanedDependencies,
    });
  }

  spinner.succeed(`Task graph validated (${taskGraph.size()} tasks)`);

  // Mark already completed tasks
  for (const taskId of state.completedTasks) {
    taskGraph.markCompleted(taskId);
  }

  // Mark failed tasks and their dependents
  for (const taskId of state.failedTasks.keys()) {
    taskGraph.markFailed(taskId);
  }
  taskGraph.markBlockedTasks(new Set(state.failedTasks.keys()));

  // Main execution loop
  const startTime = Date.now();
  const completedResults: Map<string, ExecutionResult> = new Map();

  logger.info('Starting task execution loop', {
    totalTasks: taskGraph.size(),
    completed: state.completedTasks.size,
    failed: state.failedTasks.size,
    maxParallel,
    dryRun,
  });

  while (!taskGraph.isComplete()) {
    // Get ready tasks
    const readyTasks = taskGraph.getReadyTasks(state.completedTasks);

    if (readyTasks.length === 0) {
      // Check if we're blocked
      const counts = taskGraph.getStatusCounts();
      if (counts.pending > 0 || counts.blocked > 0) {
        logger.warn('Some tasks are blocked by failures', {
          pending: counts.pending,
          blocked: counts.blocked,
        });
      }
      break;
    }

    // Select tasks for parallel execution
    const batchTaskIds = taskGraph.getParallelCandidates(readyTasks, maxParallel);
    const batchTasks: Task[] = batchTaskIds
      .map((id) => taskGraph.getTask(id))
      .filter((t): t is Task => t !== undefined);

    logger.info('Executing batch', {
      batchSize: batchTasks.length,
      taskIds: batchTaskIds,
    });

    // Mark tasks as executing
    for (const taskId of batchTaskIds) {
      taskGraph.markExecuting(taskId);
      state.inProgressTasks.add(taskId);
    }

    // Execute batch
    for (const task of batchTasks) {
      spinner.start(`Executing: ${task.title}`);

      try {
        // Check rate limits
        const estimatedTokens = 2000; // Rough estimate
        await rateLimiter.acquirePermit(estimatedTokens);

        // Execute task
        const result = await executor.executeTask(task, {
          completedTasks: Array.from(completedResults.entries())
            .slice(-5) // Last 5 completed tasks for context
            .map(([, r]) => ({
              task: taskGraph.getTask(r.taskId)!,
              result: r,
            }))
            .filter((item) => item.task !== undefined),
        });

        // Record usage
        rateLimiter.recordUsage(result.tokensUsed);
        completedResults.set(task.id, result);

        if (result.success) {
          spinner.succeed(`Completed: ${task.title}`);
          state.completedTasks.add(task.id);
          taskGraph.markCompleted(task.id);

          // Update Linear (if not dry run)
          if (!dryRun) {
            await linearAdapter.updateTaskStatus(task.id, 'done');
            await linearAdapter.addExecutionComment(task.id, {
              success: true,
              output: result.output,
              tokensUsed: result.tokensUsed.total,
            });
          }
        } else {
          spinner.fail(`Failed: ${task.title}`);
          state.failedTasks.set(task.id, result.error!);
          taskGraph.markFailed(task.id);

          // Update Linear (if not dry run)
          if (!dryRun) {
            await linearAdapter.addExecutionComment(task.id, {
              success: false,
              error: result.error?.message,
              tokensUsed: result.tokensUsed.total,
            });
          }

          // Mark dependent tasks as blocked
          taskGraph.markBlockedTasks(new Set([task.id]));
        }

        // Remove from in-progress
        state.inProgressTasks.delete(task.id);

        // Save checkpoint
        state.totalTokensUsed += result.tokensUsed.total;
        state.executionTimeMs = Date.now() - startTime;
        state.timestamp = new Date();
        checkpointManager.saveCheckpoint(state);
      } catch (error) {
        spinner.fail(`Error: ${task.title}`);
        logger.error('Task execution error', {
          taskId: task.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        state.failedTasks.set(task.id, {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        });
        taskGraph.markFailed(task.id);
        state.inProgressTasks.delete(task.id);
        checkpointManager.saveCheckpoint(state);
      }
    }
  }

  // Final summary
  const summary = metrics.generateSummary();
  const counts = taskGraph.getStatusCounts();

  console.log('\n' + chalk.bold('Execution Summary'));
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`Total tasks:     ${chalk.cyan(counts.completed + counts.failed + counts.blocked + counts.pending)}`);
  console.log(`Completed:       ${chalk.green(counts.completed)}`);
  console.log(`Failed:          ${chalk.red(counts.failed)}`);
  console.log(`Blocked:         ${chalk.yellow(counts.blocked)}`);
  console.log(`Tokens used:     ${chalk.cyan(summary.totalTokensUsed.toLocaleString())}`);
  console.log(`Duration:        ${chalk.cyan(Math.round(summary.totalDurationMs / 1000))}s`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  program
    .name('ccb')
    .description('Claude Credit Burner - Autonomous Task Execution CLI')
    .version(VERSION)
    .option('-t, --team <id>', 'Linear team ID')
    .option('-r, --resume <checkpoint>', 'Resume from checkpoint')
    .option('-d, --dry-run', 'Dry run mode (no actual API calls)', false)
    .option('-p, --max-parallel <number>', 'Maximum parallel tasks', '3')
    .option('-c, --config <path>', 'Path to config file')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .parse(process.argv);

  const cliOptions: CLIOptions = {
    team: program.opts().team,
    resume: program.opts().resume,
    dryRun: program.opts().dryRun,
    maxParallel: parseInt(program.opts().maxParallel, 10),
    config: program.opts().config,
    verbose: program.opts().verbose,
  };

  // Load configuration
  const config = loadConfig(cliOptions);

  // Initialize logger
  initLogger({
    level: config.logging.level,
    file: config.logging.file,
    console: config.logging.console,
  });

  const logger = getLogger();

  // Validate configuration
  const configErrors = validateConfig(config);
  if (configErrors.length > 0) {
    console.error(chalk.red('Configuration errors:'));
    for (const error of configErrors) {
      console.error(chalk.red(`  • ${error}`));
    }
    process.exit(1);
  }

  // Initialize recovery manager
  const recoveryManager = new RecoveryManager();
  const checkpointManager = recoveryManager.getCheckpointManager();

  // Check for interrupted execution
  if (recoveryManager.wasInterrupted() && !cliOptions.resume) {
    const info = recoveryManager.getInterruptionInfo();
    console.log(chalk.yellow('\nPrevious execution was interrupted.'));
    console.log(`  Started: ${info?.startTime}`);
    console.log(`  Checkpoint: ${info?.checkpointId || 'none'}`);
    console.log(chalk.dim('\nUse --resume to continue, or the lock file will be cleared.\n'));

    recoveryManager.forceClearLock();
  }

  // Load or create state
  let state: ExecutionState;

  if (cliOptions.resume) {
    const loadedState =
      cliOptions.resume === 'latest'
        ? checkpointManager.loadLatestCheckpoint()
        : checkpointManager.loadCheckpoint(cliOptions.resume);

    if (loadedState) {
      state = loadedState;
      console.log(chalk.green(`Resuming from checkpoint: ${state.checkpointId}`));
      console.log(`  Completed: ${state.completedTasks.size}`);
      console.log(`  Failed: ${state.failedTasks.size}`);
    } else {
      console.error(chalk.red('Failed to load checkpoint'));
      process.exit(1);
    }
  } else {
    state = checkpointManager.createInitialState();
    resetMetrics();
  }

  // Acquire execution lock
  if (!recoveryManager.acquireLock(state.checkpointId)) {
    console.error(chalk.red('Could not acquire execution lock. Another instance may be running.'));
    process.exit(1);
  }

  // Setup signal handlers for graceful shutdown
  recoveryManager.setupSignalHandlers(async () => {
    logger.info('Shutting down...');
    checkpointManager.saveCheckpoint(state);
  });

  console.log(chalk.bold.cyan('\n🚀 Claude Credit Burner\n'));
  console.log(`Team ID:      ${config.linear.teamId}`);
  console.log(`Model:        ${config.claude.model}`);
  console.log(`Max Parallel: ${config.execution.maxParallel}`);
  console.log(`Dry Run:      ${config.execution.dryRun}`);
  console.log('');

  try {
    // Initialize MCP client for Linear
    const spinner = ora('Connecting to Linear...').start();

    const mcpClient = createLinearMCPClient(
      config.linear.apiKey!,
      config.linear.mcpUrl
    );

    const connected = await mcpClient.connect();
    if (!connected) {
      spinner.fail('Failed to connect to Linear MCP');
      process.exit(1);
    }
    spinner.succeed('Connected to Linear');

    const linearAdapter = new LinearAdapter(mcpClient, config.linear.teamId);

    // Initialize rate limiter
    const rateLimiter = new RateLimitManager(config.rateLimits);

    // Initialize executor
    const executor = new TaskExecutor({
      claudeConfig: config.claude,
      dryRun: config.execution.dryRun,
    });

    // Run execution loop
    await executeTaskLoop(
      linearAdapter,
      executor,
      rateLimiter,
      state,
      checkpointManager,
      config.execution.maxParallel,
      config.execution.dryRun
    );

    // Cleanup
    await mcpClient.disconnect();

    // Final checkpoint
    checkpointManager.saveCheckpoint(state);
    checkpointManager.cleanupOldCheckpoints(5);

    logger.info('Execution completed successfully');
  } catch (error) {
    logger.critical('Fatal error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Save state on error
    checkpointManager.saveCheckpoint(state);

    console.error(chalk.red('\nFatal error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    recoveryManager.releaseLock();
  }
}

// Run main
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
