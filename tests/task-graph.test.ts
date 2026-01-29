/**
 * Tests for TaskGraph
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TaskGraph } from '../src/core/task-graph';
import type { Task } from '../src/types';

function createMockTask(id: string, dependencies: string[] = []): Task {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
    status: 'todo',
    priority: 1,
    teamId: 'team-1',
    labels: [],
    dependencies,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('TaskGraph', () => {
  let graph: TaskGraph;

  beforeEach(() => {
    graph = new TaskGraph();
  });

  describe('addTask', () => {
    test('should add a task without dependencies', () => {
      const task = createMockTask('TASK-1');
      graph.addTask(task);

      expect(graph.size()).toBe(1);
      expect(graph.getTask('TASK-1')).toEqual(task);
    });

    test('should add a task with dependencies', () => {
      const task1 = createMockTask('TASK-1');
      const task2 = createMockTask('TASK-2', ['TASK-1']);

      graph.addTask(task1);
      graph.addTask(task2);

      expect(graph.size()).toBe(2);
    });
  });

  describe('validateAcyclic', () => {
    test('should validate acyclic graph', () => {
      graph.addTask(createMockTask('TASK-1'));
      graph.addTask(createMockTask('TASK-2', ['TASK-1']));
      graph.addTask(createMockTask('TASK-3', ['TASK-2']));

      const result = graph.validateAcyclic();
      expect(result.valid).toBe(true);
      expect(result.cycles).toBeUndefined();
    });

    test('should detect cycles', () => {
      graph.addTask(createMockTask('TASK-1', ['TASK-3']));
      graph.addTask(createMockTask('TASK-2', ['TASK-1']));
      graph.addTask(createMockTask('TASK-3', ['TASK-2']));

      const result = graph.validateAcyclic();
      expect(result.valid).toBe(false);
      expect(result.cycles).toBeDefined();
    });
  });

  describe('topologicalSort', () => {
    test('should return tasks in correct order', () => {
      graph.addTask(createMockTask('TASK-1'));
      graph.addTask(createMockTask('TASK-2', ['TASK-1']));
      graph.addTask(createMockTask('TASK-3', ['TASK-1']));
      graph.addTask(createMockTask('TASK-4', ['TASK-2', 'TASK-3']));

      const sorted = graph.topologicalSort();

      // TASK-1 must come before TASK-2, TASK-3
      // TASK-2 and TASK-3 must come before TASK-4
      const indexOf = (id: string) => sorted.indexOf(id);

      expect(indexOf('TASK-1')).toBeLessThan(indexOf('TASK-2'));
      expect(indexOf('TASK-1')).toBeLessThan(indexOf('TASK-3'));
      expect(indexOf('TASK-2')).toBeLessThan(indexOf('TASK-4'));
      expect(indexOf('TASK-3')).toBeLessThan(indexOf('TASK-4'));
    });
  });

  describe('getReadyTasks', () => {
    test('should return tasks with no dependencies', () => {
      graph.addTask(createMockTask('TASK-1'));
      graph.addTask(createMockTask('TASK-2'));
      graph.addTask(createMockTask('TASK-3', ['TASK-1']));

      const ready = graph.getReadyTasks(new Set());

      expect(ready).toContain('TASK-1');
      expect(ready).toContain('TASK-2');
      expect(ready).not.toContain('TASK-3');
    });

    test('should return tasks with satisfied dependencies', () => {
      graph.addTask(createMockTask('TASK-1'));
      graph.addTask(createMockTask('TASK-2', ['TASK-1']));

      const ready = graph.getReadyTasks(new Set(['TASK-1']));

      expect(ready).toContain('TASK-2');
    });
  });

  describe('markCompleted', () => {
    test('should mark task as completed', () => {
      graph.addTask(createMockTask('TASK-1'));
      graph.markCompleted('TASK-1');

      const counts = graph.getStatusCounts();
      expect(counts.completed).toBe(1);
    });
  });

  describe('getParallelCandidates', () => {
    test('should limit candidates to max parallel', () => {
      graph.addTask(createMockTask('TASK-1'));
      graph.addTask(createMockTask('TASK-2'));
      graph.addTask(createMockTask('TASK-3'));
      graph.addTask(createMockTask('TASK-4'));

      const ready = graph.getReadyTasks(new Set());
      const candidates = graph.getParallelCandidates(ready, 2);

      expect(candidates.length).toBe(2);
    });
  });
});
