/**
 * Crash Recovery - Handles recovery from unexpected failures
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { ExecutionState } from '../types';
import { CheckpointManager } from './checkpoint';
import { getLogger } from '../utils/logger';

interface LockFile {
  pid: number;
  startTime: string;
  checkpointId?: string;
}

export class RecoveryManager {
  private checkpointManager: CheckpointManager;
  private lockFilePath: string;

  constructor(dataDir: string = 'data') {
    this.lockFilePath = join(dataDir, 'execution.lock');
    this.checkpointManager = new CheckpointManager(join(dataDir, 'checkpoints'));
  }

  /**
   * Check if a previous execution was interrupted
   */
  wasInterrupted(): boolean {
    return existsSync(this.lockFilePath);
  }

  /**
   * Get information about the interrupted execution
   */
  getInterruptionInfo(): LockFile | null {
    if (!this.wasInterrupted()) {
      return null;
    }

    try {
      const content = readFileSync(this.lockFilePath, 'utf-8');
      return JSON.parse(content) as LockFile;
    } catch {
      return null;
    }
  }

  /**
   * Acquire execution lock
   */
  acquireLock(checkpointId?: string): boolean {
    const logger = getLogger();

    if (this.wasInterrupted()) {
      const info = this.getInterruptionInfo();
      logger.warn('Previous execution was interrupted', {
        pid: info?.pid,
        startTime: info?.startTime,
        checkpointId: info?.checkpointId,
      });
      return false;
    }

    const lockData: LockFile = {
      pid: process.pid,
      startTime: new Date().toISOString(),
      checkpointId,
    };

    try {
      writeFileSync(this.lockFilePath, JSON.stringify(lockData, null, 2));
      logger.debug('Acquired execution lock', { pid: process.pid });
      return true;
    } catch (error) {
      logger.error('Failed to acquire execution lock', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Update lock file with current checkpoint ID
   */
  updateLock(checkpointId: string): void {
    if (!existsSync(this.lockFilePath)) {
      return;
    }

    try {
      const content = readFileSync(this.lockFilePath, 'utf-8');
      const lockData = JSON.parse(content) as LockFile;
      lockData.checkpointId = checkpointId;
      writeFileSync(this.lockFilePath, JSON.stringify(lockData, null, 2));
    } catch {
      // Ignore errors updating lock
    }
  }

  /**
   * Release execution lock
   */
  releaseLock(): void {
    const logger = getLogger();

    if (existsSync(this.lockFilePath)) {
      try {
        unlinkSync(this.lockFilePath);
        logger.debug('Released execution lock');
      } catch (error) {
        logger.error('Failed to release execution lock', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Attempt to recover from an interrupted execution
   */
  recover(forceRecover: boolean = false): ExecutionState | null {
    const logger = getLogger();

    if (!this.wasInterrupted() && !forceRecover) {
      return null;
    }

    const info = this.getInterruptionInfo();

    // If we have a checkpoint ID, try to load it
    if (info?.checkpointId) {
      logger.info('Attempting recovery from checkpoint', {
        checkpointId: info.checkpointId,
      });

      const state = this.checkpointManager.loadCheckpoint(info.checkpointId);
      if (state) {
        // Clear the lock file since we're recovering
        this.releaseLock();
        return state;
      }
    }

    // Try to load the latest checkpoint
    logger.info('Attempting recovery from latest checkpoint');
    const state = this.checkpointManager.loadLatestCheckpoint();

    if (state) {
      this.releaseLock();
      return state;
    }

    logger.warn('No checkpoint available for recovery');
    this.releaseLock();
    return null;
  }

  /**
   * Force clear any stale lock
   */
  forceClearLock(): void {
    const logger = getLogger();

    if (existsSync(this.lockFilePath)) {
      const info = this.getInterruptionInfo();
      logger.warn('Force clearing stale lock', {
        pid: info?.pid,
        startTime: info?.startTime,
      });
      this.releaseLock();
    }
  }

  /**
   * Get the checkpoint manager
   */
  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers(onShutdown: () => Promise<void> | void): void {
    const logger = getLogger();

    const handleSignal = async (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown`);

      try {
        await onShutdown();
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        this.releaseLock();
        process.exit(0);
      }
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.critical('Uncaught exception', {
        error: error.message,
        stack: error.stack,
      });
      this.releaseLock();
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      logger.critical('Unhandled rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      this.releaseLock();
      process.exit(1);
    });
  }
}
