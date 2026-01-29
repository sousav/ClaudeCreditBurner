/**
 * Task Graph - DAG construction and topological sorting
 */

import type { Task, TaskNode, DAGValidationResult } from '../types';

export class TaskGraph {
  private nodes: Map<string, TaskNode>;
  private taskData: Map<string, Task>;

  constructor() {
    this.nodes = new Map();
    this.taskData = new Map();
  }

  /**
   * Add a task to the graph
   */
  addTask(task: Task): void {
    this.taskData.set(task.id, task);

    // Create or update node
    const node: TaskNode = this.nodes.get(task.id) || {
      taskId: task.id,
      dependencies: new Set(),
      dependents: new Set(),
      status: 'pending',
    };

    // Add dependencies
    for (const depId of task.dependencies) {
      node.dependencies.add(depId);

      // Ensure dependent node exists and add reverse reference
      if (!this.nodes.has(depId)) {
        this.nodes.set(depId, {
          taskId: depId,
          dependencies: new Set(),
          dependents: new Set(),
          status: 'pending',
        });
      }
      this.nodes.get(depId)!.dependents.add(task.id);
    }

    this.nodes.set(task.id, node);
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.taskData.get(taskId);
  }

  /**
   * Validate that the graph is acyclic
   */
  validateAcyclic(): DAGValidationResult {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const detectCycle = (nodeId: string, path: string[]): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return false;

      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          if (detectCycle(depId, [...path])) {
            return true;
          }
        } else if (recursionStack.has(depId)) {
          // Found a cycle
          const cycleStart = path.indexOf(depId);
          cycles.push([...path.slice(cycleStart), depId]);
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        detectCycle(nodeId, []);
      }
    }

    // Check for orphaned dependencies
    const orphaned: Array<{ taskId: string; missingDeps: string[] }> = [];
    for (const [taskId, node] of this.nodes) {
      const missingDeps = Array.from(node.dependencies).filter(
        (depId) => !this.taskData.has(depId)
      );
      if (missingDeps.length > 0) {
        orphaned.push({ taskId, missingDeps });
      }
    }

    return {
      valid: cycles.length === 0,
      cycles: cycles.length > 0 ? cycles : undefined,
      orphanedDependencies: orphaned.length > 0 ? orphaned : undefined,
    };
  }

  /**
   * Perform topological sort using Kahn's algorithm
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    const queue: string[] = [];
    const result: string[] = [];

    // Initialize in-degrees
    for (const [nodeId, node] of this.nodes) {
      inDegree.set(nodeId, node.dependencies.size);
      if (node.dependencies.size === 0) {
        queue.push(nodeId);
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      const node = this.nodes.get(nodeId)!;
      for (const dependentId of node.dependents) {
        const newDegree = (inDegree.get(dependentId) || 0) - 1;
        inDegree.set(dependentId, newDegree);
        if (newDegree === 0) {
          queue.push(dependentId);
        }
      }
    }

    return result;
  }

  /**
   * Get tasks that are ready to execute (all dependencies satisfied)
   */
  getReadyTasks(completedTasks: Set<string>): string[] {
    const ready: string[] = [];

    for (const [taskId, node] of this.nodes) {
      // Skip if already completed or not pending
      if (completedTasks.has(taskId) || node.status !== 'pending') {
        continue;
      }

      // Check if all dependencies are satisfied
      const allDepsSatisfied = Array.from(node.dependencies).every((depId) =>
        completedTasks.has(depId)
      );

      if (allDepsSatisfied) {
        ready.push(taskId);
      }
    }

    return ready;
  }

  /**
   * Get tasks that can be executed in parallel
   */
  getParallelCandidates(readyTasks: string[], maxParallel: number): string[] {
    // Sort by priority (higher priority first)
    const sorted = [...readyTasks].sort((a, b) => {
      const taskA = this.taskData.get(a);
      const taskB = this.taskData.get(b);
      return (taskB?.priority || 0) - (taskA?.priority || 0);
    });

    return sorted.slice(0, maxParallel);
  }

  /**
   * Mark a task as completed
   */
  markCompleted(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.status = 'completed';
    }
  }

  /**
   * Mark a task as failed
   */
  markFailed(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.status = 'failed';
    }
  }

  /**
   * Mark a task as executing
   */
  markExecuting(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.status = 'executing';
    }
  }

  /**
   * Mark tasks blocked by failed dependencies
   */
  markBlockedTasks(failedTasks: Set<string>): string[] {
    const blocked: string[] = [];

    const propagateBlocked = (failedId: string): void => {
      const node = this.nodes.get(failedId);
      if (!node) return;

      for (const dependentId of node.dependents) {
        const dependentNode = this.nodes.get(dependentId);
        if (dependentNode && dependentNode.status === 'pending') {
          dependentNode.status = 'blocked';
          blocked.push(dependentId);
          propagateBlocked(dependentId);
        }
      }
    };

    for (const failedId of failedTasks) {
      propagateBlocked(failedId);
    }

    return blocked;
  }

  /**
   * Check if all tasks are complete
   */
  isComplete(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status === 'pending' || node.status === 'executing' || node.status === 'ready') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get count of tasks by status
   */
  getStatusCounts(): Record<TaskNode['status'], number> {
    const counts: Record<TaskNode['status'], number> = {
      pending: 0,
      ready: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
    };

    for (const node of this.nodes.values()) {
      counts[node.status]++;
    }

    return counts;
  }

  /**
   * Get all task IDs
   */
  getAllTaskIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Get the number of tasks
   */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.nodes.clear();
    this.taskData.clear();
  }
}
