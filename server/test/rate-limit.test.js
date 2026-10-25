import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';

test('T-36 password spraying from one IP is throttled even with different emails', async () => {
  process.env.LOGIN_IP_RATE_LIMIT = '5';
  process.env.LOGIN_RATE_LIMIT = '1000';
  const app = createApp(await createDb(''));
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const res = await request(app).post('/api/auth/login').set('X-Requested-With', 'TrustVault')
      .send({ email: `user${i}@trustvault.test`, password: 'Password123' });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.deepEqual(statuses.slice(5), [429, 429]);
});

test('T-37 repeated guesses against one account are throttled', async () => {
  process.env.LOGIN_IP_RATE_LIMIT = '1000';
  process.env.LOGIN_RATE_LIMIT = '3';
  const app = createApp(await createDb(''));
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await request(app).post('/api/auth/login').set('X-Requested-With', 'TrustVault')
      .send({ email: 'olivia@trustvault.test', password: `guess${i}` });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
});

test('T-38 audit records the real client IP from the trusted header, and ignores it when not configured', async () => {
  process.env.LOGIN_IP_RATE_LIMIT = '1000';
  process.env.LOGIN_RATE_LIMIT = '1000';
  const lastIp = async (db) => (await db.query(`SELECT ip FROM audit_log ORDER BY id DESC LIMIT 1`)).rows[0].ip;
  const tryLogin = (app) => request(app).post('/api/auth/login').set('X-Requested-With', 'TrustVault')
    .set('CF-Connecting-IP', '203.0.113.7').send({ email: 'nobody@trustvault.test', password: 'Password123' });

  process.env.CLIENT_IP_HEADER = 'cf-connecting-ip';
  const db1 = await createDb('');
  await tryLogin(createApp(db1));
  assert.equal(await lastIp(db1), '203.0.113.7');

  delete process.env.CLIENT_IP_HEADER; // e.g. local run: nobody may set their own IP
  const db2 = await createDb('');
  await tryLogin(createApp(db2));
  assert.notEqual(await lastIp(db2), '203.0.113.7');
});
