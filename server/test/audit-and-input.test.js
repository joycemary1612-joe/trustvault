import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { verifyChain } from '../src/audit.js';

let ctx, drawings;
before(async () => {
  ctx = await setup();
  drawings = await ctx.docId('Bridge drawings rev B');
});

test('T-20 refused attempts are recorded with who tried', async () => {
  const victor = await ctx.login('victor');
  await victor.get(`/api/documents/${drawings}/download`);
  const { rows } = await ctx.db.query(
    `SELECT actor_email, outcome FROM audit_log WHERE document_id = $1 AND action = 'document.read' ORDER BY id DESC LIMIT 1`, [drawings]);
  assert.deepEqual(rows[0], { actor_email: 'victor@trustvault.test', outcome: 'denied' });
});

test('T-21 failed sign-ins are recorded', async () => {
  await ctx.anon().post('/api/auth/login').send({ email: 'olivia@trustvault.test', password: 'wrong-password' });
  const { rows } = await ctx.db.query(`SELECT outcome, details FROM audit_log WHERE action = 'auth.login' ORDER BY id DESC LIMIT 1`);
  assert.equal(rows[0].outcome, 'denied');
});

test('T-22 downloads and permission changes are recorded', async () => {
  const omar = await ctx.login('omar');
  const victorId = await ctx.userId('victor');
  await omar.get(`/api/documents/${drawings}/download`);
  await omar.put(`/api/documents/${drawings}/grants/${victorId}`).send({ permission: 'read' });
  await omar.delete(`/api/documents/${drawings}/grants/${victorId}`);
  const { rows } = await ctx.db.query(`SELECT action FROM audit_log WHERE document_id = $1 ORDER BY id DESC LIMIT 3`, [drawings]);
  assert.deepEqual(rows.map((r) => r.action), ['permission.revoke', 'permission.grant', 'document.download']);
});

test('T-23 the database refuses to change or delete audit rows', async () => {
  await assert.rejects(ctx.db.query(`UPDATE audit_log SET actor_email = 'someone-else'`), /append-only/);
  await assert.rejects(ctx.db.query('DELETE FROM audit_log'), /append-only/);
  await assert.rejects(ctx.db.query('TRUNCATE audit_log'), /append-only/);
});

test('T-24 the hash chain detects a row edited behind the trigger', async () => {
  assert.equal((await verifyChain(ctx.db)).ok, true);
  const admin = await ctx.login('admin');
  assert.equal((await admin.get('/api/admin/audit/verify')).body.ok, true);

  // Someone with database owner rights disables the trigger and rewrites history.
  await ctx.db.exec('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update');
  await ctx.db.query(`UPDATE audit_log SET actor_email = 'nobody', outcome = 'allowed'
                       WHERE id = (SELECT min(id) FROM audit_log WHERE outcome = 'denied')`);
  await ctx.db.exec('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update');
  const result = await verifyChain(ctx.db);
  assert.equal(result.ok, false);
  assert.match(result.reason, /columns differ/);
});

test('T-30 uploads with a disguised type are rejected', async () => {
  const olivia = await ctx.login('olivia');
  const fakePdf = await olivia.post('/api/documents').field('category', 'HR').attach('file', Buffer.from('<script>alert(1)</script>'), 'evil.pdf');
  assert.equal(fakePdf.status, 400);
  const html = await olivia.post('/api/documents').field('category', 'HR').attach('file', Buffer.from('<html></html>'), 'page.html');
  assert.equal(html.status, 400);
  const exe = await olivia.post('/api/documents').field('category', 'HR').attach('file', Buffer.from('MZ\x90\x00binary\x00'), 'report.txt');
  assert.equal(exe.status, 400);
});

test('T-31 oversized uploads are rejected', async () => {
  const olivia = await ctx.login('olivia');
  const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0x61);
  const res = await olivia.post('/api/documents').field('category', 'HR').attach('file', big, 'big.txt');
  assert.equal(res.status, 413);
});

test('T-32 path tricks in filenames are neutralised', async () => {
  const olivia = await ctx.login('olivia');
  const res = await olivia.post('/api/documents').field('category', 'Other').attach('file', Buffer.from('ok'), '../../etc/passwd.txt');
  assert.equal(res.status, 201);
  const { rows } = await ctx.db.query('SELECT original_filename FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.id = $1', [res.body.document.id]);
  assert.equal(rows[0].original_filename, 'passwd.txt');
});

test('T-33 state-changing requests without the CSRF header are refused', async () => {
  const olivia = await ctx.login('olivia');
  const res = await olivia.raw.delete(`/api/documents/${await ctx.docId('Q3 board pack')}`);
  assert.equal(res.status, 403);
});

test('T-34 wrong email and wrong password give the same answer', async () => {
  const a = await ctx.anon().post('/api/auth/login').send({ email: 'nobody@trustvault.test', password: 'x' });
  const b = await ctx.anon().post('/api/auth/login').send({ email: 'olivia@trustvault.test', password: 'x' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error, b.body.error);
});

test('T-35 logout kills the session on the server, not just the cookie', async () => {
  const vera = await ctx.login('vera');
  const cookie = (await vera.get('/api/auth/me')).req.getHeader('cookie');
  await vera.post('/api/auth/logout');
  const replay = await ctx.anon().raw.get('/api/auth/me').set('Cookie', cookie);
  assert.equal(replay.status, 401);
});
