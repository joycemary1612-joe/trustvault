// Input validation helpers. Anything that fails throws a 400 with a plain message.
import { HttpError } from './errors.js';

export const CATEGORIES = ['HR', 'Contracts', 'Finance', 'Legal', 'Engineering', 'Audit', 'Other'];
export const ROLES = ['admin', 'owner', 'viewer'];
export const PERMISSIONS = ['read', 'edit'];

export function str(value, field, { min = 1, max = 200, trim = true } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} is required.`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new HttpError(400, `${field} is required.`);
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  // Control characters have no place in names and break logs and headers.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw new HttpError(400, `${field} contains invalid characters.`);
  return v;
}

export function optionalStr(value, field, opts = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  return str(value, field, { ...opts, min: 0 });
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function validatePassword(value) {
  const p = str(value, 'newPassword', { min: 10, max: 200, trim: false });
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
    throw new HttpError(400, 'Password must be at least 10 characters and include letters and numbers.');
  }
  return p;
}

export function validateEmail(value) {
  const e = str(value, 'email', { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'email is not valid.');
  return e;
}

export function optionalDate(value, field) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be a date like 2026-10-25.`);
  }
  return value;
}

/** Escape LIKE wildcards so a search for "%" matches a literal percent sign. */
export function likePattern(text) {
  return '%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}
