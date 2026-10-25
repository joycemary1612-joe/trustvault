// Sessions are opaque random tokens stored server-side (only their hash).
// Because every request looks the session AND the user up in the database,
// deactivating a user or deleting their sessions takes effect on the next request.
import crypto from 'node:crypto';
import { HttpError } from './errors.js';

export const COOKIE_NAME = 'tv_session';
const SESSION_HOURS = 8;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expires.toISOString()]);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,                                  // not readable from JavaScript
    secure: process.env.NODE_ENV === 'production',   // HTTPS only when deployed
    sameSite: 'strict',                              // not sent on cross-site requests
    expires,
    path: '/',
  });
}

export async function destroySession(db, req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function destroyAllSessions(db, userId) {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/** Middleware: attaches req.user if the cookie maps to a live session of an active user. */
export function loadSession(db) {
  return async (req, _res, next) => {
    try {
      const token = req.cookies?.[COOKIE_NAME];
      if (typeof token === 'string' && token.length > 0 && token.length < 200) {
        const { rows } = await db.query(
          `SELECT u.id, u.email, u.name, u.role
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
          [hashToken(token)],
        );
        if (rows[0]) req.user = rows[0];
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Your role does not allow this.'));
  next();
};

/**
 * CSRF defence for state-changing requests: the browser only sends our
 * custom header from our own origin (cross-site it would need a CORS
 * preflight we never approve). SameSite=strict cookies are the second layer.
 */
export function requireCsrfHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'TrustVault') {
    return next(new HttpError(403, 'Missing request header.'));
  }
  next();
}
