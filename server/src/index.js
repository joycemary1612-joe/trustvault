import { createApp } from './app.js';
import { createDb } from './db.js';
import { seedIfEmpty } from './seed.js';

const db = await createDb();
if (process.env.SEED !== 'false') await seedIfEmpty(db);

const port = Number(process.env.PORT || 3000);
createApp(db).listen(port, () => {
  console.log(`TrustVault listening on http://localhost:${port}`);
});
