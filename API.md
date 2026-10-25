# TrustVault API

Base path: `/api`. JSON in and out, except uploads (multipart) and downloads (file bytes).

**Authentication:** sign in with `POST /api/auth/login`; the server sets an `HttpOnly` session cookie
(`tv_session`). Send it with every request (browsers do this automatically).

**CSRF header:** every `POST`, `PUT`, `PATCH` and `DELETE` must include `X-Requested-With: TrustVault`,
otherwise the answer is `403`.

**Errors:** `{ "error": "message" }` with status `400` (bad input), `401` (not signed in), `403` (signed in,
not allowed), `404` (not found, **or no access at all**: the two are deliberately indistinguishable),
`409` (conflict), `413` (too large), `429` (too many attempts), `500` (our fault, no details).

**Access levels on a document** (decided by `authorizeDocument()` in `server/src/authz.js`):

| Action | Who |
|---|---|
| `read` | the owner, anyone with a `read` or `edit` grant |
| `edit` | the owner, anyone with an `edit` grant |
| `manage` | the owner only |

Roles never grant document access. Every refusal is written to the audit trail.

---

## Auth

| Method & path | Who may call | Body / query | Result |
|---|---|---|---|
| `POST /auth/login` | anyone (rate-limited: 10 / 15 min per IP+email, 50 / 15 min per IP) | `{ email, password }` | `200 { user }` + cookie; `401` same message for unknown email and wrong password |
| `POST /auth/logout` | anyone | — | deletes the session on the server |
| `GET /auth/me` | signed in | — | `{ user: { id, email, name, role } }` |
| `POST /auth/password` | signed in | `{ currentPassword, newPassword }` (min 10 chars, letters + digits) | ends **all** that user's sessions, issues a new one |

## Documents

| Method & path | Who may call | Body / query | Result |
|---|---|---|---|
| `GET /documents` | signed in | `scope` = `all` \| `mine` \| `shared` \| `trash`; `q` (name), `owner` (name or email), `category`, `from`, `to` (`YYYY-MM-DD`, created date) | only documents the caller can read (trash: only the caller's own deleted documents); max 200 |
| `POST /documents` | role **owner** | multipart: `file` (required, ≤ 5 MB, pdf/docx/xlsx/pptx/png/jpg/txt/csv, content must match type), `name`, `category`, `description` | `201 { document }`; caller becomes owner |
| `GET /documents/:id` | `read` | — | details, all versions, caller's access level |
| `GET /documents/:id/download` | `read` | `version` (optional, default latest) | file bytes, always as an attachment |
| `PATCH /documents/:id` | `edit` | `{ name?, category?, description? }` | `200` |
| `POST /documents/:id/versions` | `edit` | multipart `file` | `201 { version }` |
| `DELETE /documents/:id` | `manage` | — | moves to the owner's trash; grantees lose access at once |
| `POST /documents/:id/restore` | `manage` (works on deleted documents) | — | `200` |
| `GET /documents/:id/grants` | `manage` | — | who has access, with permission |
| `PUT /documents/:id/grants/:userId` | `manage` | `{ permission: "read" \| "edit" }` | grant or change; target must be an active user other than the owner |
| `DELETE /documents/:id/grants/:userId` | `manage` | — | revoke; effective on the user's next request |
| `GET /documents/:id/activity` | `manage` | — | this document's audit entries, including refused attempts |

Categories: `HR`, `Contracts`, `Finance`, `Legal`, `Engineering`, `Audit`, `Other`.

## Users

| Method & path | Who may call | Body / query | Result |
|---|---|---|---|
| `GET /users/directory` | role **owner** or **admin** | `q` (optional) | active users (id, name, email, role) to share with |

## Admin

All require role **admin**. None of them return document contents.

| Method & path | Body / query | Result |
|---|---|---|
| `GET /admin/users` | — | all users with role, status, documents owned |
| `POST /admin/users` | `{ email, name, role, password }` | `201 { user }`; `409` if the email exists |
| `PATCH /admin/users/:id` | `{ role?, isActive? }` | not allowed on yourself; deactivating deletes all of that user's sessions |
| `GET /admin/audit` | `action` (prefix, e.g. `permission.`), `outcome` (`allowed`/`denied`), `actor` (email contains), `documentId`, `from`, `to` | latest 300 matching entries |
| `GET /admin/audit/verify` | — | `{ ok, count, head }` or `{ ok: false, brokenAt, reason }` |
| `GET /admin/summary` | — | counts, top refused actors (7 days), recent permission changes |

## Health

| Method & path | Who | Result |
|---|---|---|
| `GET /health` | anyone | `{ ok: true }` |

## Audit actions

`auth.login`, `auth.logout`, `auth.password_change`, `document.upload`, `document.view`, `document.download`,
`document.update`, `document.new_version`, `document.delete`, `document.restore`, `permission.grant`,
`permission.revoke`, `user.create`, `user.update`, `audit.verify`, and refusals recorded as
`document.read` / `document.edit` / `document.manage` with outcome `denied`.
