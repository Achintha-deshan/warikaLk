import { Request, Response, NextFunction } from 'express';

// Registered LAST, after every route. Express only reaches this for errors
// that individual handlers didn't already catch themselves — every
// controller in this codebase already wraps its own logic in try/catch, so
// this is a safety net, not the primary error path. Two concrete leaks this
// closes, confirmed by hitting the running server directly before this
// existed: a malformed JSON body reached Express's DEFAULT error handler,
// which returned an HTML page containing the full stack trace AND absolute
// filesystem paths (node_modules paths under this machine's real directory
// structure); a connection-pool timeout (see config/db.ts's
// connectionTimeoutMillis) would otherwise surface as a bare, unlabeled 500.
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  // If a response has already started streaming, Express's own fallback is
  // the only safe option at this point — headers/body may be partially sent.
  if (res.headersSent) {
    next(err);
    return;
  }

  console.error('Unhandled error:', err);

  // pg-pool throws this exact message when the pool is exhausted or Neon is
  // unreachable within connectionTimeoutMillis — see config/db.ts.
  if (err instanceof Error && err.message === 'timeout exceeded when trying to connect') {
    res.status(503).json({ error: 'Service temporarily unavailable, please try again' });
    return;
  }

  // express.json() (body-parser) throws a SyntaxError with a `.status` of
  // 400 for a malformed JSON body — a client input problem, not a server
  // error, and the raw SyntaxError message/stack must never reach the client.
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

// Catches any request that didn't match a route at all — previously fell
// through to Express's default handler, which returns an HTML
// "Cannot GET /..." page rather than the JSON { error: "..." } shape every
// other endpoint in this API uses.
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}
