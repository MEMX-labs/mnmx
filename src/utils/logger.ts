/**
 * MNMX Structured Logger
 *
 * Provides leveled, context-tagged logging with formatted timestamps.
 * Each logger instance carries a module tag so that log output can be
 * filtered by subsystem without global configuration changes.
 *
 * Usage:
 *   const log = new Logger('engine:minimax');
 *   log.info('Search started', { depth: 6, actions: 12 });
 *   log.debug('Node evaluated', { hash: 'abc123', score: 0.75 });
 */

// ── Log Levels ───────────────────────────────────────────────────────

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO ',
  [LogLevel.WARN]: 'WARN ',
  [LogLevel.ERROR]: 'ERROR',
};

// ── Log Entry ────────────────────────────────────────────────────────

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly module: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

// ── Global State ─────────────────────────────────────────────────────

/** Global minimum log level. Messages below this level are discarded. */
let globalMinLevel: LogLevel = LogLevel.INFO;

/** Per-module overrides. If a module is listed here, its level takes precedence. */
const moduleOverrides: Map<string, LogLevel> = new Map();

/** Collected log entries for programmatic access. */
const logBuffer: LogEntry[] = [];

/** Maximum number of entries retained in the buffer. */
let maxBufferSize = 10_000;

/** Whether to write to the console. */
let consoleEnabled = true;

// ── Global Configuration ─────────────────────────────────────────────

/**
 * Set the global minimum log level.
 */
export function setGlobalLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

/**
 * Override the log level for a specific module.
 */
export function setModuleLogLevel(module: string, level: LogLevel): void {
  moduleOverrides.set(module, level);
}

/**
 * Remove the log level override for a specific module.
 */
export function clearModuleLogLevel(module: string): void {
  moduleOverrides.delete(module);
}

/**
 * Enable or disable console output globally.
 */
export function setConsoleEnabled(enabled: boolean): void {
  consoleEnabled = enabled;
}

/**
 * Set the maximum number of log entries retained in the internal buffer.
 */
export function setMaxBufferSize(size: number): void {
  maxBufferSize = Math.max(0, size);
  while (logBuffer.length > maxBufferSize) {
    logBuffer.shift();
  }
}

/**
 * Retrieve all buffered log entries. Returns a shallow copy.
 */
export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

/**
 * Clear the internal log buffer.
 */
export function clearLogBuffer(): void {
  logBuffer.length = 0;
}

// ── Logger Class ─────────────────────────────────────────────────────

export class Logger {
  private readonly module: string;

  constructor(module: string) {
    this.module = module;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Create a child logger that inherits this logger's module prefix.
   * The child module is formatted as "parent:child".
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }

  /**
   * Check whether a given log level would be emitted by this logger.
   * Useful to avoid expensive string formatting for debug messages.
   */
  isEnabled(level: LogLevel): boolean {
    return this.getEffectiveLevel() <= level;
  }

  // ── Private ────────────────────────────────────────────────────────

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (level < this.getEffectiveLevel()) return;

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      module: this.module,
      message,
      data,
    };

    // Buffer
    if (logBuffer.length >= maxBufferSize) {
      logBuffer.shift();
    }
    logBuffer.push(entry);

    // Console output
    if (consoleEnabled) {
      this.writeToConsole(entry);
    }
  }

  private getEffectiveLevel(): LogLevel {
    // Check exact module match first
    const override = moduleOverrides.get(this.module);
    if (override !== undefined) return override;

    // Check parent module prefixes (e.g., "engine" matches "engine:minimax")
    const parts = this.module.split(':');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join(':');
      const parentOverride = moduleOverrides.get(prefix);
      if (parentOverride !== undefined) return parentOverride;
    }

    return globalMinLevel;
  }

  private formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  private writeToConsole(entry: LogEntry): void {
    const levelLabel = LEVEL_LABELS[entry.level];
    const prefix = `[${entry.timestamp}] ${levelLabel} [${entry.module}]`;

    let line = `${prefix} ${entry.message}`;

    if (entry.data !== undefined && Object.keys(entry.data).length > 0) {
      const pairs = Object.entries(entry.data)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(' ');
      line += ` | ${pairs}`;
    }

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(line);
        break;
      case LogLevel.WARN:
        console.warn(line);
        break;
      case LogLevel.DEBUG:
        console.debug(line);
        break;
      default:
        console.log(line);
        break;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
