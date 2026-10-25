// Demo data so a stranger can try every role. Runs only on an empty database.
// The passwords are public (they are in the README) on purpose: this is a demo.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { audit } from './audit.js';

export const DEMO_USERS = [
  { email: 'admin@trustvault.test', name: 'Asha Admin', role: 'admin', password: 'AdminVault2026' },
  { email: 'olivia@trustvault.test', name: 'Olivia Owner', role: 'owner', password: 'OliviaVault2026' },
  { email: 'omar@trustvault.test', name: 'Omar Owner', role: 'owner', password: 'OmarVault2026' },
  { email: 'vera@trustvault.test', name: 'Vera Viewer', role: 'viewer', password: 'VeraVault2026' },
  { email: 'victor@trustvault.test', name: 'Victor Viewer', role: 'viewer', password: 'VictorVault2026' },
];

function tinyPdf(text) {
  const body = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { out += `${String(off).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export async function seedIfEmpty(db, { rounds = 12 } = {}) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return false;

  const ids = {};
  for (const u of DEMO_USERS) {
    const r = await db.query(
      'INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
      [u.email, u.name, u.role, await bcrypt.hash(u.password, rounds)]);
    ids[u.email.split('@')[0]] = r.rows[0].id;
  }

  const docs = [
    { owner: 'olivia', name: 'Salary letter - Vera', category: 'HR', file: 'salary-letter-vera.pdf', content: tinyPdf('Salary letter for Vera Viewer - CONFIDENTIAL'), grants: [['vera', 'read']] },
    { owner: 'olivia', name: 'Q3 board pack', category: 'Finance', file: 'q3-board-pack.txt', content: Buffer.from('Q3 board pack. Revenue up 12%. Confidential.\n'), grants: [['omar', 'edit']] },
    { owner: 'omar', name: 'Client contract - Acme', category: 'Contracts', file: 'acme-contract.pdf', content: tinyPdf('Master services agreement with Acme Ltd'), grants: [['victor', 'read']] },
    { owner: 'omar', name: 'Bridge drawings rev B', category: 'Engineering', file: 'bridge-drawings.txt', content: Buffer.from('Drawing set rev B. Shared with external partner only.\n'), grants: [] },
  ];
  for (const d of docs) {
    const doc = (await db.query(
      'INSERT INTO documents (name, category, description, owner_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [d.name, d.category, 'Demo document', ids[d.owner]])).rows[0];
    const mime = d.file.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8';
    await db.query(
      `INSERT INTO document_versions (document_id, version_no, original_filename, mime_type, size_bytes, sha256, content, uploaded_by)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [doc.id, d.file, mime, d.content.length, crypto.createHash('sha256').update(d.content).digest('hex'), d.content, ids[d.owner]]);
    await audit(db, null, { action: 'document.upload', actorId: ids[d.owner], actorEmail: `${d.owner}@trustvault.test`, documentId: doc.id, details: { name: d.name, seed: true } });
    for (const [who, permission] of d.grants) {
      await db.query('INSERT INTO grants (document_id, user_id, permission, granted_by) VALUES ($1,$2,$3,$4)',
        [doc.id, ids[who], permission, ids[d.owner]]);
      await audit(db, null, { action: 'permission.grant', actorId: ids[d.owner], actorEmail: `${d.owner}@trustvault.test`, documentId: doc.id, targetUserId: ids[who], details: { permission, previous: null, seed: true } });
    }
  }
  console.log('Seeded demo users and documents.');
  return true;
}
