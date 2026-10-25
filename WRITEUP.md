# TrustVault write-up

_Ravuri JoyceMary · Snovasys Fresher Hiring Challenge 2026_

## What I built

TrustVault is a place to keep confidential documents like salary letters, contracts and drawings, and share
each one only with the people who should see it.

An owner uploads a document and gives a category and a short description. They can rename it, upload new
versions (the old ones stay downloadable), move it to the trash and restore it. To share it, they pick a
named person and choose "Can view" or "Can edit". They can change that or take it away at any time. Anyone
else who tries to reach the document is told it doesn't exist.

Everything that happens is written to an audit trail: sign-ins, uploads, views, downloads, edits, deletions,
sharing changes, and also every attempt that was refused. The database won't let anyone edit or delete those
rows, and each row is chained to the one before it with a secret key, so if someone changes history the chain
breaks. The admin can check the chain with one button and download the whole trail as a CSV file.

How the ten requirements are covered:

1. **Three roles:** admin, owner and viewer. What each one can do is in the table in the README.
2. **Upload, organise, search, manage:** categories, descriptions, rename, versions, trash and restore.
3. **Read and edit permissions to named people:** the "Who has access" panel on each document.
4. **Owners grant and revoke:** only the owner of a document can change who has it.
5. **No grant, no access:** every document route goes through one check on the server. Tests T-01 to T-14.
6. **Audit trail:** tests T-20 to T-24, plus the CSV export test T-44.
7. **Search by name, owner, category and date:** the filter bar on the documents page.
8. **Upload validation:** only certain file types, the file's real content has to match its extension, 5 MB
   limit, and filenames are cleaned.
9. **Admin view:** refused attempts, downloads, recent sharing changes, the full audit trail with filters, and
   user management.
10. **Tests:** 34 automated tests. I also wrote a script that removes 16 security checks one at a time and makes
    sure a test fails every time.

Something extra I added: **sharing suggestions**. When an owner opens a document, TrustVault suggests people
they have already shared similar documents with, and says why. It only suggests, always view-only, and nothing
is shared until the owner clicks Share. The suggestion, the click and any "dismiss" all go into the audit trail.
It works from simple rules, not an AI model, so no document details are sent anywhere.

## My permission model

A new document is visible only to the person who uploaded it. Nobody else can see it, not even the admin.

The owner can share it with a specific person as "Can view" or "Can edit". Can view means they can open and
download it. Can edit means they can also rename it and upload a new version. But only the owner can share it
further, delete it, or see who else has access. I did that on purpose: if editors could share, access could
spread without the owner knowing.

Roles are about what you can do in the system, not which documents you can open. Owners can upload, viewers
can only receive, and the admin manages people and watches the audit trail. The admin can't read a salary
letter unless the owner shares it with them. Usually the admin is the most powerful account, and I didn't want
one stolen admin password to expose every document.

The decision is made in one place: the function `authorizeDocument()` in `server/src/authz.js`. Every
document route calls it before doing anything. It looks up the owner and the grant in the database on every
single request. Nothing is cached and no download links or tokens are handed out. That's why taking access
away works straight away: the person's next click is refused.

If someone has no access at all, they get "not found", the same answer as for a document that doesn't exist,
so they can't even learn that it's there. If they have view access and try to edit, they get "not allowed".
Every refusal is saved with who tried, when, and from which IP.

The download check is at line 120 of `server/src/routes/documents.js`. If that line were removed, any
signed-in person could download any document whose id they knew. Test T-02 would fail straight away, and so
would my mutation script.

## What I chose not to build

- **Folders and groups.** The problem statement's own example, getting access to a folder for one file and
  seeing forty, is exactly what folder inheritance causes. Sharing one document at a time is slower, but
  nothing gets shared by accident.
- **Sharing with people outside the company through links.** A link that works without an account can't be
  tied to a person, and then I can't prove who opened the document.
- **An AI model for suggestions.** I used simple rules so no document names or contents go to an outside service.
- **Time-limited access, ownership transfer, retention rules and permanent delete, MFA, virus scanning.**
  All listed in THREATS.md with the reason.

## How I used AI, and where it was wrong

I built this with **Claude Code** (Claude Opus 5.5). It wrote most of the first drafts of the code, tests and
docs. I set the rules it had to follow: one place for access decisions, nothing cached, "not found" for
outsiders, and admins can't read documents. I reviewed what it produced, ran it, attacked my deployed site
myself, and made every commit. PROMPTS.md has seven dated entries. The ones that taught me the most:

- **The audit trail saved the wrong IP address.** It assumed Render has one proxy in front of the app. On the
  live site every row showed Render's internal 10.x addresses, so the record couldn't say where an attempt
  came from. I only noticed by reading the live audit trail. I fixed it and checked that a fake IP header is
  ignored.
- **The test checker said everything was fine when nothing ran.** Its mutation script reported 14 out of 14,
  but the tests were crashing before they started. I made it run the normal tests first and only count a real
  failing test.
- **An access check nobody tested.** Once the checker worked, it showed that the "is this user still active"
  check could be deleted without any test noticing. I added test T-08b.
- **A rate limit that password spraying walks straight past.** It limited per account, so trying one password
  against every account was never slowed down. I added a per-IP limit with two tests.
- **Tests that couldn't fail.** The first CSV-injection test put the dangerous text where it could never cause
  a problem, so it passed with or without the protection. I rewrote it.

What I learnt: "all tests pass" means nothing until I've seen a test fail for the right reason.

## What is unfinished

- The problem statement link didn't open for me until the last day, so I built everything on 25 October. The
  commit history covers hours, not a week, and I haven't changed any dates.
- The features under "What I chose not to build".
- Known weak spots, also in THREATS.md:
  - if someone deletes the newest audit rows, the chain still looks fine unless compared with an older CSV export;
  - the login limits reset when the server restarts;
  - an edit and its audit row aren't saved in one transaction;
  - admins can see document names, though not contents.
- All judges use the same demo database, so one person's changes show up for everyone.
- The free Render server sleeps when idle and takes about 50 seconds to wake up. The free database expires on 24 November.
- I tested the screens by hand. There are no automated browser tests.
- Demo video: _link to be added._
