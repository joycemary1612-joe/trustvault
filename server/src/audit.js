// Audit trail: every important action, allowed or refused, is written here.
//
// Tamper protection, in layers:
//  1. A database trigger rejects UPDATE, DELETE and TRUNCATE on audit_log.
//  2. Each row stores hash = HMAC(key, prev_hash + payload). Changing, removing
//     or reordering any row breaks every hash after it.
//  3. The HMAC key lives only in the app's environment, not in the database,
//     so someone with database access alone cannot rebuild a valid chain.
import crypto from 'node:crypto';

const GENESIS = 'GENESIS';

function hmacKey() {
  const key = process.env.AUDIT_HMAC_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUDIT_HMAC_KEY must be set in production');
  }
  return 'dev-only-audit-key-do-not-use-in-production';
}

function sign(prevHash, payload) {
  return crypto.createHmac('sha256', hmacKey()).update(prevHash + '\n' + payload).digest('hex');
}

/**
 * Append one audit event. Never throws away the caller's error: if writing
 * the audit row fails, the request fails too, so nothing happens unrecorded.
 */
export async function audit(db, req, event) {
  const user = req?.user;
  const entry = {
    at: new Date().toISOString(),
    actor_id: event.actorId ?? user?.id ?? null,
    actor_email: event.actorEmail ?? user?.email ?? null,
    action: event.action,
    outcome: event.outcome ?? 'allowed',
    document_id: event.documentId ?? null,
    target_user_id: event.targetUserId ?? null,
    ip: req?.clientIp ?? req?.ip ?? null,
    details: event.details ?? {},
  };
  const payload = JSON.stringify(entry);

  await db.tx(async (t) => {
    // Serialise writers so two requests cannot both chain onto the same row.
    await t.query('LOCK TABLE audit_log IN SHARE ROW EXCLUSIVE MODE');
    const last = await t.query('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const prevHash = last.rows[0]?.hash ?? GENESIS;
    await t.query(
      `INSERT INTO audit_log (created_at, actor_id, actor_email, action, outcome,
         document_id, target_user_id, ip, details, payload, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [entry.at, entry.actor_id, entry.actor_email, entry.action, entry.outcome,
        entry.document_id, entry.target_user_id, entry.ip, JSON.stringify(entry.details),
        payload, prevHash, sign(prevHash, payload)],
    );
  });
}

/**
 * Walk the whole chain and report the first row that does not check out.
 * Also confirms the queryable columns still match the signed payload.
 */
export async function verifyChain(db) {
  const { rows } = await db.query(
    `SELECT id, actor_id, action, outcome, document_id, target_user_id, payload, prev_hash, hash
       FROM audit_log ORDER BY id ASC`,
  );
  let prev = GENESIS;
  for (const row of rows) {
    const id = String(row.id);
    if (row.prev_hash !== prev) return { ok: false, count: rows.length, brokenAt: id, reason: 'prev_hash does not match previous row' };
    if (sign(prev, row.payload) !== row.hash) return { ok: false, count: rows.length, brokenAt: id, reason: 'hash does not match payload' };
    let p;
    try { p = JSON.parse(row.payload); } catch { return { ok: false, count: rows.length, brokenAt: id, reason: 'payload is not valid JSON' }; }
    if (p.action !== row.action || p.outcome !== row.outcome || p.actor_id !== row.actor_id
      || p.document_id !== row.document_id || p.target_user_id !== row.target_user_id) {
      return { ok: false, count: rows.length, brokenAt: id, reason: 'columns differ from signed payload' };
    }
    prev = row.hash;
  }
  return { ok: true, count: rows.length, head: prev };
}
