type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatLog(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    ...meta,
  };

  // In production use JSON for structured log aggregation
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(entry);
  }

  // In development use readable format
  const prefix = `[${entry.timestamp}] ${level.toUpperCase().padEnd(5)} [${context}]`;
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${prefix} ${message}${metaStr}`;
}

function createLogger(context: string) {
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('debug')) console.debug(formatLog('debug', context, message, meta));
    },
    info(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('info')) console.log(formatLog('info', context, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('warn')) console.warn(formatLog('warn', context, message, meta));
    },
    error(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('error')) console.error(formatLog('error', context, message, meta));
    },
  };
}

export { createLogger, LogLevel };
