import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { audit } from '../audit.js';
import { authorizeDocument, isUuid } from '../authz.js';
import { HttpError, wrap } from '../errors.js';
import { inspectUpload, setDownloadHeaders, MAX_FILE_BYTES } from '../files.js';
import { requireAuth, requireRole } from '../session.js';
import { CATEGORIES, PERMISSIONS, likePattern, oneOf, optionalDate, optionalStr, str } from '../validate.js';

// Files are held in memory only long enough to validate and store them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10 },
}).single('file');

function receiveFile(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') return reject(new HttpError(413, 'The file is larger than 5 MB.'));
      reject(new HttpError(400, 'Upload could not be read.'));
    });
  });
}

const docInfo = async (db, id) =>
  (await db.query('SELECT name, owner_id FROM documents WHERE id = $1', [id])).rows[0];

export default function documentRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  // ---- Search / list. Only ever returns documents the caller can read. ----
  r.get('/', wrap(async (req, res) => {
    const scope = req.query.scope ?? 'all';
    oneOf(scope, 'scope', ['all', 'mine', 'shared', 'trash']);
    const q = optionalStr(req.query.q, 'q', { max: 100 });
    const owner = optionalStr(req.query.owner, 'owner', { max: 100 });
    const category = req.query.category ? oneOf(req.query.category, 'category', CATEGORIES) : undefined;
    const from = optionalDate(req.query.from, 'from');
    const to = optionalDate(req.query.to, 'to');

    const params = [req.user.id];
    const where = [];
    // The access rule comes first and is never optional.
    if (scope === 'all') where.push('d.deleted_at IS NULL AND (d.owner_id = $1 OR g.user_id IS NOT NULL)');
    if (scope === 'mine') where.push('d.deleted_at IS NULL AND d.owner_id = $1');
    if (scope === 'shared') where.push('d.deleted_at IS NULL AND g.user_id IS NOT NULL');
    if (scope === 'trash') where.push('d.deleted_at IS NOT NULL AND d.owner_id = $1');

    if (q) { params.push(likePattern(q)); where.push(`d.name ILIKE $${params.length} ESCAPE '\\'`); }
    if (owner) { params.push(likePattern(owner)); where.push(`(u.name ILIKE $${params.length} ESCAPE '\\' OR u.email ILIKE $${params.length} ESCAPE '\\')`); }
    if (category) { params.push(category); where.push(`d.category = $${params.length}`); }
    if (from) { params.push(from); where.push(`d.created_at >= $${params.length}::date`); }
    if (to) { params.push(to); where.push(`d.created_at < ($${params.length}::date + 1)`); }

    const { rows } = await db.query(
      `SELECT d.id, d.name, d.category, d.description, d.created_at, d.updated_at, d.deleted_at,
              d.current_version, u.name AS owner_name, u.email AS owner_email,
              CASE WHEN d.owner_id = $1 THEN 'owner' ELSE g.permission END AS access,
              v.size_bytes, v.original_filename
         FROM documents d
         JOIN users u ON u.id = d.owner_id
         LEFT JOIN grants g ON g.document_id = d.id AND g.user_id = $1
         LEFT JOIN document_versions v ON v.document_id = d.id AND v.version_no = d.current_version
        WHERE ${where.join(' AND ')}
        ORDER BY d.updated_at DESC
        LIMIT 200`,
      params,
    );
    res.json({ documents: rows });
  }));

  // ---- Upload a new document. Only the owner role creates documents. ----
  r.post('/', requireRole('owner'), wrap(async (req, res) => {
    await receiveFile(req, res);
    let file;
    try {
      file = inspectUpload(req.file);
    } catch (err) {
      await audit(db, req, { action: 'document.upload', outcome: 'denied', details: { reason: err.message, filename: req.file?.originalname?.slice(0, 120) } });
      throw err;
    }
    const name = optionalStr(req.body?.name, 'name', { max: 150 }) ?? path.parse(file.filename).name;
    const category = oneOf(req.body?.category ?? 'Other', 'category', CATEGORIES);
    const description = optionalStr(req.body?.description, 'description', { max: 1000 }) ?? '';

    const doc = await db.tx(async (t) => {
      const d = (await t.query(
        `INSERT INTO documents (name, category, description, owner_id) VALUES ($1,$2,$3,$4)
         RETURNING id, name, category, created_at`, [name, category, description, req.user.id])).rows[0];
      await t.query(
        `INSERT INTO document_versions (document_id, version_no, original_filename, mime_type, size_bytes, sha256, content, uploaded_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
        [d.id, file.filename, file.mime, file.size, file.sha256, file.content, req.user.id]);
      return d;
    });
    await audit(db, req, { action: 'document.upload', documentId: doc.id, details: { name, filename: file.filename, size: file.size, sha256: file.sha256 } });
    res.status(201).json({ document: doc });
  }));

  // ---- One document's details. ----
  r.get('/:id', wrap(async (req, res) => {
    const level = await authorizeDocument(db, req, req.params.id, 'read');
    const { rows } = await db.query(
      `SELECT d.id, d.name, d.category, d.description, d.created_at, d.updated_at, d.current_version,
              u.name AS owner_name, u.email AS owner_email
         FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = $1`, [req.params.id]);
    const versions = (await db.query(
      `SELECT v.version_no, v.original_filename, v.size_bytes, v.sha256, v.created_at, u.name AS uploaded_by
         FROM document_versions v JOIN users u ON u.id = v.uploaded_by
        WHERE v.document_id = $1 ORDER BY v.version_no DESC`, [req.params.id])).rows;
    await audit(db, req, { action: 'document.view', documentId: req.params.id });
    res.json({ document: { ...rows[0], access: level }, versions });
  }));

  // ---- Download. The authorisation decision for file bytes is made here. ----
  r.get('/:id/download', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'read');
    const version = req.query.version === undefined ? null : Number(req.query.version);
    if (version !== null && (!Number.isInteger(version) || version < 1)) throw new HttpError(400, 'version must be a positive whole number.');

    const { rows } = await db.query(
      `SELECT v.version_no, v.original_filename, v.mime_type, v.size_bytes, v.content
         FROM document_versions v JOIN documents d ON d.id = v.document_id
        WHERE v.document_id = $1 AND v.version_no = COALESCE($2, d.current_version)`,
      [req.params.id, version]);
    const v = rows[0];
    if (!v) throw new HttpError(404, 'That version does not exist.');

    await audit(db, req, { action: 'document.download', documentId: req.params.id, details: { version: v.version_no, filename: v.original_filename } });
    setDownloadHeaders(res, { filename: v.original_filename, mime: v.mime_type, size: v.size_bytes });
    res.end(Buffer.from(v.content));
  }));

  // ---- Edit metadata (editors and owner). ----
  r.patch('/:id', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'edit');
    const changes = {};
    const name = optionalStr(req.body?.name, 'name', { max: 150 });
    if (name) changes.name = name;
    if (req.body?.category !== undefined) changes.category = oneOf(req.body.category, 'category', CATEGORIES);
    if (req.body?.description !== undefined) changes.description = optionalStr(req.body.description, 'description', { max: 1000 }) ?? '';
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'Nothing to change.');

    const before = (await db.query('SELECT name, category, description FROM documents WHERE id = $1', [req.params.id])).rows[0];
    // Column names come from our own fixed list above, never from the request.
    const sets = Object.keys(changes).map((k, i) => `${k} = $${i + 2}`);
    await db.query(`UPDATE documents SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
      [req.params.id, ...Object.values(changes)]);
    await audit(db, req, { action: 'document.update', documentId: req.params.id, details: { before, after: changes } });
    res.json({ ok: true });
  }));

  // ---- Upload a new version (editors and owner). ----
  r.post('/:id/versions', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'edit');
    await receiveFile(req, res);
    let file;
    try {
      file = inspectUpload(req.file);
    } catch (err) {
      await audit(db, req, { action: 'document.new_version', outcome: 'denied', documentId: req.params.id, details: { reason: err.message } });
      throw err;
    }
    const versionNo = await db.tx(async (t) => {
      const d = (await t.query('SELECT current_version FROM documents WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      const next = d.current_version + 1;
      await t.query(
        `INSERT INTO document_versions (document_id, version_no, original_filename, mime_type, size_bytes, sha256, content, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.params.id, next, file.filename, file.mime, file.size, file.sha256, file.content, req.user.id]);
      await t.query('UPDATE documents SET current_version = $2, updated_at = now() WHERE id = $1', [req.params.id, next]);
      return next;
    });
    await audit(db, req, { action: 'document.new_version', documentId: req.params.id, details: { version: versionNo, filename: file.filename, size: file.size, sha256: file.sha256 } });
    res.status(201).json({ version: versionNo });
  }));

  // ---- Delete (soft: moves to the owner's trash) and restore. Owner only. ----
  r.delete('/:id', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'manage');
    await db.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [req.params.id]);
    await audit(db, req, { action: 'document.delete', documentId: req.params.id, details: { name: (await docInfo(db, req.params.id)).name } });
    res.json({ ok: true });
  }));

  r.post('/:id/restore', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'manage', { includeDeleted: true });
    await db.query('UPDATE documents SET deleted_at = NULL, updated_at = now() WHERE id = $1', [req.params.id]);
    await audit(db, req, { action: 'document.restore', documentId: req.params.id });
    res.json({ ok: true });
  }));

  // ---- Sharing. Only the owner can see or change who has access. ----
  r.get('/:id/grants', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'manage');
    const { rows } = await db.query(
      `SELECT g.user_id, u.name, u.email, u.role, u.is_active, g.permission, g.created_at
         FROM grants g JOIN users u ON u.id = g.user_id
        WHERE g.document_id = $1 ORDER BY u.name`, [req.params.id]);
    res.json({ grants: rows });
  }));

  r.put('/:id/grants/:userId', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'manage');
    const permission = oneOf(req.body?.permission, 'permission', PERMISSIONS);
    const { userId } = req.params;
    if (!isUuid(userId)) throw new HttpError(404, 'User not found.');
    if (userId === req.user.id) throw new HttpError(400, 'You already own this document.');
    const target = (await db.query('SELECT id, is_active FROM users WHERE id = $1', [userId])).rows[0];
    if (!target || !target.is_active) throw new HttpError(404, 'User not found.');

    const previous = (await db.query('SELECT permission FROM grants WHERE document_id = $1 AND user_id = $2',
      [req.params.id, userId])).rows[0]?.permission ?? null;
    await db.query(
      `INSERT INTO grants (document_id, user_id, permission, granted_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (document_id, user_id) DO UPDATE SET permission = EXCLUDED.permission,
         granted_by = EXCLUDED.granted_by, created_at = now()`,
      [req.params.id, userId, permission, req.user.id]);
    await audit(db, req, { action: 'permission.grant', documentId: req.params.id, targetUserId: userId, details: { permission, previous } });
    res.json({ ok: true });
  }));

  r.delete('/:id/grants/:userId', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'manage');
    const { userId } = req.params;
    if (!isUuid(userId)) throw new HttpError(404, 'Grant not found.');
    const { rows } = await db.query('DELETE FROM grants WHERE document_id = $1 AND user_id = $2 RETURNING permission',
      [req.params.id, userId]);
    if (!rows[0]) throw new HttpError(404, 'Grant not found.');
    // No caches or tokens exist, so the very next request from that user is refused.
    await audit(db, req, { action: 'permission.revoke', documentId: req.params.id, targetUserId: userId, details: { previous: rows[0].permission } });
    res.json({ ok: true });
  }));

  // ---- The document's own audit history, for its owner. ----
  r.get('/:id/activity', wrap(async (req, res) => {
    await authorizeDocument(db, req, req.params.id, 'manage');
    const { rows } = await db.query(
      `SELECT a.id, a.created_at, a.actor_email, a.action, a.outcome, a.details, t.email AS target_email
         FROM audit_log a LEFT JOIN users t ON t.id = a.target_user_id
        WHERE a.document_id = $1 ORDER BY a.id DESC LIMIT 200`, [req.params.id]);
    res.json({ activity: rows.map((r) => ({ ...r, id: String(r.id) })) });
  }));

  return r;
}
