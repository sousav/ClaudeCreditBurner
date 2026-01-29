/**
 * Tests for Validator
 */

import { describe, test, expect } from 'bun:test';
import { Validator } from '../src/core/validator';
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

describe('Validator', () => {
  describe('validate', () => {
    test('should pass valid output', () => {
      const validator = new Validator();
      const task = createMockTask();
      const output = 'Here is the solution to the task.';

      const result = validator.validate(output, task);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should fail empty output', () => {
      const validator = new Validator();
      const task = createMockTask();
      const output = '   ';

      const result = validator.validate(output, task);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('[non-empty] Output cannot be empty');
    });

    test('should fail output with error markers', () => {
      const validator = new Validator();
      const task = createMockTask();
      const output = 'ERROR: Something went wrong with the task';

      const result = validator.validate(output, task);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('error markers'))).toBe(true);
    });

    test('should fail output that exceeds length limit', () => {
      const validator = new Validator();
      const task = createMockTask();
      const output = 'x'.repeat(150000);

      const result = validator.validate(output, task);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('length limit'))).toBe(true);
    });

    test('should warn when code task has no code blocks', () => {
      const validator = new Validator();
      const task = createMockTask({ labels: ['code'] });
      const output = 'Here is a solution without code blocks.';

      const result = validator.validate(output, task);

      expect(result.warnings.some((w) => w.includes('no code blocks'))).toBe(true);
    });
  });

  describe('extractArtifacts', () => {
    test('should extract code blocks', () => {
      const validator = new Validator();
      const output = `Here is some code:
\`\`\`typescript
const x = 1;
console.log(x);
\`\`\`
And some more code:
\`\`\`python
print("hello")
\`\`\``;

      const artifacts = validator.extractArtifacts(output);

      expect(artifacts.length).toBe(2);
      expect(artifacts[0].type).toBe('code');
      expect(artifacts[0].language).toBe('typescript');
      expect(artifacts[0].content).toContain('const x = 1');
      expect(artifacts[1].language).toBe('python');
    });

    test('should extract code blocks without language', () => {
      const validator = new Validator();
      const output = `\`\`\`
some code
\`\`\``;

      const artifacts = validator.extractArtifacts(output);

      expect(artifacts.length).toBe(1);
      expect(artifacts[0].language).toBe('text');
    });

    test('should extract JSON objects', () => {
      const validator = new Validator();
      const output = `Here is some JSON:
{"name": "test", "value": 123}`;

      const artifacts = validator.extractArtifacts(output);

      expect(artifacts.some((a) => a.type === 'json')).toBe(true);
    });

    test('should not extract invalid JSON', () => {
      const validator = new Validator();
      const output = `Here is invalid JSON:
{name: test, value: 123}`;

      const artifacts = validator.extractArtifacts(output);

      expect(artifacts.filter((a) => a.type === 'json').length).toBe(0);
    });
  });

  describe('parseResponseSections', () => {
    test('should parse ## sections', () => {
      const validator = new Validator();
      const output = `## Analysis
This is the analysis.

## Solution
Here is the solution.

## Notes
Some notes here.`;

      const sections = validator.parseResponseSections(output);

      expect(sections['analysis']).toContain('This is the analysis');
      expect(sections['solution']).toContain('Here is the solution');
      expect(sections['notes']).toContain('Some notes here');
    });
  });

  describe('checkCompletion', () => {
    test('should detect completed task', () => {
      const validator = new Validator();
      const output = 'I have completed the task and implemented the feature.';

      const result = validator.checkCompletion(output);

      expect(result.completed).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should detect incomplete task', () => {
      const validator = new Validator();
      const output = 'This task is not yet complete, it requires more work.';

      const result = validator.checkCompletion(output);

      expect(result.completed).toBe(false);
    });
  });

  describe('addRule', () => {
    test('should allow custom validation rules', () => {
      const validator = new Validator();
      const task = createMockTask();

      validator.addRule({
        name: 'custom-rule',
        validate: (output) => ({
          pass: output.includes('CUSTOM'),
          message: 'Output must contain CUSTOM',
        }),
      });

      const result = validator.validate('No custom keyword here', task);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('CUSTOM'))).toBe(true);
    });

    test('should pass custom rule when condition met', () => {
      const validator = new Validator();
      const task = createMockTask();

      validator.addRule({
        name: 'custom-rule',
        validate: (output) => ({
          pass: output.includes('SUCCESS'),
          message: 'Output must contain SUCCESS',
        }),
      });

      const result = validator.validate('Task completed with SUCCESS!', task);

      expect(result.valid).toBe(true);
    });
  });

  describe('createValidationError', () => {
    test('should create ExecutionError from validation result', () => {
      const validator = new Validator();
      const validationResult = {
        valid: false,
        errors: ['Error 1', 'Error 2'],
        warnings: ['Warning 1'],
        artifacts: [],
      };

      const error = validator.createValidationError(validationResult);

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.message).toContain('Error 1');
      expect(error.message).toContain('Error 2');
      expect(error.retryable).toBe(false);
      expect(error.context?.errors).toEqual(['Error 1', 'Error 2']);
    });
  });
});
