import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { audit, verifyChain } from '../audit.js';
import { isUuid } from '../authz.js';
import { HttpError, wrap } from '../errors.js';
import { destroyAllSessions, requireRole } from '../session.js';
import { ROLES, likePattern, oneOf, optionalDate, optionalStr, str, validateEmail, validatePassword } from '../validate.js';

/**
 * One CSV cell. Values a spreadsheet would run as a formula (=, +, -, @, tab,
 * carriage return at the start) get a leading apostrophe. An attacker controls
 * some audit text (e.g. the filename of a rejected upload), and opening the
 * export must not execute it.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Administrators manage people and watch activity.
// They do NOT get document contents: nothing here reads document_versions.content.
export default function adminRoutes(db) {
  const r = Router();
  r.use(requireRole('admin'));

  r.get('/users', wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at,
              (SELECT count(*)::int FROM documents d WHERE d.owner_id = u.id AND d.deleted_at IS NULL) AS documents_owned
         FROM users u ORDER BY u.created_at`);
    res.json({ users: rows });
  }));

  r.post('/users', wrap(async (req, res) => {
    const email = validateEmail(req.body?.email);
    const name = str(req.body?.name, 'name', { max: 100 });
    const role = oneOf(req.body?.role, 'role', ROLES);
    const password = validatePassword(req.body?.password);
    const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rows[0]) throw new HttpError(409, 'A user with that email already exists.');
    const { rows } = await db.query(
      'INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, is_active',
      [email, name, role, await bcrypt.hash(password, 12)]);
    await audit(db, req, { action: 'user.create', targetUserId: rows[0].id, details: { email, role } });
    res.status(201).json({ user: rows[0] });
  }));

  r.patch('/users/:id', wrap(async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) throw new HttpError(404, 'User not found.');
    if (id === req.user.id) throw new HttpError(400, 'You cannot change your own role or status.');
    const before = (await db.query('SELECT role, is_active FROM users WHERE id = $1', [id])).rows[0];
    if (!before) throw new HttpError(404, 'User not found.');

    const role = req.body?.role === undefined ? before.role : oneOf(req.body.role, 'role', ROLES);
    let isActive = before.is_active;
    if (req.body?.isActive !== undefined) {
      if (typeof req.body.isActive !== 'boolean') throw new HttpError(400, 'isActive must be true or false.');
      isActive = req.body.isActive;
    }
    await db.query('UPDATE users SET role = $2, is_active = $3 WHERE id = $1', [id, role, isActive]);
    // Leaving the company: every session that person holds dies right now.
    if (!isActive) await destroyAllSessions(db, id);
    await audit(db, req, { action: 'user.update', targetUserId: id, details: { before, after: { role, is_active: isActive } } });
    res.json({ ok: true });
  }));

  // Audit search. Filters are all optional.
  r.get('/audit', wrap(async (req, res) => {
    const params = [];
    const where = ['true'];
    const action = optionalStr(req.query.action, 'action', { max: 60 });
    const actor = optionalStr(req.query.actor, 'actor', { max: 100 });
    const from = optionalDate(req.query.from, 'from');
    const to = optionalDate(req.query.to, 'to');
    if (action) { params.push(action + '%'); where.push(`a.action LIKE $${params.length}`); }
    if (req.query.outcome) { params.push(oneOf(req.query.outcome, 'outcome', ['allowed', 'denied'])); where.push(`a.outcome = $${params.length}`); }
    if (actor) { params.push(likePattern(actor)); where.push(`a.actor_email ILIKE $${params.length} ESCAPE '\\'`); }
    if (req.query.documentId) {
      if (!isUuid(req.query.documentId)) throw new HttpError(400, 'documentId is not valid.');
      params.push(req.query.documentId); where.push(`a.document_id = $${params.length}`);
    }
    if (from) { params.push(from); where.push(`a.created_at >= $${params.length}::date`); }
    if (to) { params.push(to); where.push(`a.created_at < ($${params.length}::date + 1)`); }

    const { rows } = await db.query(
      `SELECT a.id, a.created_at, a.actor_email, a.action, a.outcome, a.document_id, d.name AS document_name,
              t.email AS target_email, a.ip, a.details, a.hash
         FROM audit_log a
         LEFT JOIN documents d ON d.id = a.document_id
         LEFT JOIN users t ON t.id = a.target_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC LIMIT 300`, params);
    res.json({ entries: rows.map((e) => ({ ...e, id: String(e.id) })) });
  }));

  r.get('/audit/verify', wrap(async (req, res) => {
    const result = await verifyChain(db);
    await audit(db, req, { action: 'audit.verify', details: { ok: result.ok, count: result.count } });
    res.json(result);
  }));

  // Full audit trail as CSV, so it can be kept outside this system. The last
  // row's hash is the chain head: anyone holding an old export can later check
  // that the live chain still contains it (detects rows cut off the end).
  r.get('/audit/export', wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, created_at, actor_email, action, outcome, document_id, target_user_id, ip, details, prev_hash, hash
         FROM audit_log ORDER BY id ASC`);
    const head = rows.length ? rows[rows.length - 1].hash : 'GENESIS';
    await audit(db, req, { action: 'audit.export', details: { rows: rows.length, head } });

    const cols = ['id', 'created_at', 'actor_email', 'action', 'outcome', 'document_id', 'target_user_id', 'ip', 'details', 'prev_hash', 'hash'];
    const lines = [cols.join(',')];
    for (const row of rows) {
      lines.push(cols.map((c) => csvCell(c === 'details' ? JSON.stringify(row[c]) : row[c])).join(','));
    }
    const day = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="trustvault-audit-${day}.csv"`,
      'X-Audit-Chain-Head': head,
      'Cache-Control': 'no-store, private',
    });
    res.send(lines.join('\r\n') + '\r\n');
  }));

  // What is worth noticing: refused attempts, and who is collecting access.
  r.get('/summary', wrap(async (_req, res) => {
    const one = async (sql) => (await db.query(sql)).rows;
    const [counts] = await one(
      `SELECT (SELECT count(*)::int FROM users WHERE is_active) AS active_users,
              (SELECT count(*)::int FROM documents WHERE deleted_at IS NULL) AS documents,
              (SELECT count(*)::int FROM grants) AS grants,
              (SELECT count(*)::int FROM audit_log WHERE outcome = 'denied' AND created_at > now() - interval '24 hours') AS denied_24h,
              (SELECT count(*)::int FROM audit_log WHERE action = 'document.download' AND created_at > now() - interval '24 hours') AS downloads_24h`);
    const topDenied = await one(
      `SELECT actor_email, count(*)::int AS attempts FROM audit_log
        WHERE outcome = 'denied' AND created_at > now() - interval '7 days'
        GROUP BY actor_email ORDER BY attempts DESC LIMIT 5`);
    const recentPermissions = await one(
      `SELECT a.id, a.created_at, a.actor_email, a.action, d.name AS document_name, t.email AS target_email, a.details
         FROM audit_log a LEFT JOIN documents d ON d.id = a.document_id LEFT JOIN users t ON t.id = a.target_user_id
        WHERE a.action LIKE 'permission.%' ORDER BY a.id DESC LIMIT 10`);
    res.json({ counts, topDenied, recentPermissions: recentPermissions.map((e) => ({ ...e, id: String(e.id) })) });
  }));

  return r;
}
