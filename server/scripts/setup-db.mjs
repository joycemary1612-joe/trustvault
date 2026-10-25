// Creates the tables (src/schema.sql) and the demo data in the database
// named by DATABASE_URL. The server also does this on start, so this is
// only needed if you want to prepare a database by hand.
// Run: DATABASE_URL=postgresql://... node scripts/setup-db.mjs
import { createDb } from '../src/db.js';
import { seedIfEmpty } from '../src/seed.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL first.');
  process.exit(1);
}
const db = await createDb();
const seeded = await seedIfEmpty(db);
console.log(seeded ? 'Schema created and demo data added.' : 'Schema is up to date; data already present, not seeded.');
await db.close();
