/**
 * Simple Logger Service
 * Structured logging with levels and timestamps
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
declare class Logger {
    private minLevel;
    private context;
    constructor(context?: string);
    private shouldLog;
    private formatMessage;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    child(context: string): Logger;
}
export declare const logger: Logger;
export declare function createLogger(context: string): Logger;
export {};
