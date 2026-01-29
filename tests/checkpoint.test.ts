/**
 * Tests for CheckpointManager
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { CheckpointManager } from '../src/state/checkpoint';
import type { ExecutionState } from '../src/types';

const TEST_CHECKPOINT_DIR = 'data/test-checkpoints';

describe('CheckpointManager', () => {
  let manager: CheckpointManager;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_CHECKPOINT_DIR)) {
      rmSync(TEST_CHECKPOINT_DIR, { recursive: true });
    }
    manager = new CheckpointManager(TEST_CHECKPOINT_DIR);
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(TEST_CHECKPOINT_DIR)) {
      rmSync(TEST_CHECKPOINT_DIR, { recursive: true });
    }
  });

  describe('createInitialState', () => {
    test('should create empty initial state', () => {
      const state = manager.createInitialState();

      expect(state.checkpointId).toBeDefined();
      expect(state.completedTasks.size).toBe(0);
      expect(state.failedTasks.size).toBe(0);
      expect(state.inProgressTasks.size).toBe(0);
      expect(state.totalTokensUsed).toBe(0);
      expect(state.executionTimeMs).toBe(0);
    });
  });

  describe('saveCheckpoint', () => {
    test('should save checkpoint to file', () => {
      const state = manager.createInitialState();
      state.completedTasks.add('TASK-1');
      state.completedTasks.add('TASK-2');

      const path = manager.saveCheckpoint(state);

      expect(existsSync(path)).toBe(true);
    });

    test('should use atomic write (temp file + rename)', () => {
      const state = manager.createInitialState();

      // Save checkpoint
      manager.saveCheckpoint(state);

      // No temp files should remain
      const files = readdirSync(TEST_CHECKPOINT_DIR);
      const tempFiles = files.filter((f) => f.endsWith('.tmp'));

      expect(tempFiles.length).toBe(0);
    });

    test('should reuse checkpoint ID on subsequent saves', () => {
      const state = manager.createInitialState();
      const originalId = state.checkpointId;

      manager.saveCheckpoint(state);
      state.completedTasks.add('TASK-1');
      manager.saveCheckpoint(state);

      expect(state.checkpointId).toBe(originalId);
    });
  });

  describe('loadCheckpoint', () => {
    test('should load saved checkpoint', () => {
      const state = manager.createInitialState();
      state.completedTasks.add('TASK-1');
      state.failedTasks.set('TASK-2', {
        code: 'ERROR',
        message: 'Test error',
        retryable: false,
      });
      state.totalTokensUsed = 1000;

      manager.saveCheckpoint(state);

      const loaded = manager.loadCheckpoint(state.checkpointId);

      expect(loaded).not.toBeNull();
      expect(loaded!.completedTasks.has('TASK-1')).toBe(true);
      expect(loaded!.failedTasks.has('TASK-2')).toBe(true);
      expect(loaded!.failedTasks.get('TASK-2')?.message).toBe('Test error');
      expect(loaded!.totalTokensUsed).toBe(1000);
    });

    test('should return null for non-existent checkpoint', () => {
      const loaded = manager.loadCheckpoint('non-existent-id');

      expect(loaded).toBeNull();
    });

    test('should convert Sets and Maps correctly', () => {
      const state = manager.createInitialState();
      state.completedTasks.add('TASK-1');
      state.inProgressTasks.add('TASK-2');
      state.failedTasks.set('TASK-3', {
        code: 'ERROR',
        message: 'Test',
        retryable: true,
      });

      manager.saveCheckpoint(state);
      const loaded = manager.loadCheckpoint(state.checkpointId);

      expect(loaded!.completedTasks instanceof Set).toBe(true);
      expect(loaded!.inProgressTasks instanceof Set).toBe(true);
      expect(loaded!.failedTasks instanceof Map).toBe(true);
    });
  });

  describe('loadLatestCheckpoint', () => {
    test('should return null when no checkpoints exist', () => {
      const loaded = manager.loadLatestCheckpoint();

      expect(loaded).toBeNull();
    });

    test('should load most recent checkpoint', async () => {
      // Create multiple checkpoints with slight time delays
      const state1 = manager.createInitialState();
      state1.completedTasks.add('TASK-1');
      manager.saveCheckpoint(state1);

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state2 = manager.createInitialState();
      state2.completedTasks.add('TASK-2');
      state2.completedTasks.add('TASK-3');
      manager.saveCheckpoint(state2);

      const loaded = manager.loadLatestCheckpoint();

      expect(loaded).not.toBeNull();
      expect(loaded!.completedTasks.has('TASK-2')).toBe(true);
      expect(loaded!.completedTasks.has('TASK-3')).toBe(true);
    });
  });

  describe('listCheckpoints', () => {
    test('should return empty array when no checkpoints', () => {
      const checkpoints = manager.listCheckpoints();

      expect(checkpoints.length).toBe(0);
    });

    test('should list all checkpoints', async () => {
      const state1 = manager.createInitialState();
      manager.saveCheckpoint(state1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const state2 = manager.createInitialState();
      manager.saveCheckpoint(state2);

      const checkpoints = manager.listCheckpoints();

      expect(checkpoints.length).toBe(2);
    });

    test('should include checkpoint info', () => {
      const state = manager.createInitialState();
      state.completedTasks.add('TASK-1');
      state.failedTasks.set('TASK-2', {
        code: 'ERROR',
        message: 'Test',
        retryable: false,
      });
      manager.saveCheckpoint(state);

      const checkpoints = manager.listCheckpoints();

      expect(checkpoints[0].tasksCompleted).toBe(1);
      expect(checkpoints[0].tasksFailed).toBe(1);
      expect(checkpoints[0].path).toContain(TEST_CHECKPOINT_DIR);
    });
  });

  describe('deleteCheckpoint', () => {
    test('should delete checkpoint file', () => {
      const state = manager.createInitialState();
      const path = manager.saveCheckpoint(state);

      expect(existsSync(path)).toBe(true);

      const deleted = manager.deleteCheckpoint(state.checkpointId);

      expect(deleted).toBe(true);
      expect(existsSync(path)).toBe(false);
    });

    test('should return false for non-existent checkpoint', () => {
      const deleted = manager.deleteCheckpoint('non-existent');

      expect(deleted).toBe(false);
    });
  });

  describe('cleanupOldCheckpoints', () => {
    test('should keep only recent checkpoints', async () => {
      // Create 7 checkpoints
      for (let i = 0; i < 7; i++) {
        const state = manager.createInitialState();
        state.completedTasks.add(`TASK-${i}`);
        manager.saveCheckpoint(state);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const beforeCleanup = manager.listCheckpoints();
      expect(beforeCleanup.length).toBe(7);

      const deleted = manager.cleanupOldCheckpoints(5);

      expect(deleted).toBe(2);

      const afterCleanup = manager.listCheckpoints();
      expect(afterCleanup.length).toBe(5);
    });

    test('should not delete when under limit', () => {
      const state = manager.createInitialState();
      manager.saveCheckpoint(state);

      const deleted = manager.cleanupOldCheckpoints(5);

      expect(deleted).toBe(0);
      expect(manager.listCheckpoints().length).toBe(1);
    });
  });

  describe('getCurrentCheckpointId', () => {
    test('should return null initially', () => {
      expect(manager.getCurrentCheckpointId()).toBeNull();
    });

    test('should return current checkpoint ID after save', () => {
      const state = manager.createInitialState();
      manager.saveCheckpoint(state);

      expect(manager.getCurrentCheckpointId()).toBe(state.checkpointId);
    });

    test('should return checkpoint ID after load', () => {
      const state = manager.createInitialState();
      manager.saveCheckpoint(state);

      // Create new manager instance
      const newManager = new CheckpointManager(TEST_CHECKPOINT_DIR);
      newManager.loadCheckpoint(state.checkpointId);

      expect(newManager.getCurrentCheckpointId()).toBe(state.checkpointId);
    });
  });
});
