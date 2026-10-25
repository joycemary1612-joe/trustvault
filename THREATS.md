# THREATS.md: how TrustVault could be broken

For each threat: what an attacker would try, what I did about it, how it is tested, and what I **knowingly
accepted**. Test names (`T-xx`) match the tests in `server/test/`. Run them with `npm test`.

**Where the decision is made:** every document route calls `authorizeDocument(db, req, docId, action)` in
[`server/src/authz.js`](server/src/authz.js) before touching the document. It reads the owner and the grant
from the database on **every** request. Nothing is cached, and there are no tokens or signed URLs to revoke.

**Proving the tests test something:** `npm run mutation-check` removes 14 different authorisation checks one at
a time and confirms at least one test fails for each. (It also checks that the untouched code passes first;
see PROMPTS.md entry 1 for why.)

Status key: **Closed** = mitigated and tested · **Partial** = mitigated, with a known gap · **Accepted** = known
and deliberately left.

---

## A. Reaching a document you were not given

| # | Threat | What I did | Test | Status |
|---|---|---|---|---|
| A1 | **No login:** call the API directly without a session. | `requireAuth` on every document, user and admin route. | T-01 | Closed |
| A2 | **IDOR:** change the document id in the URL, on *any* route (details, download, a specific version, edit, new version, delete, restore, grants, activity). | Every route calls `authorizeDocument` first. Ids are random UUIDs, but that is **not** relied on: guessing a valid id still gets 404. | T-02, T-03 | Closed |
| A3 | **Existence leak:** tell "exists but forbidden" apart from "does not exist". | No access at all → **404**, same message as a made-up id. 403 only when you already have *some* access (e.g. a reader trying to edit). | T-02, T-13 | Closed |
| A4 | **Search / list leak:** find others' documents through search, owner filter, category or date filters, or wildcards like `%` and `_`. | The access rule is the first `WHERE` clause and is not optional; filters only narrow it. LIKE wildcards are escaped. | T-04 | Closed |
| A5 | **Version tampering:** download `?version=N` of a document you can't read, or a version belonging to a different document. | Access is checked on the document first; the version lookup is scoped by `document_id`. | T-02 | Closed |
| A6 | **Deleted documents:** a grantee keeps reaching a document after the owner deleted it. | Deleted documents return "no access" for everyone except the owner (for restore). | T-12 | Closed |
| A7 | **Admin as super-user:** an administrator (or a stolen admin account) reads salary letters. | Roles never give document access. Admin routes never read file contents. An admin sees a document only if its owner shared it. | T-09 | Closed |
| A8 | **Admin reaches documents indirectly:** promotes someone to owner, resets a password, or creates an account. | An admin **cannot** set another user's password, so cannot sign in as them. Promoting someone gives no access to existing documents (access is per document). | n/a | Partial: an admin can still create a new account and *deactivate* the real owner, which denies service. Accepted: admins are trusted not to sabotage, and every such action is in the audit trail. |
| A9 | **SQL injection** through ids, search terms, filters or form fields. | Every query is parameterised (`$1`). The only dynamic SQL is column names from a fixed list in the code, never from the request. Ids are checked against a UUID pattern. | T-13 | Closed |
| A10 | **Direct file access:** find the file on a public disk or bucket URL. | File bytes are stored in the database (`document_versions.content`). There is no static file route; the only way out is the download route. | by design | Closed |
| A11 | **Browser or proxy cache:** a revoked user (or the next person on a shared computer) opens a cached copy. | `Cache-Control: no-store, private` on every API response and download. | manual | Partial: a file that was **already downloaded** stays on that person's disk. No system can take that back; the audit trail records that it was downloaded. |

## B. Doing more than you were given

| # | Threat | What I did | Test | Status |
|---|---|---|---|---|
| B1 | **Reader edits, re-uploads, deletes or shares.** | `ALLOWED` table in authz.js: read → view/download only. | T-05 | Closed |
| B2 | **Editor widens access:** someone with "edit" shares the document onward, or deletes it. | Only the owner can share, revoke, delete, restore or see who has access (`manage`). | T-06 | Closed |
| B3 | **Role escalation:** a user changes their own role through the API, or mass-assigns `role` / `is_active`. | Only admins reach `/api/admin/*`. Fields are read individually from a fixed list. Admins cannot change their own role or status (no accidental lock-out). | T-10 | Closed |
| B4 | **Viewer uploads documents** or lists the user directory. | Upload requires the owner role; the directory needs owner or admin. | T-11 | Closed |
| B5 | **Granting to the wrong target:** yourself, a made-up user id, a deactivated user, or an invalid permission like `owner`. | Validated before writing the grant. | T-14 | Closed |
| B6 | **Demoted owner** keeps control of the documents they already own. | Ownership is per document, not per role: a demoted owner still owns old documents but cannot upload new ones. | n/a | Accepted: there is no "transfer ownership" yet (see "Not built"). Deactivating the person is the fix today. |

## C. Taking access away

| # | Threat | What I did | Test | Status |
|---|---|---|---|---|
| C1 | **Revoked grant still works** because of a cached permission, a JWT, or a signed link issued earlier. | No caching, no JWTs, no signed URLs. The grant row is read on every request, so revocation applies on the **next request** of an already-open session. | T-07 | Closed |
| C2 | **Leaver keeps access:** an employee is deactivated but their session or cookie still works. | Deactivation deletes all their sessions, **and** the session lookup itself requires `is_active` (two independent checks). They cannot sign in again either. | T-08, T-08b | Closed |
| C3 | **Logout only clears the cookie:** a copied cookie still works afterwards. | Logout deletes the session row on the server. | T-35 | Closed |
| C4 | **Password change** leaves stolen sessions alive. | Changing the password deletes every session for that user and issues a new one. | manual | Closed |
| C5 | **Download in progress** at the moment of revocation. | The check happens at the start of each request. | n/a | Accepted: a transfer that already started finishes (max 5 MB, so seconds). |
| C6 | **Race between check and action** (revoked between `authorizeDocument` and the write). | Small window inside one request. | n/a | Accepted: closing it fully means doing the check and the write in one transaction with row locks. Noted as future work. |

What "immediately" costs me: one extra indexed query per request, and no CDN or browser caching of files. I
think that is the right trade for confidential documents.

## D. Sessions and sign-in

| # | Threat | What I did | Test | Status |
|---|---|---|---|---|
| D1 | **Session theft by XSS** reading the cookie. | Cookie is `HttpOnly`, `Secure` in production, `SameSite=Strict`. Tokens are 256-bit random values. | n/a | Closed |
| D2 | **Database leak gives working sessions.** | Only the SHA-256 of each session token is stored. | n/a | Closed |
| D3 | **CSRF:** another site makes the victim's browser delete or share a document. | Every state-changing request needs the header `X-Requested-With: TrustVault`. A cross-site form cannot set it, and a cross-site `fetch` with it needs a CORS preflight that we never approve. `SameSite=Strict` is a second layer. | T-33 | Closed |
| D4 | **Password guessing** against one account. | 10 attempts per 15 minutes per IP+email. | T-37 | Closed |
| D5 | **Password spraying:** many accounts from one IP. | Second limit: 50 attempts per 15 minutes per IP. | T-36 | Partial: limits live in memory, reset when the server restarts, and do not stop a botnet spread over many IPs. No account lockout (which would let anyone lock out others). |
| D6 | **Account enumeration** through different login errors or timing. | Same message and status for an unknown email and a wrong password; an unknown email still runs a bcrypt compare. | T-34 | Closed |
| D7 | **Weak passwords.** | bcrypt (cost 12); new passwords need at least 10 characters with letters and numbers. | n/a | Partial: no breached-password check and no MFA. |
| D8 | **Long-lived sessions.** | 8-hour absolute expiry. | n/a | Partial: no idle timeout, and no "sign out other devices" page (a password change does it). |

## E. The audit trail

| # | Threat | What I did | Test | Status |
|---|---|---|---|---|
| E1 | **Refused attempts go unrecorded**, so you cannot tell who tried. | Every refusal from `authorizeDocument`, every failed sign-in and every rejected upload is written with actor, IP, path and reason. | T-20, T-21 | Closed |
| E2 | **Events missing.** | Upload, view, download, metadata change, new version, delete, restore, grant, revoke, user create/update, login/logout, password change, audit verification. | T-22 | Closed |
| E3 | **Action happens but the audit write fails.** | The audit write is awaited inside the request; if it fails, the request fails with 500. The download is logged **before** the bytes are sent. | n/a | Partial: for metadata edits the change is committed before the audit row, so a crash exactly between them could lose that one row. Same-transaction auditing is future work. |
| E4 | **Someone edits or deletes audit rows through the app or SQL.** | No route updates or deletes audit rows. A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log`. | T-23 | Closed |
| E5 | **A database owner disables the trigger** and rewrites a row. | Each row stores `HMAC(key, previous hash + payload)`. The key is only in the app's environment, not in the database, so someone with database access alone cannot produce valid hashes. Admin → "Verify audit trail" walks the whole chain. | T-24 | Closed |
| E6 | **Cutting off the end of the log** (deleting the newest rows). | The remaining chain still verifies, so this is **not** detectable by the chain alone. The admin page shows the current chain head so it can be written down elsewhere. | n/a | Partial / accepted: real fix is to anchor the head hash somewhere outside (e.g. a daily email or a write-once bucket). Not built. |
| E7 | **Attacker with both the database and the app's environment** (the HMAC key). | Could rebuild the whole chain. | n/a | Accepted: that is full server compromise; out of scope for this build. |
| E8 | **Flooding the log** with refused attempts to fill the database. | Login is rate-limited. | n/a | Accepted: refused document requests from a logged-in user are not rate-limited and each one writes a row. |

## F. Malicious files and content

| # | Threat | What I did | Test | Status |
|---|---|---|---|---|
| F1 | **Disguised file:** HTML or script renamed to `.pdf`, a binary renamed to `.txt`. | Allow-list of extensions, **and** the file's first bytes must match (`%PDF-`, PNG, JPEG, ZIP for Office; text must be valid UTF-8 without NUL bytes). The browser's Content-Type is ignored. | T-30 | Closed |
| F2 | **Stored XSS from a download** opened inside our site. | Downloads are always `Content-Disposition: attachment`, with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. HTML and SVG are not allowed at all. | T-30 | Closed |
| F3 | **XSS through names, descriptions or filenames.** | React escapes all text. Filenames are reduced to safe characters. The app sends a strict CSP (`default-src 'self'`). | T-32 | Closed |
| F4 | **Path traversal** through a filename like `../../etc/passwd`. | Only the base name is kept, and files never touch the disk anyway. | T-32 | Closed |
| F5 | **Huge uploads / memory exhaustion.** | 5 MB file limit, one file per request, 100 KB JSON limit. | T-31 | Partial: no per-user storage quota; Neon's free tier caps the database at about 0.5 GB. |
| F6 | **Malware or macro documents** (a real PDF with JavaScript, a `.docx` with macros). | Content is checked for *type*, not for *safety*. | n/a | Accepted: no antivirus scanning. Files are only ever downloaded, never opened in our origin. |
| F7 | **Header injection** through a filename in `Content-Disposition`. | Filenames are restricted to letters, digits, `. - _ ( )` and space, and also sent RFC 5987-encoded. | n/a | Closed |

## G. Platform and deployment

| # | Threat | What I did | Status |
|---|---|---|---|
| G1 | **Clickjacking.** | `frame-ancestors 'none'` (helmet CSP). | Closed |
| G2 | **Error messages leak internals** (stack traces, SQL). | One error handler: known errors give a plain message, everything else gives a generic 500; details only in server logs. | Closed |
| G3 | **Secrets in the repository.** | `DATABASE_URL` and `AUDIT_HMAC_KEY` come from environment variables; the server refuses to start in production without the HMAC key. | Closed |
| G4 | **Demo accounts are public** (the brief asks for credentials in the README), so anyone can sign in as the admin. | Intentional for judging. Every judge shares the same demo database, so one judge could change the admin password or deactivate a demo user. | Accepted: if that happens, redeploying with an empty database re-seeds it. |
| G5 | **Plain HTTP.** | Render serves HTTPS only; helmet sends HSTS; cookies are `Secure` in production. | Closed |
| G6 | **Vulnerable dependencies.** | Few dependencies; `npm audit` reported 0 vulnerabilities when installed. | Partial: no automated dependency updates. |
| G7 | **Free-tier cold start.** | Render free services sleep after inactivity; the first request can take ~50 seconds. | Accepted: an availability issue, not a confidentiality one. |
| G8 | **Data at rest.** | Neon encrypts storage at rest. | Partial: file contents are not separately encrypted by the app, so a database operator can read them. |

---

## Not built (deliberately), and why

- **Folder inheritance.** The problem statement's first example ("given a folder to see one file, now they see
  forty") is exactly the risk inheritance creates. Per-document grants are more clicks, but nothing is
  shared by accident.
- **Groups.** Same reason: membership changes would silently widen access. A clear next step if done with an audit entry for every membership change.
- **Sharing with people outside the company / public links.** A link that works without an account cannot be
  tied to a person, which breaks "prove who reached it". If built, it would be a time-limited guest account.
- **AI suggestions for who should see a document.** Optional in the brief. I did not have time to build it
  safely; the rule would be that the AI only *suggests*, the owner confirms, and both are audited.
- **Ownership transfer, retention rules, permanent purge, MFA, antivirus scanning, external anchoring of the
  audit head.** Listed above where they matter.
