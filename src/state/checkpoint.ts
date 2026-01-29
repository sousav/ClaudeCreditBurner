/**
 * Checkpoint Manager - State persistence and recovery
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import type { ExecutionState, CheckpointData, CheckpointInfo, ExecutionError } from '../types';
import { getLogger } from '../utils/logger';

export class CheckpointManager {
  private checkpointDir: string;
  private currentCheckpointId: string | null;

  constructor(checkpointDir: string = 'data/checkpoints') {
    this.checkpointDir = checkpointDir;
    this.currentCheckpointId = null;

    // Ensure checkpoint directory exists
    if (!existsSync(this.checkpointDir)) {
      mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * Generate a unique checkpoint ID
   */
  private generateCheckpointId(): string {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  /**
   * Get checkpoint file path
   */
  private getCheckpointPath(checkpointId: string): string {
    return join(this.checkpointDir, `checkpoint-${checkpointId}.json`);
  }

  /**
   * Convert ExecutionState to CheckpointData for serialization
   */
  private stateToData(state: ExecutionState): CheckpointData {
    const failedTasks = Array.from(state.failedTasks.entries()).map(([taskId, error]) => ({
      taskId,
      error,
    }));

    return {
      checkpointId: state.checkpointId,
      timestamp: state.timestamp.toISOString(),
      completedTasks: Array.from(state.completedTasks),
      failedTasks,
      inProgressTasks: Array.from(state.inProgressTasks),
      totalTokensUsed: state.totalTokensUsed,
      executionTimeMs: state.executionTimeMs,
    };
  }

  /**
   * Convert CheckpointData to ExecutionState
   */
  private dataToState(data: CheckpointData): ExecutionState {
    const failedTasks = new Map<string, ExecutionError>();
    for (const { taskId, error } of data.failedTasks) {
      failedTasks.set(taskId, error);
    }

    return {
      checkpointId: data.checkpointId,
      timestamp: new Date(data.timestamp),
      completedTasks: new Set(data.completedTasks),
      failedTasks,
      inProgressTasks: new Set(data.inProgressTasks),
      totalTokensUsed: data.totalTokensUsed,
      executionTimeMs: data.executionTimeMs,
    };
  }

  /**
   * Save current state to a checkpoint
   */
  saveCheckpoint(state: ExecutionState): string {
    const logger = getLogger();

    // Generate or reuse checkpoint ID
    const checkpointId = state.checkpointId || this.generateCheckpointId();
    state.checkpointId = checkpointId;
    this.currentCheckpointId = checkpointId;

    const data = this.stateToData(state);
    const path = this.getCheckpointPath(checkpointId);

    try {
      writeFileSync(path, JSON.stringify(data, null, 2));
      logger.checkpoint('saved', {
        checkpointId,
        path,
        completedTasks: state.completedTasks.size,
        failedTasks: state.failedTasks.size,
      });
      return path;
    } catch (error) {
      logger.checkpoint('failed', {
        checkpointId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Load a specific checkpoint
   */
  loadCheckpoint(checkpointId: string): ExecutionState | null {
    const logger = getLogger();
    const path = this.getCheckpointPath(checkpointId);

    if (!existsSync(path)) {
      logger.warn('Checkpoint not found', { checkpointId, path });
      return null;
    }

    try {
      const content = readFileSync(path, 'utf-8');
      const data = JSON.parse(content) as CheckpointData;
      const state = this.dataToState(data);

      logger.checkpoint('loaded', {
        checkpointId,
        completedTasks: state.completedTasks.size,
        failedTasks: state.failedTasks.size,
      });

      this.currentCheckpointId = checkpointId;
      return state;
    } catch (error) {
      logger.checkpoint('failed', {
        checkpointId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Load the most recent checkpoint
   */
  loadLatestCheckpoint(): ExecutionState | null {
    const checkpoints = this.listCheckpoints();

    if (checkpoints.length === 0) {
      return null;
    }

    // Sort by timestamp descending
    checkpoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const latest = checkpoints[0];

    return this.loadCheckpoint(latest.id);
  }

  /**
   * List all available checkpoints
   */
  listCheckpoints(): CheckpointInfo[] {
    const checkpoints: CheckpointInfo[] = [];

    if (!existsSync(this.checkpointDir)) {
      return checkpoints;
    }

    const files = readdirSync(this.checkpointDir);

    for (const file of files) {
      if (!file.startsWith('checkpoint-') || !file.endsWith('.json')) {
        continue;
      }

      const path = join(this.checkpointDir, file);

      try {
        const content = readFileSync(path, 'utf-8');
        const data = JSON.parse(content) as CheckpointData;

        checkpoints.push({
          id: data.checkpointId,
          path,
          timestamp: new Date(data.timestamp),
          tasksCompleted: data.completedTasks.length,
          tasksFailed: data.failedTasks.length,
        });
      } catch {
        // Skip invalid checkpoint files
      }
    }

    return checkpoints;
  }

  /**
   * Delete a specific checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    const path = this.getCheckpointPath(checkpointId);

    if (!existsSync(path)) {
      return false;
    }

    try {
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up old checkpoints, keeping the most recent N
   */
  cleanupOldCheckpoints(keepCount: number = 5): number {
    const checkpoints = this.listCheckpoints();

    if (checkpoints.length <= keepCount) {
      return 0;
    }

    // Sort by timestamp descending
    checkpoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Delete old checkpoints
    const toDelete = checkpoints.slice(keepCount);
    let deleted = 0;

    for (const checkpoint of toDelete) {
      if (this.deleteCheckpoint(checkpoint.id)) {
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Create an initial empty state
   */
  createInitialState(): ExecutionState {
    return {
      checkpointId: this.generateCheckpointId(),
      timestamp: new Date(),
      completedTasks: new Set(),
      failedTasks: new Map(),
      inProgressTasks: new Set(),
      totalTokensUsed: 0,
      executionTimeMs: 0,
    };
  }

  /**
   * Get current checkpoint ID
   */
  getCurrentCheckpointId(): string | null {
    return this.currentCheckpointId;
  }
}
