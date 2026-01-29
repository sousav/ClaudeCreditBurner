/**
 * Tests for PromptBuilder
 */

import { describe, test, expect } from 'bun:test';
import { PromptBuilder } from '../src/core/prompt-builder';
import type { Task } from '../src/types';

function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'TASK-123',
    title: 'Test Task',
    description: 'A test task description',
    status: 'todo',
    priority: 1,
    teamId: 'team-1',
    labels: [],
    dependencies: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  describe('buildTaskPrompt', () => {
    test('should build basic prompt with task info', () => {
      const builder = new PromptBuilder();
      const task = createMockTask();

      const prompt = builder.buildTaskPrompt(task);

      expect(prompt).toContain('# Task: Test Task');
      expect(prompt).toContain('ID: TASK-123');
      expect(prompt).toContain('Priority: 1');
      expect(prompt).toContain('A test task description');
    });

    test('should include labels when present', () => {
      const builder = new PromptBuilder();
      const task = createMockTask({ labels: ['bug', 'urgent'] });

      const prompt = builder.buildTaskPrompt(task);

      expect(prompt).toContain('## Labels');
      expect(prompt).toContain('- bug');
      expect(prompt).toContain('- urgent');
    });

    test('should include dependencies when present', () => {
      const builder = new PromptBuilder();
      const task = createMockTask({ dependencies: ['TASK-100', 'TASK-101'] });

      const prompt = builder.buildTaskPrompt(task);

      expect(prompt).toContain('## Dependencies');
      expect(prompt).toContain('- TASK-100');
      expect(prompt).toContain('- TASK-101');
    });

    test('should include project context when provided', () => {
      const builder = new PromptBuilder();
      const task = createMockTask();
      const context = {
        projectDescription: 'This is a TypeScript CLI project',
      };

      const prompt = builder.buildTaskPrompt(task, context);

      expect(prompt).toContain('## Project Context');
      expect(prompt).toContain('This is a TypeScript CLI project');
    });

    test('should include relevant files when provided', () => {
      const builder = new PromptBuilder();
      const task = createMockTask();
      const context = {
        relevantFiles: [
          { path: 'src/main.ts', content: 'console.log("hello");' },
        ],
      };

      const prompt = builder.buildTaskPrompt(task, context);

      expect(prompt).toContain('## Relevant Files');
      expect(prompt).toContain('### src/main.ts');
      expect(prompt).toContain('console.log("hello");');
    });
  });

  describe('estimateTokens', () => {
    test('should return 0 for empty string', () => {
      const builder = new PromptBuilder();

      expect(builder.estimateTokens('')).toBe(0);
    });

    test('should estimate tokens for simple text', () => {
      const builder = new PromptBuilder();
      const text = 'Hello world this is a test';

      const estimate = builder.estimateTokens(text);

      // 6 words, so roughly 6-7 tokens
      expect(estimate).toBeGreaterThanOrEqual(6);
      expect(estimate).toBeLessThanOrEqual(10);
    });

    test('should handle long words', () => {
      const builder = new PromptBuilder();
      const text = 'internationalization configuration authentication';

      const estimate = builder.estimateTokens(text);

      // Long words tokenize into multiple tokens
      expect(estimate).toBeGreaterThan(3);
    });

    test('should handle camelCase words', () => {
      const builder = new PromptBuilder();
      const text = 'getTaskExecutionResult handleApiError';

      const estimate = builder.estimateTokens(text);

      // camelCase words often split per segment
      expect(estimate).toBeGreaterThan(2);
    });

    test('should handle code blocks', () => {
      const builder = new PromptBuilder();
      const text = '```typescript\nconst x = 1;\nfunction foo() { return x; }\n```';

      const estimate = builder.estimateTokens(text);

      // Code blocks tokenize more densely
      expect(estimate).toBeGreaterThan(10);
    });

    test('should handle special characters', () => {
      const builder = new PromptBuilder();
      const text = 'Hello {world} [test] (foo) => bar;';

      const estimate = builder.estimateTokens(text);

      // Special characters add to token count
      expect(estimate).toBeGreaterThan(5);
    });

    test('should add buffer for safety', () => {
      const builder = new PromptBuilder();
      const text = 'simple text here';

      const estimate = builder.estimateTokens(text);

      // With 10% buffer, should be slightly higher than word count
      expect(estimate).toBeGreaterThanOrEqual(3);
    });
  });

  describe('estimateTokensFast', () => {
    test('should provide quick estimate for prose', () => {
      const builder = new PromptBuilder();
      const text = 'This is a simple sentence without code.';

      const estimate = builder.estimateTokensFast(text);

      // ~4 chars per token for English
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThan(text.length);
    });

    test('should adjust for code content', () => {
      const builder = new PromptBuilder();
      const proseOnly = 'This is regular text without any code blocks at all.';
      const withCode = 'This has code: ```const x = 1;```';

      const proseEstimate = builder.estimateTokensFast(proseOnly);
      const codeEstimate = builder.estimateTokensFast(withCode);

      // Code content should have a different ratio applied
      // The relative density should be higher for code
      const proseRatio = proseOnly.length / proseEstimate;
      const codeRatio = withCode.length / codeEstimate;

      // Prose ratio should be ~4, code ratio should be ~3.7
      expect(proseRatio).toBeGreaterThan(codeRatio);
    });
  });

  describe('getSystemPrompt and setSystemPrompt', () => {
    test('should return default system prompt', () => {
      const builder = new PromptBuilder();

      const prompt = builder.getSystemPrompt();

      expect(prompt).toContain('expert software developer');
      expect(prompt).toContain('ANALYSIS');
      expect(prompt).toContain('SOLUTION');
    });

    test('should allow custom system prompt', () => {
      const builder = new PromptBuilder();
      const customPrompt = 'You are a helpful assistant.';

      builder.setSystemPrompt(customPrompt);

      expect(builder.getSystemPrompt()).toBe(customPrompt);
    });

    test('should accept custom prompt in constructor', () => {
      const customPrompt = 'Custom system prompt';
      const builder = new PromptBuilder(customPrompt);

      expect(builder.getSystemPrompt()).toBe(customPrompt);
    });
  });

  describe('buildValidationPrompt', () => {
    test('should build validation prompt with task and output', () => {
      const builder = new PromptBuilder();
      const task = createMockTask({ description: 'Fix the bug' });
      const output = 'Here is the fix...';

      const prompt = builder.buildValidationPrompt(task, output);

      expect(prompt).toContain('Test Task');
      expect(prompt).toContain('Fix the bug');
      expect(prompt).toContain('Here is the fix...');
      expect(prompt).toContain('VALID: true/false');
    });
  });

  describe('buildSummaryPrompt', () => {
    test('should build summary with execution results', () => {
      const builder = new PromptBuilder();
      const results = [
        {
          taskId: 'TASK-1',
          success: true,
          tokensUsed: { input: 100, output: 50, total: 150 },
          durationMs: 1000,
          timestamp: new Date(),
        },
        {
          taskId: 'TASK-2',
          success: false,
          error: { code: 'ERROR', message: 'Failed', retryable: false },
          tokensUsed: { input: 100, output: 0, total: 100 },
          durationMs: 500,
          timestamp: new Date(),
        },
      ];

      const prompt = builder.buildSummaryPrompt(results);

      expect(prompt).toContain('Total tasks: 2');
      expect(prompt).toContain('Successful: 1');
      expect(prompt).toContain('Failed: 1');
      expect(prompt).toContain('TASK-2: Failed');
    });
  });
});
