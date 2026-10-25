// THE place where document access is decided. Every document route calls
// authorizeDocument() before touching a document, and nothing else grants access.
//
// Access levels, from the database, on every request (nothing is cached):
//   owner - documents.owner_id is this user
//   edit  - a grants row with permission 'edit'
//   read  - a grants row with permission 'read'
//   null  - no access at all
//
// Roles do NOT give access to documents. An admin manages users and reads the
// audit trail, but cannot open a document unless someone granted it to them.
import { audit } from './audit.js';
import { HttpError } from './errors.js';

// Which access levels allow which action.
const ALLOWED = {
  read: ['owner', 'edit', 'read'],    // view metadata, download
  edit: ['owner', 'edit'],            // rename, recategorise, upload a new version
  manage: ['owner'],                  // share, revoke, delete, restore, view activity
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Returns 'owner' | 'edit' | 'read' | null for this user and document. */
export async function accessLevel(db, user, docId, { includeDeleted = false } = {}) {
  if (!user || !isUuid(docId)) return null;
  const { rows } = await db.query(
    `SELECT d.owner_id, d.deleted_at, g.permission
       FROM documents d
       LEFT JOIN grants g ON g.document_id = d.id AND g.user_id = $2
      WHERE d.id = $1`,
    [docId, user.id],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id === user.id) {
    // Deleted documents are reachable only by their owner, and only for restore.
    return row.deleted_at && !includeDeleted ? null : 'owner';
  }
  if (row.deleted_at) return null;
  return row.permission ?? null;
}

/**
 * Throws unless `user` may perform `action` on the document.
 * - No access at all -> 404, so outsiders cannot even confirm a document exists.
 * - Some access but not enough -> 403.
 * Every refusal is written to the audit trail.
 */
export async function authorizeDocument(db, req, docId, action, opts = {}) {
  if (!ALLOWED[action]) throw new Error(`Unknown action ${action}`);
  const level = await accessLevel(db, req.user, docId, opts);
  if (level && ALLOWED[action].includes(level)) return level;

  await audit(db, req, {
    action: `document.${action}`,
    outcome: 'denied',
    documentId: isUuid(docId) ? docId : null,
    details: { reason: level ? `has ${level}, needs ${action}` : 'no access', path: req.originalUrl, method: req.method },
  });
  if (level) throw new HttpError(403, 'You do not have permission to do that.');
  throw new HttpError(404, 'Document not found.');
}

/** SQL fragment: documents this user can read. $1 must be the user id. */
export const READABLE_DOCS_SQL = `
  d.deleted_at IS NULL AND (
    d.owner_id = $1
    OR EXISTS (SELECT 1 FROM grants g WHERE g.document_id = d.id AND g.user_id = $1)
  )`;
