import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

/**
 * The route a request came in on, for code deep in a service that needs to
 * say where something happened without being handed the request (sprint 5:
 * the engagement guard's shadow refusals). IDs are replaced, so nothing here
 * carries a record's identity or any request content.
 */

const store = new AsyncLocalStorage<{ route: string }>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "GET /api/projects/:id/plan" from "GET /api/projects/5f0c…/plan?x=1". */
export function routeOf(method: string, url: string): string {
  const path = String(url || '').split('?')[0].split('/')
    .map((seg) => (UUID.test(seg) ? ':id' : /^\d+$/.test(seg) ? ':n' : seg))
    .join('/');
  return `${String(method || '').toUpperCase()} ${path}`.slice(0, 200);
}

export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  store.run({ route: routeOf(req.method, req.originalUrl) }, next);
}

export const currentRoute = (): string => store.getStore()?.route ?? 'unknown';
