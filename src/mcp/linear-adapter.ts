/**
 * Linear Adapter - High-level Linear operations via MCP
 */

import type { Task, TaskStatus } from '../types';
import { MCPClient } from './client';
import { getLogger } from '../utils/logger';

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  priority: number;
  labels: {
    nodes: Array<{
      id: string;
      name: string;
    }>;
  };
  team: {
    id: string;
    name: string;
  };
  assignee?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface LinearFilters {
  status?: string[];
  labels?: string[];
  assignee?: string;
  priority?: number;
}

export class LinearAdapter {
  private mcpClient: MCPClient;
  private teamId?: string;

  constructor(mcpClient: MCPClient, teamId?: string) {
    this.mcpClient = mcpClient;
    this.teamId = teamId;
  }

  /**
   * Map Linear state to internal task status
   */
  private mapStateToStatus(stateType: string): TaskStatus {
    const mapping: Record<string, TaskStatus> = {
      backlog: 'backlog',
      unstarted: 'todo',
      started: 'in_progress',
      completed: 'done',
      canceled: 'cancelled',
    };
    return mapping[stateType.toLowerCase()] || 'todo';
  }

  /**
   * Map internal task status to Linear state name
   */
  private mapStatusToState(status: TaskStatus): string {
    const mapping: Record<TaskStatus, string> = {
      backlog: 'Backlog',
      todo: 'Todo',
      in_progress: 'In Progress',
      in_review: 'In Review',
      done: 'Done',
      cancelled: 'Canceled',
    };
    return mapping[status];
  }

  /**
   * Convert Linear issue to internal Task
   */
  private issueToTask(issue: LinearIssue): Task {
    // Extract dependencies from description (looking for patterns like "depends on: XXX-123")
    const dependencies = this.extractDependencies(issue.description || '');

    return {
      id: issue.identifier,
      title: issue.title,
      description: issue.description || '',
      status: this.mapStateToStatus(issue.state.type),
      priority: issue.priority,
      teamId: issue.team.id,
      labels: issue.labels.nodes.map((l) => l.name),
      dependencies,
      assigneeId: issue.assignee?.id,
      createdAt: new Date(issue.createdAt),
      updatedAt: new Date(issue.updatedAt),
    };
  }

  /**
   * Extract task dependencies from description
   */
  extractDependencies(description: string): string[] {
    const dependencies: string[] = [];

    // Pattern 1: "depends on: XXX-123, XXX-456"
    const dependsOnMatch = description.match(/depends?\s+on:?\s*([A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)/i);
    if (dependsOnMatch) {
      const ids = dependsOnMatch[1].split(/\s*,\s*/);
      dependencies.push(...ids);
    }

    // Pattern 2: "blocked by: XXX-123"
    const blockedByMatch = description.match(/blocked\s+by:?\s*([A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)/i);
    if (blockedByMatch) {
      const ids = blockedByMatch[1].split(/\s*,\s*/);
      dependencies.push(...ids);
    }

    // Pattern 3: "after: XXX-123"
    const afterMatch = description.match(/after:?\s*([A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)/i);
    if (afterMatch) {
      const ids = afterMatch[1].split(/\s*,\s*/);
      dependencies.push(...ids);
    }

    // Deduplicate
    return [...new Set(dependencies)];
  }

  /**
   * Fetch tasks from Linear
   */
  async fetchTasks(filters?: LinearFilters): Promise<Task[]> {
    const logger = getLogger();

    if (!this.teamId) {
      logger.error('Team ID is required to fetch tasks');
      return [];
    }

    // Build filter parameters
    const filterParams: Record<string, unknown> = {
      teamId: this.teamId,
    };

    if (filters?.status) {
      filterParams.stateNames = filters.status;
    }
    if (filters?.labels) {
      filterParams.labelNames = filters.labels;
    }
    if (filters?.assignee) {
      filterParams.assigneeId = filters.assignee;
    }

    const result = await this.mcpClient.callTool('list_issues', filterParams);

    if (!result.success) {
      logger.error('Failed to fetch tasks from Linear', { error: result.error });
      return [];
    }

    const issues = (result.data as { issues: LinearIssue[] })?.issues || [];
    const tasks = issues.map((issue) => this.issueToTask(issue));

    logger.info('Fetched tasks from Linear', { count: tasks.length });
    return tasks;
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const logger = getLogger();

    const result = await this.mcpClient.callTool('get_issue', { issueId: taskId });

    if (!result.success) {
      logger.error('Failed to get task from Linear', { taskId, error: result.error });
      return null;
    }

    const issue = result.data as LinearIssue;
    return this.issueToTask(issue);
  }

  /**
   * Update task status in Linear
   */
  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<boolean> {
    const logger = getLogger();

    const stateName = this.mapStatusToState(status);

    const result = await this.mcpClient.callTool('update_issue', {
      issueId: taskId,
      stateName,
    });

    if (!result.success) {
      logger.error('Failed to update task status', { taskId, status, error: result.error });
      return false;
    }

    logger.info('Updated task status', { taskId, status });
    return true;
  }

  /**
   * Add a comment to a task with execution results
   */
  async addExecutionComment(
    taskId: string,
    result: { success: boolean; output?: string; error?: string; tokensUsed?: number }
  ): Promise<boolean> {
    const logger = getLogger();

    // Build comment content
    let content = `## Automated Execution Result\n\n`;
    content += `**Status:** ${result.success ? '✅ Success' : '❌ Failed'}\n\n`;

    if (result.tokensUsed) {
      content += `**Tokens Used:** ${result.tokensUsed}\n\n`;
    }

    if (result.success && result.output) {
      content += `### Output\n\n`;
      // Truncate if too long
      const truncatedOutput =
        result.output.length > 2000 ? result.output.substring(0, 2000) + '\n\n... (truncated)' : result.output;
      content += `\`\`\`\n${truncatedOutput}\n\`\`\`\n`;
    }

    if (!result.success && result.error) {
      content += `### Error\n\n`;
      content += `\`\`\`\n${result.error}\n\`\`\`\n`;
    }

    content += `\n---\n*Generated by Claude Credit Burner*`;

    const mcpResult = await this.mcpClient.callTool('add_comment', {
      issueId: taskId,
      body: content,
    });

    if (!mcpResult.success) {
      logger.error('Failed to add comment', { taskId, error: mcpResult.error });
      return false;
    }

    logger.debug('Added execution comment', { taskId });
    return true;
  }

  /**
   * Assign task to a user
   */
  async assignTask(taskId: string, assigneeId: string): Promise<boolean> {
    const logger = getLogger();

    const result = await this.mcpClient.callTool('update_issue', {
      issueId: taskId,
      assigneeId,
    });

    if (!result.success) {
      logger.error('Failed to assign task', { taskId, assigneeId, error: result.error });
      return false;
    }

    logger.info('Assigned task', { taskId, assigneeId });
    return true;
  }

  /**
   * Set the team ID
   */
  setTeamId(teamId: string): void {
    this.teamId = teamId;
  }

  /**
   * Get the team ID
   */
  getTeamId(): string | undefined {
    return this.teamId;
  }
}
