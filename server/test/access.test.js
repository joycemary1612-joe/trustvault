// Requirement 10: one user cannot reach another user's documents, through any route.
// Each test names the THREATS.md entry (T-xx) it proves.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let ctx, salary, drawings, board;
before(async () => {
  ctx = await setup();
  salary = await ctx.docId('Salary letter - Vera');      // olivia owns, vera has read
  drawings = await ctx.docId('Bridge drawings rev B');   // omar owns, nobody else
  board = await ctx.docId('Q3 board pack');              // olivia owns, omar has edit
});

test('T-01 anonymous requests are refused everywhere', async () => {
  const a = ctx.anon();
  assert.equal((await a.get('/api/documents')).status, 401);
  assert.equal((await a.get(`/api/documents/${salary}`)).status, 401);
  assert.equal((await a.get(`/api/documents/${salary}/download`)).status, 401);
  assert.equal((await a.get('/api/admin/audit')).status, 401);
});

test('T-02 a user with no grant gets 404 on every document route (IDOR)', async () => {
  const victor = await ctx.login('victor');
  const victorId = await ctx.userId('victor');
  const routes = [
    () => victor.get(`/api/documents/${drawings}`),
    () => victor.get(`/api/documents/${drawings}/download`),
    () => victor.get(`/api/documents/${drawings}/download?version=1`),
    () => victor.patch(`/api/documents/${drawings}`).send({ name: 'pwned' }),
    () => victor.post(`/api/documents/${drawings}/versions`).attach('file', Buffer.from('x'), 'x.txt'),
    () => victor.delete(`/api/documents/${drawings}`),
    () => victor.post(`/api/documents/${drawings}/restore`),
    () => victor.get(`/api/documents/${drawings}/grants`),
    () => victor.put(`/api/documents/${drawings}/grants/${victorId}`).send({ permission: 'edit' }),
    () => victor.get(`/api/documents/${drawings}/activity`),
  ];
  for (const call of routes) {
    const res = await call();
    assert.equal(res.status, 404, `${res.req.method} ${res.req.path} returned ${res.status}`);
  }
  const doc = await ctx.db.query('SELECT name, deleted_at FROM documents WHERE id = $1', [drawings]);
  assert.equal(doc.rows[0].name, 'Bridge drawings rev B');
  assert.equal(doc.rows[0].deleted_at, null);
});

test('T-03 another owner cannot reach a document they do not own', async () => {
  const omar = await ctx.login('omar');
  assert.equal((await omar.get(`/api/documents/${salary}/download`)).status, 404);
  assert.equal((await omar.delete(`/api/documents/${salary}`)).status, 404);
});

test('T-04 search and listing never return documents you cannot read', async () => {
  const victor = await ctx.login('victor');
  for (const q of ['', 'Salary', '%', '_', 'Bridge']) {
    const res = await victor.get(`/api/documents?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200);
    for (const d of res.body.documents) assert.equal(d.name, 'Client contract - Acme');
  }
  const byOwner = await victor.get('/api/documents?owner=olivia');
  assert.equal(byOwner.body.documents.length, 0);
  const trash = await victor.get('/api/documents?scope=trash');
  assert.equal(trash.body.documents.length, 0);
});

test('T-05 read access allows download but not edit, share or delete', async () => {
  const vera = await ctx.login('vera');
  const dl = await vera.get(`/api/documents/${salary}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers['content-disposition'], /^attachment/);
  assert.equal((await vera.patch(`/api/documents/${salary}`).send({ name: 'changed' })).status, 403);
  assert.equal((await vera.post(`/api/documents/${salary}/versions`).attach('file', Buffer.from('new'), 'a.txt')).status, 403);
  assert.equal((await vera.delete(`/api/documents/${salary}`)).status, 403);
  assert.equal((await vera.get(`/api/documents/${salary}/grants`)).status, 403);
  assert.equal((await vera.put(`/api/documents/${salary}/grants/${await ctx.userId('victor')}`).send({ permission: 'read' })).status, 403);
});

test('T-06 edit access allows changes but cannot widen access or delete', async () => {
  const omar = await ctx.login('omar');
  assert.equal((await omar.patch(`/api/documents/${board}`).send({ description: 'updated by editor' })).status, 200);
  const v = await omar.post(`/api/documents/${board}/versions`).attach('file', Buffer.from('v2 content'), 'board-v2.txt');
  assert.equal(v.status, 201);
  assert.equal((await omar.put(`/api/documents/${board}/grants/${await ctx.userId('victor')}`).send({ permission: 'read' })).status, 403);
  assert.equal((await omar.delete(`/api/documents/${board}/grants/${await ctx.userId('omar')}`)).status, 403);
  assert.equal((await omar.delete(`/api/documents/${board}`)).status, 403);
});

test('T-07 revoking access works on the very next request of an existing session', async () => {
  const olivia = await ctx.login('olivia');
  const victor = await ctx.login('victor');
  const victorId = await ctx.userId('victor');
  assert.equal((await olivia.put(`/api/documents/${salary}/grants/${victorId}`).send({ permission: 'read' })).status, 200);
  assert.equal((await victor.get(`/api/documents/${salary}/download`)).status, 200);
  assert.equal((await olivia.delete(`/api/documents/${salary}/grants/${victorId}`)).status, 200);
  assert.equal((await victor.get(`/api/documents/${salary}/download`)).status, 404);
  assert.equal((await victor.get(`/api/documents/${salary}`)).status, 404);
});

test('T-08 a deactivated user is locked out immediately, sessions included', async () => {
  const admin = await ctx.login('admin');
  const vera = await ctx.login('vera');
  assert.equal((await vera.get('/api/documents')).status, 200);
  const veraId = await ctx.userId('vera');
  assert.equal((await admin.patch(`/api/admin/users/${veraId}`).send({ isActive: false })).status, 200);
  assert.equal((await vera.get(`/api/documents/${salary}/download`)).status, 401);
  const relogin = await ctx.anon().post('/api/auth/login').send({ email: 'vera@trustvault.test', password: 'VeraVault2026' });
  assert.equal(relogin.status, 401);
  await admin.patch(`/api/admin/users/${veraId}`).send({ isActive: true });
});

test('T-08b the session check itself refuses inactive users, even if a session row survived', async () => {
  const vera = await ctx.login('vera');
  const veraId = await ctx.userId('vera');
  // Deactivate directly, without the route that also deletes sessions.
  await ctx.db.query('UPDATE users SET is_active = false WHERE id = $1', [veraId]);
  assert.equal((await vera.get(`/api/documents/${salary}/download`)).status, 401);
  await ctx.db.query('UPDATE users SET is_active = true WHERE id = $1', [veraId]);
});

test('T-09 admins manage users but cannot open documents nobody shared with them', async () => {
  const admin = await ctx.login('admin');
  assert.equal((await admin.get(`/api/documents/${drawings}`)).status, 404);
  assert.equal((await admin.get(`/api/documents/${drawings}/download`)).status, 404);
  assert.equal((await admin.get('/api/documents')).body.documents.length, 0);
});

test('T-10 non-admins cannot reach admin routes or change roles', async () => {
  const olivia = await ctx.login('olivia');
  const oliviaId = await ctx.userId('olivia');
  assert.equal((await olivia.get('/api/admin/audit')).status, 403);
  assert.equal((await olivia.get('/api/admin/users')).status, 403);
  assert.equal((await olivia.patch(`/api/admin/users/${oliviaId}`).send({ role: 'admin' })).status, 403);
  const { rows } = await ctx.db.query('SELECT role FROM users WHERE id = $1', [oliviaId]);
  assert.equal(rows[0].role, 'owner');
});

test('T-11 viewers cannot upload and cannot list the user directory', async () => {
  const vera = await ctx.login('vera');
  const up = await vera.post('/api/documents').field('category', 'HR').attach('file', Buffer.from('hello'), 'a.txt');
  assert.equal(up.status, 403);
  assert.equal((await vera.get('/api/users/directory')).status, 403);
});

test('T-12 deleted documents are unreachable for grantees, restorable by the owner only', async () => {
  const olivia = await ctx.login('olivia');
  const vera = await ctx.login('vera');
  assert.equal((await olivia.delete(`/api/documents/${salary}`)).status, 200);
  assert.equal((await vera.get(`/api/documents/${salary}/download`)).status, 404);
  assert.equal((await vera.post(`/api/documents/${salary}/restore`)).status, 404);
  assert.equal((await olivia.post(`/api/documents/${salary}/restore`)).status, 200);
  assert.equal((await vera.get(`/api/documents/${salary}/download`)).status, 200);
});

test('T-13 a malformed or made-up id gives 404, not an error', async () => {
  const vera = await ctx.login('vera');
  for (const id of ['1', "' OR 1=1 --", '00000000-0000-0000-0000-000000000000', '../admin']) {
    const res = await vera.get(`/api/documents/${encodeURIComponent(id)}/download`);
    assert.equal(res.status, 404, id);
  }
});

test('T-14 cannot grant access to yourself, unknown users or deactivated users', async () => {
  const olivia = await ctx.login('olivia');
  const admin = await ctx.login('admin');
  assert.equal((await olivia.put(`/api/documents/${salary}/grants/${await ctx.userId('olivia')}`).send({ permission: 'read' })).status, 400);
  assert.equal((await olivia.put(`/api/documents/${salary}/grants/00000000-0000-0000-0000-000000000000`).send({ permission: 'read' })).status, 404);
  assert.equal((await olivia.put(`/api/documents/${salary}/grants/${await ctx.userId('victor')}`).send({ permission: 'owner' })).status, 400);
  const victorId = await ctx.userId('victor');
  await admin.patch(`/api/admin/users/${victorId}`).send({ isActive: false });
  assert.equal((await olivia.put(`/api/documents/${salary}/grants/${victorId}`).send({ permission: 'read' })).status, 404);
  await admin.patch(`/api/admin/users/${victorId}`).send({ isActive: true });
});
