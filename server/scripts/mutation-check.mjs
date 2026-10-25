// Removes one authorisation check at a time and runs the tests.
// Every mutation must make at least one test FAIL; otherwise the tests are not
// really testing that check. This is what the judges will do by hand.
// Run: node scripts/mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MUTATIONS = [
  ['src/routes/documents.js', "await authorizeDocument(db, req, req.params.id, 'read');\n    const version", "const version", 'download skips the access check'],
  ['src/routes/documents.js', "const level = await authorizeDocument(db, req, req.params.id, 'read');", "const level = 'read';", 'document details skip the access check'],
  ['src/routes/documents.js', "await authorizeDocument(db, req, req.params.id, 'edit');\n    const changes", "const changes", 'metadata edit skips the check'],
  ['src/routes/documents.js', "r.delete('/:id', wrap(async (req, res) => {\n    await authorizeDocument(db, req, req.params.id, 'manage');", "r.delete('/:id', wrap(async (req, res) => {", 'delete skips the check'],
  ['src/routes/documents.js', "r.put('/:id/grants/:userId', wrap(async (req, res) => {\n    await authorizeDocument(db, req, req.params.id, 'manage');", "r.put('/:id/grants/:userId', wrap(async (req, res) => {", 'granting skips the owner check'],
  ['src/routes/documents.js', "where.push('d.deleted_at IS NULL AND (d.owner_id = $1 OR g.user_id IS NOT NULL)')", "where.push('d.deleted_at IS NULL')", 'search returns every document'],
  ['src/routes/documents.js', "r.post('/', requireRole('owner'),", "r.post('/',", 'viewers can upload'],
  ['src/authz.js', 'if (row.deleted_at) return null;', '', 'grantees can reach deleted documents'],
  ['src/authz.js', "edit: ['owner', 'edit'],", "edit: ['owner', 'edit', 'read'],", 'read grant allows editing'],
  ['src/authz.js', "manage: ['owner'],", "manage: ['owner', 'edit'],", 'editors can share and delete'],
  ['src/routes/admin.js', "r.use(requireRole('admin'));", '', 'admin routes open to everyone'],
  ['src/session.js', 'AND u.is_active', '', 'deactivated users keep their sessions'],
  ['src/session.js', "if (req.get('X-Requested-With') !== 'TrustVault')", 'if (false)', 'CSRF header not required'],
  ['src/files.js', 'if (!type.check(file.buffer))', 'if (false)', 'file content not checked'],
];

const TEST_ARGS = ['--test', '--test-reporter=tap', '--test-concurrency=1', 'test/**/*.test.js'];
const runTests = () => spawnSync(process.execPath, TEST_ARGS, { encoding: 'utf8' });

// Baseline first: if the unmodified code does not pass, a "failure" below
// would mean nothing (this exact bug made the first version report 14/14).
const baseline = runTests();
if (baseline.status !== 0 || !/# pass [1-9]/.test(baseline.stdout)) {
  console.error('Baseline test run did not pass; fix that first.\n' + baseline.stdout.slice(-2000) + baseline.stderr.slice(-2000));
  process.exit(2);
}

let survived = 0;
for (const [file, from, to, label] of MUTATIONS) {
  const original = readFileSync(file, 'utf8');
  if (!original.includes(from)) { console.log(`?  could not apply: ${label}`); survived++; continue; }
  writeFileSync(file, original.replace(from, to));
  try {
    const run = runTests();
    // Caught only if real tests ran and at least one of them failed.
    const caught = /# fail [1-9]/.test(run.stdout);
    if (!caught) survived++;
    console.log(`${caught ? 'OK  caught ' : 'BAD missed '} ${label}`);
  } finally {
    writeFileSync(file, original);
  }
}
console.log(survived === 0 ? '\nEvery removed check was caught by a test.' : `\n${survived} mutation(s) survived.`);
process.exit(survived === 0 ? 0 : 1);
