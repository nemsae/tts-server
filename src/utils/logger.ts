type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${dataStr}`;
}

export const logger = {
  debug(context: string, message: string, data?: unknown): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', context, message, data));
    }
  },

  info(context: string, message: string, data?: unknown): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', context, message, data));
    }
  },

  warn(context: string, message: string, data?: unknown): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', context, message, data));
    }
  },

  error(context: string, message: string, data?: unknown): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', context, message, data));
    }
  },
};
