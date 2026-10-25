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
