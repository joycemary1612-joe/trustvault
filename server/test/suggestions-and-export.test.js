import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let ctx, olivia, newHrDoc;
before(async () => {
  ctx = await setup();
  olivia = await ctx.login('olivia');
  // A fresh HR document: Olivia already shared another HR document with Vera.
  const up = await olivia.post('/api/documents').field('name', 'Offer letter - new hire').field('category', 'HR')
    .attach('file', Buffer.from('offer letter'), 'offer.txt');
  newHrDoc = up.body.document.id;
});

const grantsOn = async (docId) => (await ctx.db.query('SELECT user_id FROM grants WHERE document_id = $1', [docId])).rows;

test('T-40 suggestions never grant access by themselves', async () => {
  const res = await olivia.get(`/api/documents/${newHrDoc}/suggestions`);
  assert.equal(res.status, 200);
  assert.equal(res.body.suggestions[0].email, 'vera@trustvault.test'); // same category ranks first
  assert.equal(res.body.suggestions[0].permission, 'read');            // least access
  assert.deepEqual(await grantsOn(newHrDoc), []);                       // nothing was shared
  const vera = await ctx.login('vera');
  assert.equal((await vera.get(`/api/documents/${newHrDoc}/download`)).status, 404);
});

test('T-41 the suggestion and the owner\'s decision are both audited', async () => {
  const veraId = await ctx.userId('vera');
  const omarId = await ctx.userId('omar');
  await olivia.get(`/api/documents/${newHrDoc}/suggestions`);
  await olivia.put(`/api/documents/${newHrDoc}/grants/${veraId}`).send({ permission: 'read', viaSuggestion: true });
  await olivia.post(`/api/documents/${newHrDoc}/suggestions/dismiss`).send({ userId: omarId });
  const { rows } = await ctx.db.query(
    `SELECT action, details FROM audit_log WHERE document_id = $1 ORDER BY id DESC LIMIT 3`, [newHrDoc]);
  assert.deepEqual(rows.map((r) => r.action), ['sharing.suggestion_dismissed', 'permission.grant', 'sharing.suggest']);
  assert.equal(rows[1].details.viaSuggestion, true);
});

test('T-42 only the owner can ask for suggestions or dismiss them', async () => {
  const omar = await ctx.login('omar');
  const vera = await ctx.login('vera'); // has read on newHrDoc after T-41
  assert.equal((await omar.get(`/api/documents/${newHrDoc}/suggestions`)).status, 404);
  assert.equal((await vera.get(`/api/documents/${newHrDoc}/suggestions`)).status, 403);
  assert.equal((await vera.post(`/api/documents/${newHrDoc}/suggestions/dismiss`).send({ userId: await ctx.userId('omar') })).status, 403);
});

test('T-43 suggestions do not leak people from other owners\' sharing', async () => {
  // Omar shared his Acme contract with Victor. Olivia must not be told about Victor.
  const res = await olivia.get(`/api/documents/${newHrDoc}/suggestions`);
  assert.ok(!res.body.suggestions.some((s) => s.email === 'victor@trustvault.test'));
});

test('T-44 audit export is admin-only, includes the chain hashes, and defuses spreadsheet formulas', async () => {
  // An attacker-controlled string lands in its own audit column: the email typed on a failed sign-in.
  await ctx.anon().post('/api/auth/login').send({ email: '=HYPERLINK("http://evil.example","x")', password: 'x' });

  assert.equal((await olivia.get('/api/admin/audit/export')).status, 403);
  const admin = await ctx.login('admin');
  const res = await admin.get('/api/admin/audit/export');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /^attachment/);
  assert.match(res.headers['x-audit-chain-head'], /^[0-9a-f]{64}$/);
  const lines = res.text.trim().split('\r\n');
  assert.equal(lines[0], 'id,created_at,actor_email,action,outcome,document_id,target_user_id,ip,details,prev_hash,hash');
  assert.ok(lines.at(-1).endsWith(res.headers['x-audit-chain-head']));
  // The hostile email must be there, but defused with a leading apostrophe.
  const hostile = lines.find((l) => /hyperlink/i.test(l));
  assert.ok(hostile, 'the failed sign-in should be in the export');
  assert.match(hostile, /,"'=hyperlink\(/);
  for (const line of lines) assert.ok(!/(^|,)"?=/.test(line), `formula cell in: ${line}`);
  const { rows } = await ctx.db.query(`SELECT 1 FROM audit_log WHERE action = 'audit.export'`);
  assert.equal(rows.length, 1);
});
