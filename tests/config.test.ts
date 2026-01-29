/**
 * Tests for Configuration management
 */

import { describe, test, expect } from 'bun:test';
import { loadConfig, validateConfig } from '../src/config';
import type { CLIOptions } from '../src/types';

describe('Config', () => {
  describe('loadConfig', () => {
    test('should load default configuration', () => {
      const options: CLIOptions = {
        dryRun: false,
        maxParallel: 3,
        verbose: false,
      };

      const config = loadConfig(options);

      expect(config.linear.mcpUrl).toBe('https://mcp.linear.app/mcp');
      expect(config.claude.model).toBe('claude-sonnet-4-20250514');
      expect(config.claude.maxTokens).toBe(8000);
      expect(config.execution.maxParallel).toBe(3);
    });

    test('should override with CLI options', () => {
      const options: CLIOptions = {
        team: 'test-team-123',
        dryRun: true,
        maxParallel: 5,
        verbose: true,
      };

      const config = loadConfig(options);

      expect(config.linear.teamId).toBe('test-team-123');
      expect(config.execution.dryRun).toBe(true);
      expect(config.execution.maxParallel).toBe(5);
      expect(config.logging.level).toBe('debug'); // verbose sets debug level
    });
  });

  describe('validateConfig', () => {
    test('should return errors for missing required fields', () => {
      const config = {
        linear: { mcpUrl: 'url' },
        claude: { model: 'model', maxTokens: 8000, temperature: 0.3 },
        execution: { maxParallel: 3, checkpointInterval: 1, dryRun: false },
        rateLimits: { rpm: 50, itpm: 40000, otpm: 8000, backoffBase: 1, backoffMax: 60, maxRetries: 10 },
        logging: { level: 'info' as const, file: 'test.log', console: true },
      };

      const errors = validateConfig(config);

      expect(errors).toContain('ANTHROPIC_API_KEY is required');
      expect(errors).toContain('LINEAR_API_KEY is required');
      expect(errors).toContain('Linear team ID is required (--team or LINEAR_TEAM_ID)');
    });

    test('should validate maxParallel is at least 1', () => {
      const config = {
        linear: { mcpUrl: 'url', apiKey: 'key', teamId: 'team' },
        claude: { model: 'model', maxTokens: 8000, temperature: 0.3, apiKey: 'key' },
        execution: { maxParallel: 0, checkpointInterval: 1, dryRun: false },
        rateLimits: { rpm: 50, itpm: 40000, otpm: 8000, backoffBase: 1, backoffMax: 60, maxRetries: 10 },
        logging: { level: 'info' as const, file: 'test.log', console: true },
      };

      const errors = validateConfig(config);

      expect(errors).toContain('maxParallel must be at least 1');
    });

    test('should pass validation with all required fields', () => {
      const config = {
        linear: { mcpUrl: 'url', apiKey: 'lin_api_xxx', teamId: 'team-123' },
        claude: { model: 'model', maxTokens: 8000, temperature: 0.3, apiKey: 'sk-ant-xxx' },
        execution: { maxParallel: 3, checkpointInterval: 1, dryRun: false },
        rateLimits: { rpm: 50, itpm: 40000, otpm: 8000, backoffBase: 1, backoffMax: 60, maxRetries: 10 },
        logging: { level: 'info' as const, file: 'test.log', console: true },
      };

      const errors = validateConfig(config);

      expect(errors.length).toBe(0);
    });
  });
});

describe('snakeToCamel conversion', () => {
  // Test the YAML snake_case to camelCase conversion
  // This is implicitly tested through loadConfigFile behavior
  test('should handle nested snake_case keys', () => {
    // The actual YAML file uses snake_case:
    // mcp_url -> mcpUrl
    // team_id -> teamId
    // max_tokens -> maxTokens
    // max_parallel -> maxParallel
    // checkpoint_interval -> checkpointInterval
    // backoff_base -> backoffBase
    // backoff_max -> backoffMax
    // max_retries -> maxRetries

    const options: CLIOptions = {
      dryRun: false,
      maxParallel: 3,
      verbose: false,
      config: 'config/default.yaml',
    };

    const config = loadConfig(options);

    // These should be properly converted from snake_case in YAML
    expect(config.linear.mcpUrl).toBeDefined();
    expect(config.claude.maxTokens).toBeDefined();
    expect(config.rateLimits.backoffBase).toBeDefined();
    expect(config.rateLimits.backoffMax).toBeDefined();
    expect(config.rateLimits.maxRetries).toBeDefined();
  });
});
