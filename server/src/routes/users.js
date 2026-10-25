import { Router } from 'express';
import { wrap } from '../errors.js';
import { requireRole } from '../session.js';
import { likePattern, optionalStr } from '../validate.js';

// People an owner can share with. Viewers do not need, and do not get, the directory.
export default function userRoutes(db) {
  const r = Router();
  r.get('/directory', requireRole('owner', 'admin'), wrap(async (req, res) => {
    const q = optionalStr(req.query.q, 'q', { max: 100 });
    const params = [req.user.id];
    let filter = '';
    if (q) { params.push(likePattern(q)); filter = `AND (name ILIKE $2 ESCAPE '\\' OR email ILIKE $2 ESCAPE '\\')`; }
    const { rows } = await db.query(
      `SELECT id, name, email, role FROM users WHERE is_active AND id <> $1 ${filter} ORDER BY name LIMIT 50`, params);
    res.json({ users: rows });
  }));
  return r;
}
