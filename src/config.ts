/**
 * Configuration management for the Autonomous Task Executor
 */

import { parse as parseYaml } from 'yaml';
import { existsSync, readFileSync } from 'fs';
import type { Config, CLIOptions } from './types';

const DEFAULT_CONFIG: Config = {
  linear: {
    mcpUrl: 'https://mcp.linear.app/mcp',
    teamId: undefined,
    apiKey: undefined,
  },
  claude: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8000,
    temperature: 0.3,
    apiKey: undefined,
  },
  execution: {
    maxParallel: 3,
    checkpointInterval: 1,
    dryRun: false,
    resumeFromCheckpoint: undefined,
  },
  rateLimits: {
    rpm: 50,
    itpm: 40000,
    otpm: 8000,
    backoffBase: 1.0,
    backoffMax: 60.0,
    maxRetries: 10,
  },
  logging: {
    level: 'info',
    file: 'logs/execution.log',
    console: true,
  },
};

/**
 * Deep merge two objects, with source overriding target
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[Extract<keyof T, string>];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[Extract<keyof T, string>];
    }
  }

  return result;
}

/**
 * Load configuration from YAML file
 */
function loadConfigFile(path: string): Partial<Config> {
  if (!existsSync(path)) {
    return {};
  }

  const content = readFileSync(path, 'utf-8');
  return parseYaml(content) as Partial<Config>;
}

/**
 * Load configuration from environment variables
 */
function loadEnvConfig(): Partial<Config> {
  const config: Partial<Config> = {};

  // Linear configuration
  if (process.env.LINEAR_API_KEY) {
    config.linear = { ...config.linear, apiKey: process.env.LINEAR_API_KEY };
  }
  if (process.env.LINEAR_TEAM_ID) {
    config.linear = { ...config.linear, teamId: process.env.LINEAR_TEAM_ID };
  }

  // Claude configuration
  if (process.env.ANTHROPIC_API_KEY) {
    config.claude = { ...config.claude, apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.CLAUDE_MODEL) {
    config.claude = { ...config.claude, model: process.env.CLAUDE_MODEL };
  }

  // Execution configuration
  if (process.env.MAX_PARALLEL) {
    config.execution = { ...config.execution, maxParallel: parseInt(process.env.MAX_PARALLEL, 10) };
  }

  // Logging configuration
  if (process.env.LOG_LEVEL) {
    config.logging = {
      ...config.logging,
      level: process.env.LOG_LEVEL as Config['logging']['level'],
    };
  }

  return config;
}

/**
 * Load and merge configuration from all sources
 * Priority (highest to lowest): CLI options > Environment > Config file > Defaults
 */
export function loadConfig(options: CLIOptions): Config {
  // Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // Merge config file if specified or exists
  const configPath = options.config || 'config/default.yaml';
  const fileConfig = loadConfigFile(configPath);
  config = deepMerge(config, fileConfig);

  // Merge environment variables
  const envConfig = loadEnvConfig();
  config = deepMerge(config, envConfig);

  // Merge CLI options
  if (options.team) {
    config.linear.teamId = options.team;
  }
  if (options.maxParallel) {
    config.execution.maxParallel = options.maxParallel;
  }
  if (options.dryRun) {
    config.execution.dryRun = options.dryRun;
  }
  if (options.resume) {
    config.execution.resumeFromCheckpoint = options.resume;
  }
  if (options.verbose) {
    config.logging.level = 'debug';
  }

  return config;
}

/**
 * Validate configuration and return any errors
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  if (!config.claude.apiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  if (!config.linear.apiKey) {
    errors.push('LINEAR_API_KEY is required');
  }

  if (!config.linear.teamId) {
    errors.push('Linear team ID is required (--team or LINEAR_TEAM_ID)');
  }

  if (config.execution.maxParallel < 1) {
    errors.push('maxParallel must be at least 1');
  }

  if (config.rateLimits.rpm < 1) {
    errors.push('RPM limit must be at least 1');
  }

  return errors;
}

export { DEFAULT_CONFIG };
