/**
 * Output Validator - Validates Claude API responses
 */

import type { Task, Artifact, ExecutionError } from '../types';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  artifacts: Artifact[];
}

interface ValidationRule {
  name: string;
  validate: (output: string, task: Task) => { pass: boolean; message?: string };
}

export class Validator {
  private rules: ValidationRule[];

  constructor() {
    this.rules = [
      {
        name: 'non-empty',
        validate: (output: string) => ({
          pass: output.trim().length > 0,
          message: 'Output cannot be empty',
        }),
      },
      {
        name: 'no-error-markers',
        validate: (output: string) => {
          const errorMarkers = ['ERROR:', 'FAILED:', 'Exception:', 'Traceback'];
          const hasError = errorMarkers.some((marker) => output.includes(marker));
          return {
            pass: !hasError,
            message: hasError ? 'Output contains error markers' : undefined,
          };
        },
      },
      {
        name: 'reasonable-length',
        validate: (output: string) => ({
          pass: output.length < 100000,
          message: 'Output exceeds reasonable length limit',
        }),
      },
    ];
  }

  /**
   * Add a custom validation rule
   */
  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Validate output against all rules
   */
  validate(output: string, task: Task): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of this.rules) {
      const result = rule.validate(output, task);
      if (!result.pass && result.message) {
        errors.push(`[${rule.name}] ${result.message}`);
      }
    }

    // Extract artifacts
    const artifacts = this.extractArtifacts(output);

    // Additional validation based on task labels
    if (task.labels.includes('code') && artifacts.filter((a) => a.type === 'code').length === 0) {
      warnings.push('Task is labeled as code but no code blocks were found');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      artifacts,
    };
  }

  /**
   * Extract artifacts (code blocks, JSON, etc.) from output
   */
  extractArtifacts(output: string): Artifact[] {
    const artifacts: Artifact[] = [];

    // Extract fenced code blocks
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(output)) !== null) {
      const language = match[1] || 'text';
      const content = match[2].trim();

      artifacts.push({
        type: 'code',
        content,
        language,
      });
    }

    // Extract JSON objects (outside code blocks)
    const jsonRegex = /(?:^|\n)(\{[\s\S]*?\})(?:\n|$)/g;
    while ((match = jsonRegex.exec(output)) !== null) {
      try {
        JSON.parse(match[1]);
        artifacts.push({
          type: 'json',
          content: match[1],
        });
      } catch {
        // Not valid JSON, skip
      }
    }

    return artifacts;
  }

  /**
   * Parse structured response sections
   */
  parseResponseSections(output: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const sectionRegex = /^##?\s*(\w+):?\s*$/gm;
    const matches = [...output.matchAll(sectionRegex)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const sectionName = match[1].toLowerCase();
      const startIndex = match.index! + match[0].length;
      const endIndex = matches[i + 1]?.index || output.length;
      sections[sectionName] = output.substring(startIndex, endIndex).trim();
    }

    return sections;
  }

  /**
   * Check if output indicates the task was completed successfully
   */
  checkCompletion(output: string): { completed: boolean; confidence: number } {
    const completionIndicators = [
      'completed',
      'done',
      'finished',
      'implemented',
      'created',
      'added',
      'fixed',
      'resolved',
    ];

    const incompleteIndicators = [
      'todo',
      'not yet',
      'pending',
      'incomplete',
      'partially',
      'needs',
      'requires',
      'cannot',
      "can't",
      'unable',
    ];

    const lowerOutput = output.toLowerCase();

    const completionScore = completionIndicators.filter((i) => lowerOutput.includes(i)).length;

    const incompleteScore = incompleteIndicators.filter((i) => lowerOutput.includes(i)).length;

    const completed = completionScore > incompleteScore;
    const confidence = Math.min(
      1,
      Math.abs(completionScore - incompleteScore) / Math.max(completionScore + incompleteScore, 1)
    );

    return { completed, confidence };
  }

  /**
   * Create an ExecutionError from validation result
   */
  createValidationError(result: ValidationResult): ExecutionError {
    return {
      code: 'VALIDATION_FAILED',
      message: result.errors.join('; '),
      retryable: false,
      context: {
        errors: result.errors,
        warnings: result.warnings,
      },
    };
  }
}
