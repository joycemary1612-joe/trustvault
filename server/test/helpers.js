import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { DEMO_USERS, seedIfEmpty } from '../src/seed.js';

export const PW = Object.fromEntries(DEMO_USERS.map((u) => [u.email.split('@')[0], u.password]));

/** Fresh in-memory database + app for each test file. */
export async function setup() {
  process.env.LOGIN_RATE_LIMIT = '1000';
  process.env.LOGIN_IP_RATE_LIMIT = '1000';
  const db = await createDb(''); // '' forces PGlite in memory, even if DATABASE_URL is set
  await seedIfEmpty(db, { rounds: 4 });
  const app = createApp(db);

  /** Returns a supertest agent signed in as the given demo user (keeps the cookie). */
  async function login(who) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').set('X-Requested-With', 'TrustVault')
      .send({ email: `${who}@trustvault.test`, password: PW[who] });
    if (res.status !== 200) throw new Error(`login ${who} failed: ${res.status}`);
    return wrapAgent(agent);
  }

  async function docId(name) {
    return (await db.query('SELECT id FROM documents WHERE name = $1', [name])).rows[0].id;
  }

  async function userId(who) {
    return (await db.query('SELECT id FROM users WHERE email = $1', [`${who}@trustvault.test`])).rows[0].id;
  }

  return { db, app, login, docId, userId, anon: () => wrapAgent(request.agent(app)) };
}

// Adds the CSRF header to every state-changing call, like the real client does.
function wrapAgent(agent) {
  const h = (req) => req.set('X-Requested-With', 'TrustVault');
  return {
    raw: agent,
    get: (u) => agent.get(u),
    post: (u) => h(agent.post(u)),
    put: (u) => h(agent.put(u)),
    patch: (u) => h(agent.patch(u)),
    delete: (u) => h(agent.delete(u)),
  };
}
