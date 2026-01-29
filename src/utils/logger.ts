/**
 * Structured logging utility for the Autonomous Task Executor
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { LogLevel } from '../types';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m', // Gray
  info: '\x1b[36m', // Cyan
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
  critical: '\x1b[35m', // Magenta
};

const RESET = '\x1b[0m';

interface LogContext {
  [key: string]: unknown;
}

interface LoggerConfig {
  level: LogLevel;
  file?: string;
  console: boolean;
}

class Logger {
  private config: LoggerConfig;
  private minLevel: number;

  constructor(config: LoggerConfig) {
    this.config = config;
    this.minLevel = LOG_LEVELS[config.level];

    // Ensure log directory exists
    if (config.file) {
      const dir = dirname(config.file);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatConsole(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const color = LOG_COLORS[level];
    const levelStr = level.toUpperCase().padEnd(8);

    let output = `${color}${timestamp} [${levelStr}]${RESET} ${message}`;

    if (context && Object.keys(context).length > 0) {
      const contextStr = Object.entries(context)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
      output += ` ${'\x1b[90m'}${contextStr}${RESET}`;
    }

    return output;
  }

  private formatJson(level: LogLevel, message: string, context?: LogContext): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    });
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Console output (human-readable)
    if (this.config.console) {
      console.log(this.formatConsole(level, message, context));
    }

    // File output (JSON lines)
    if (this.config.file) {
      const jsonLine = this.formatJson(level, message, context) + '\n';
      appendFileSync(this.config.file, jsonLine);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  critical(message: string, context?: LogContext): void {
    this.log('critical', message, context);
  }

  /**
   * Log task execution event
   */
  taskEvent(
    event: 'started' | 'completed' | 'failed' | 'skipped',
    taskId: string,
    context?: LogContext
  ): void {
    const level = event === 'failed' ? 'error' : 'info';
    this.log(level, `task_${event}`, { taskId, ...context });
  }

  /**
   * Log rate limit event
   */
  rateLimit(event: 'hit' | 'waiting' | 'resumed', context?: LogContext): void {
    const level = event === 'hit' ? 'warn' : 'info';
    this.log(level, `rate_limit_${event}`, context);
  }

  /**
   * Log checkpoint event
   */
  checkpoint(event: 'saved' | 'loaded' | 'failed', context?: LogContext): void {
    const level = event === 'failed' ? 'error' : 'info';
    this.log(level, `checkpoint_${event}`, context);
  }
}

let globalLogger: Logger | null = null;

/**
 * Initialize the global logger
 */
export function initLogger(config: LoggerConfig): Logger {
  globalLogger = new Logger(config);
  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    // Create a default logger if none exists
    globalLogger = new Logger({
      level: 'info',
      console: true,
    });
  }
  return globalLogger;
}

export { Logger };
