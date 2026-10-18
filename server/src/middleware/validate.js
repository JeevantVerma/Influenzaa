import mongoose from 'mongoose';
import { z } from 'zod';
import { validationError, notFound } from '../lib/errors.js';

function formatIssues(error) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Validates and replaces req.body / req.query with the parsed Zod output. */
export function validate({ body, query, params }) {
  return (req, _res, next) => {
    try {
      if (params) {
        const r = params.safeParse(req.params);
        if (!r.success) return next(validationError(formatIssues(r.error)));
        req.params = r.data;
      }
      if (query) {
        const r = query.safeParse(req.query);
        if (!r.success) return next(validationError(formatIssues(r.error)));
        req.validatedQuery = r.data;
      }
      if (body) {
        const r = body.safeParse(req.body ?? {});
        if (!r.success) return next(validationError(formatIssues(r.error)));
        req.body = r.data;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const objectIdString = z.string().refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), 'Invalid id');

/** Route param guard: 404 for malformed ids rather than a cast error. */
export function idParam(name = 'id') {
  return (req, _res, next) => {
    const v = req.params[name];
    if (!/^[a-f0-9]{24}$/i.test(v || '')) return next(notFound());
    next();
  };
}

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
