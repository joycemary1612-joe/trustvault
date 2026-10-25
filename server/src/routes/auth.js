import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { audit } from '../audit.js';
import { HttpError, wrap } from '../errors.js';
import { createSession, destroySession, destroyAllSessions, requireAuth } from '../session.js';
import { str, validatePassword } from '../validate.js';

// Used when the email is unknown, so a wrong email and a wrong password
// take the same time and give the same answer (no account enumeration).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export default function authRoutes(db) {
  const r = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.clientIp)}|${String(req.body?.email ?? '').toLowerCase()}`,
    validate: { keyGeneratorIpFallback: false },
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });

  // Second limit per IP alone, so trying many different emails from one
  // address (password spraying) is slowed down too.
  const ipLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_IP_RATE_LIMIT || 50),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.clientIp),
    validate: { keyGeneratorIpFallback: false },
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });

  r.post('/login', ipLimiter, loginLimiter, wrap(async (req, res) => {
    const email = str(req.body?.email, 'email', { max: 200 }).toLowerCase();
    const password = str(req.body?.password, 'password', { max: 200, trim: false });

    const { rows } = await db.query(
      'SELECT id, email, name, role, password_hash, is_active FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !ok || !user.is_active) {
      await audit(db, req, {
        action: 'auth.login', outcome: 'denied', actorId: user?.id ?? null, actorEmail: email,
        details: { reason: !user ? 'unknown email' : !ok ? 'wrong password' : 'account deactivated' },
      });
      throw new HttpError(401, 'Email or password is incorrect.');
    }

    await createSession(db, res, user.id);
    await audit(db, req, { action: 'auth.login', actorId: user.id, actorEmail: user.email });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  }));

  r.post('/logout', wrap(async (req, res) => {
    if (req.user) await audit(db, req, { action: 'auth.logout' });
    await destroySession(db, req, res);
    res.json({ ok: true });
  }));

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  r.post('/password', requireAuth, wrap(async (req, res) => {
    const current = str(req.body?.currentPassword, 'currentPassword', { max: 200, trim: false });
    const next = validatePassword(req.body?.newPassword);
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(current, rows[0].password_hash))) {
      await audit(db, req, { action: 'auth.password_change', outcome: 'denied', details: { reason: 'wrong current password' } });
      throw new HttpError(400, 'Current password is incorrect.');
    }
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 12), req.user.id]);
    // Log out everywhere else: any stolen session stops working now.
    await destroyAllSessions(db, req.user.id);
    await createSession(db, res, req.user.id);
    await audit(db, req, { action: 'auth.password_change' });
    res.json({ ok: true });
  }));

  return r;
}
