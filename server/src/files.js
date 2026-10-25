// Upload validation. The server decides what a file is from its bytes and
// extension together; the Content-Type the browser sends is ignored.
import crypto from 'node:crypto';
import path from 'node:path';
import { HttpError } from './errors.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];

// extension -> { mime we will serve it as, check on the actual bytes }
const TYPES = {
  pdf: { mime: 'application/pdf', check: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) }, // %PDF-
  png: { mime: 'image/png', check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: 'image/jpeg', check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: 'image/jpeg', check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: (b) => startsWith(b, ZIP) },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: (b) => startsWith(b, ZIP) },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: (b) => startsWith(b, ZIP) },
  txt: { mime: 'text/plain; charset=utf-8', check: isPlainText },
  csv: { mime: 'text/csv; charset=utf-8', check: isPlainText },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

function isPlainText(buf) {
  if (buf.includes(0)) return false; // binary
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Keep a safe display filename: no paths, no control or odd characters. */
export function cleanFilename(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'file';
}

/** Validate a multer file. Returns the facts we store. */
export function inspectUpload(file) {
  if (!file) throw new HttpError(400, 'Choose a file to upload.');
  if (file.size === 0) throw new HttpError(400, 'The file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, 'The file is larger than 5 MB.');

  const filename = cleanFilename(file.originalname);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const type = TYPES[ext];
  if (!type) throw new HttpError(400, `File type .${ext || '?'} is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`);
  if (!type.check(file.buffer)) throw new HttpError(400, `The file content does not match a .${ext} file.`);

  return {
    filename,
    mime: type.mime,
    size: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    content: file.buffer,
  };
}

/** Headers that make a download safe to serve even if the content is hostile. */
export function setDownloadHeaders(res, { filename, mime, size }) {
  res.set({
    'Content-Type': mime,
    'Content-Length': String(size),
    // Always a download, never rendered in our origin.
    'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'no-store, private',
  });
}
