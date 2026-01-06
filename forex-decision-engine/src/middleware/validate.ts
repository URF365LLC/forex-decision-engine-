import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { createLogger } from '../services/logger.js';

const logger = createLogger('Validation');

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        logger.warn('Validation failed', { path: req.path, issues });
        res.status(400).json({
          error: 'Validation failed',
          issues,
        });
        return;
      }
      next(error);
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        logger.warn('Query validation failed', { path: req.path, issues });
        res.status(400).json({
          error: 'Invalid query parameters',
          issues,
        });
        return;
      }
      next(error);
    }
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        logger.warn('Params validation failed', { path: req.path, issues });
        res.status(400).json({
          error: 'Invalid path parameters',
          issues,
        });
        return;
      }
      next(error);
    }
  };
}
