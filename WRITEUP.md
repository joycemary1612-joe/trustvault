# TrustVault write-up

_Ravuri JoyceMary · Snovasys Fresher Hiring Challenge 2026_

## What I built

TrustVault is a document platform for confidential files: salary letters, contracts, drawings, audit papers.
Owners upload documents, organise them by name, category and description, keep versions, and share each one
with named people as **read** or **edit**. They can take access back at any time. Everyone else gets "not found",
whichever route they try. Every upload, view, download, change, deletion, permission change, sign-in and
**refused attempt** goes into an audit trail that the database will not let anyone edit, and that is
hash-chained, so a rewritten row is detected. Administrators manage people and watch activity, but cannot read
documents themselves.

The ten requirements, and where each one is:

1. **Three roles:** admin, owner, viewer. The table is in the README; enforced by `requireRole` and `authz.js`.
2. **Upload, organise, search, manage:** upload with category and description, rename, new versions, trash and restore.
3. **Per-document read/edit grants to named people:** the `grants` table, the sharing panel on each document.
4. **Owners grant and revoke:** owner-only `PUT/DELETE /documents/:id/grants/:userId`.
5. **No grant, no access:** `authorizeDocument()` runs on every document route; tests T-01 to T-14.
6. **Audit trail:** `audit.js`; tests T-20 to T-24.
7. **Search by name, owner, category, date:** the filter bar; the access rule is always part of the query.
8. **Upload validation:** extension allow-list plus a check of the file's actual bytes, 5 MB limit, safe filenames.
9. **Admin view:** overview (refused attempts, downloads, recent permission changes, chain check), full audit search, users.
10. **Automated tests:** 28 tests, plus a mutation check that removes 14 authorisation checks and proves a test fails each time.

## My permission model, in my own words

A document belongs to the person who uploaded it. Nobody else can see it until that owner shares it with a
named person, as read or edit. Read means you can open and download it. Edit also lets you change its details
and upload a new version, but it does not let you share it, delete it, or see who else has it. Those stay with
the owner, so access can only widen when the owner decides.

Roles are about what you can do in the system, not which documents you can open. An owner can upload; a
viewer can only receive; an admin manages people and reads the audit trail. Even the admin cannot open a
salary letter unless the owner shared it.

The decision is made in one function, `authorizeDocument()` in `server/src/authz.js`. It reads the owner
and the grant from the database on every request, with no cache, so revoking a grant or deactivating a person
takes effect on their very next click. If you have no access at all you get 404, so you cannot even confirm
the document exists. If you have read access and try to edit, you get 403. Every refusal is recorded with who tried.

**If the `authorizeDocument` line were removed from the download route,** anyone signed in could download any
document whose id they knew. Test T-02 fails immediately (Victor would get 200 instead of 404), and
`npm run mutation-check` reports it.

## What I deliberately did not build

- **Folders with inheritance, and groups.** That is how "shared one file, they can see forty" happens. Per-document grants are slower to manage but cannot over-share by accident.
- **External sharing and public links.** A link without an account cannot be tied to a person, so it breaks "prove who reached it".
- **AI suggestions for sharing.** Optional, and I ran out of time to do it safely. My rule would be: the AI only suggests, the owner confirms, and both the suggestion and the decision are audited.
- **Ownership transfer, retention and permanent purge, MFA, antivirus scanning.**

## How I used AI, and where it was wrong

I used **Claude Code** for most of the first drafts of code and documentation. I set the rules (one place
for authorisation, no caching or tokens, 404 for outsiders, admins can't read documents), reviewed the output,
ran it, and committed it myself. Details are in [PROMPTS.md](PROMPTS.md). The most important catches were:

- The mutation-check script it wrote reported 14/14 checks caught, but the tests were **not running at all**
  (a bad path made every run crash, and the crash counted as "caught").
- Once that was fixed, it showed the `is_active` check on sessions was **untested**, because the deactivate
  route also deletes sessions. I added T-08b.
- The login rate limiter it wrote counted per IP *and* email, so trying many accounts from one address was
  never slowed down. I added a per-IP limit and tests T-36/T-37.

## What is unfinished

- I only got the problem statement on the **last day** (the link on the site would not open for me), so the
  whole system was built on 25 October and the commit history covers hours, not a week.
- The items under "not built" above.
- From THREATS.md, accepted gaps: the newest audit rows could be cut off without detection unless the chain
  head is recorded outside the system; rate limits live in memory; there is no per-user storage quota; and a
  metadata edit and its audit row are not in one transaction.
- Demo accounts are shared by all judges on one database, so one person's changes are visible to the others.
- The UI is tested by hand, not by automated browser tests.
- The demo video: _add link or note here._
