/**
 * Simple Logger Service
 * Structured logging with levels and timestamps
 */
const LOG_COLORS = {
    debug: '\x1b[36m', // Cyan
    info: '\x1b[32m', // Green
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
    reset: '\x1b[0m',
};
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
class Logger {
    minLevel;
    context;
    constructor(context = 'App') {
        this.context = context;
        this.minLevel = process.env.LOG_LEVEL || 'info';
    }
    shouldLog(level) {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
    }
    formatMessage(level, message, data) {
        const timestamp = new Date().toISOString();
        const color = LOG_COLORS[level];
        const reset = LOG_COLORS.reset;
        const levelUpper = level.toUpperCase().padEnd(5);
        let output = `${color}[${timestamp}] [${levelUpper}] [${this.context}]${reset} ${message}`;
        if (data !== undefined) {
            output += ` ${JSON.stringify(data)}`;
        }
        return output;
    }
    debug(message, data) {
        if (this.shouldLog('debug')) {
            console.log(this.formatMessage('debug', message, data));
        }
    }
    info(message, data) {
        if (this.shouldLog('info')) {
            console.log(this.formatMessage('info', message, data));
        }
    }
    warn(message, data) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, data));
        }
    }
    error(message, data) {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error', message, data));
        }
    }
    child(context) {
        return new Logger(`${this.context}:${context}`);
    }
}
// Export singleton for general use
export const logger = new Logger();
// Export class for creating contextual loggers
export function createLogger(context) {
    return new Logger(context);
}
//# sourceMappingURL=logger.js.map