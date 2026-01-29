/**
 * Prompt Builder - Generates contextual prompts for Claude API
 */

import type { Task, ExecutionResult } from '../types';

interface PromptContext {
  projectDescription?: string;
  completedTasks?: Array<{ task: Task; result: ExecutionResult }>;
  relevantFiles?: Array<{ path: string; content: string }>;
  additionalInstructions?: string;
}

export class PromptBuilder {
  private systemPrompt: string;

  constructor(systemPrompt?: string) {
    this.systemPrompt =
      systemPrompt ||
      `You are an expert software developer assistant helping to complete development tasks.
You will be given a task description and relevant context. Your goal is to:
1. Understand the task requirements thoroughly
2. Provide a complete, working solution
3. Follow best practices and coding standards
4. Include any necessary explanations

When providing code:
- Use appropriate language and framework conventions
- Include error handling where appropriate
- Write clean, maintainable code
- Add comments for complex logic

Format your response with clear sections:
- ANALYSIS: Brief analysis of the task
- SOLUTION: The implementation or answer
- NOTES: Any important considerations or follow-up items`;
  }

  /**
   * Build a prompt for task execution
   */
  buildTaskPrompt(task: Task, context?: PromptContext): string {
    const sections: string[] = [];

    // Task header
    sections.push(`# Task: ${task.title}`);
    sections.push(`ID: ${task.id}`);
    sections.push(`Priority: ${task.priority}`);
    sections.push('');

    // Description
    sections.push('## Description');
    sections.push(task.description || 'No description provided.');
    sections.push('');

    // Labels/tags
    if (task.labels.length > 0) {
      sections.push('## Labels');
      sections.push(task.labels.map((l) => `- ${l}`).join('\n'));
      sections.push('');
    }

    // Dependencies context
    if (task.dependencies.length > 0) {
      sections.push('## Dependencies');
      sections.push('This task depends on the following tasks (already completed):');
      sections.push(task.dependencies.map((d) => `- ${d}`).join('\n'));
      sections.push('');
    }

    // Project context
    if (context?.projectDescription) {
      sections.push('## Project Context');
      sections.push(context.projectDescription);
      sections.push('');
    }

    // Completed tasks context (for continuity)
    if (context?.completedTasks && context.completedTasks.length > 0) {
      sections.push('## Previously Completed Tasks');
      for (const { task: prevTask, result } of context.completedTasks.slice(-3)) {
        sections.push(`### ${prevTask.title}`);
        if (result.output) {
          // Include summary of previous output (truncated)
          const summary =
            result.output.length > 500 ? result.output.substring(0, 500) + '...' : result.output;
          sections.push(summary);
        }
        sections.push('');
      }
    }

    // Relevant files
    if (context?.relevantFiles && context.relevantFiles.length > 0) {
      sections.push('## Relevant Files');
      for (const file of context.relevantFiles) {
        sections.push(`### ${file.path}`);
        sections.push('```');
        sections.push(file.content);
        sections.push('```');
        sections.push('');
      }
    }

    // Additional instructions
    if (context?.additionalInstructions) {
      sections.push('## Additional Instructions');
      sections.push(context.additionalInstructions);
      sections.push('');
    }

    // Final instruction
    sections.push('---');
    sections.push('Please complete this task. Provide your response in the format specified.');

    return sections.join('\n');
  }

  /**
   * Get the system prompt
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Set a custom system prompt
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Build a validation prompt
   */
  buildValidationPrompt(task: Task, output: string): string {
    return `Please validate the following output for task "${task.title}":

## Task Description
${task.description}

## Output to Validate
${output}

## Validation Criteria
1. Does the output address the task requirements?
2. Is the code syntactically correct (if applicable)?
3. Are there any obvious errors or issues?
4. Is the solution complete?

Respond with:
- VALID: true/false
- ISSUES: List any issues found (or "None")
- SUGGESTIONS: Any improvements (or "None")`;
  }

  /**
   * Build a summary prompt for multiple task results
   */
  buildSummaryPrompt(results: ExecutionResult[]): string {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    let prompt = `Please summarize the following execution results:\n\n`;

    prompt += `## Statistics\n`;
    prompt += `- Total tasks: ${results.length}\n`;
    prompt += `- Successful: ${successful.length}\n`;
    prompt += `- Failed: ${failed.length}\n\n`;

    if (failed.length > 0) {
      prompt += `## Failed Tasks\n`;
      for (const result of failed) {
        prompt += `- ${result.taskId}: ${result.error?.message || 'Unknown error'}\n`;
      }
      prompt += '\n';
    }

    prompt += `Please provide:\n`;
    prompt += `1. A brief summary of what was accomplished\n`;
    prompt += `2. Any patterns in the failures (if any)\n`;
    prompt += `3. Recommendations for next steps`;

    return prompt;
  }

  /**
   * Estimate token count for a prompt (rough approximation)
   */
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }
}
